-- HiRAGe schema.
--
-- Everything lives in a dedicated `hirage` schema because this Supabase project
-- already hosts another application in `public`. Confining HiRAGe here means its
-- `profiles` table cannot collide with the resident one, and its grants and
-- revokes cannot alter the privileges of tables it does not own.
--
-- Design notes that are not obvious from the DDL:
--   * `documents` is keyed by a content hash so an identical file uploaded twice
--     is parsed and embedded exactly once, ever (spec 1.5).
--   * `resumes` is the join between a document and a job's pool. Explanations are
--     cached per (resume, jd_version) because that pair is what an explanation
--     actually depends on; rankings are cached per (job, jd_version, pool_version).
--   * `jobs.pool_version` is bumped whenever a resume enters or leaves the pool,
--     which invalidates rankings without touching explanations.
--   * Role checks live in SECURITY DEFINER helpers so that policies on `profiles`
--     can read `profiles` without recursing through RLS.

create schema if not exists hirage;

create extension if not exists vector;
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- profiles ---

create type hirage.user_role as enum ('candidate', 'admin');

create table hirage.profiles (
  id                 uuid primary key references auth.users (id) on delete cascade,
  email              text not null unique,
  full_name          text,
  phone              text,
  role               hirage.user_role not null default 'candidate',
  roles_of_interest  text[] not null default '{}',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index profiles_email_idx on hirage.profiles (lower(email));

-- The super admin is fixed by the spec and must hold the admin role from the
-- moment the account is confirmed, without anyone granting it.
create or replace function hirage.is_super_admin_email(p_email text)
returns boolean
language sql
immutable
as $$
  select lower(p_email) = 'rk26.ftw@gmail.com';
$$;

create or replace function hirage.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = hirage, public
as $$
begin
  insert into hirage.profiles (id, email, role)
  values (
    new.id,
    new.email,
    case when hirage.is_super_admin_email(new.email) then 'admin'::hirage.user_role
         else 'candidate'::hirage.user_role end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- The profile is created on confirmation, not on submission, so that an
-- unconfirmed sign up leaves no usable account behind (spec 2.1).
create trigger on_auth_user_confirmed
  after insert or update of email_confirmed_at on auth.users
  for each row
  when (new.email_confirmed_at is not null)
  execute function hirage.handle_new_user();

create or replace function hirage.current_role_is_admin()
returns boolean
language sql
stable
security definer
set search_path = hirage, public
as $$
  select exists (
    select 1 from hirage.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

create or replace function hirage.current_user_is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = hirage, public
as $$
  select exists (
    select 1 from hirage.profiles
    where id = auth.uid() and hirage.is_super_admin_email(email)
  );
$$;

-- -------------------------------------------------------------------- jobs ---

create type hirage.job_status as enum ('active', 'frozen');

create table hirage.jobs (
  id                     uuid primary key default gen_random_uuid(),
  created_by             uuid not null references hirage.profiles (id) on delete cascade,
  company_name           text not null,
  recruiter_name         text not null,
  recruiter_email        text not null,
  description            text not null,
  description_file_path  text,
  tags                   text[] not null default '{}',
  status                 hirage.job_status not null default 'active',
  jd_version             integer not null default 1,
  pool_version           integer not null default 1,
  deleted_at             timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index jobs_live_idx on hirage.jobs (created_at desc) where deleted_at is null;
create index jobs_tags_idx on hirage.jobs using gin (tags);

-- --------------------------------------------------------------- documents ---

create type hirage.parse_status as enum ('pending', 'parsing', 'parsed', 'failed');

create table hirage.documents (
  id              uuid primary key default gen_random_uuid(),
  content_hash    text not null unique,
  storage_path    text not null,
  file_name       text not null,
  mime_type       text not null,
  byte_size       integer not null default 0,
  parsed_text     text,
  extracted_email text,
  status          hirage.parse_status not null default 'pending',
  error           text,
  parsed_at       timestamptz,
  created_at      timestamptz not null default now()
);

create index documents_status_idx on hirage.documents (status);

create table hirage.chunks (
  id          bigserial primary key,
  document_id uuid not null references hirage.documents (id) on delete cascade,
  chunk_index integer not null,
  content     text not null,
  embedding   public.vector(768),
  unique (document_id, chunk_index)
);

create index chunks_document_idx on hirage.chunks (document_id);
create index chunks_embedding_idx on hirage.chunks
  using hnsw (embedding public.vector_cosine_ops);

-- ----------------------------------------------------------------- resumes ---

create type hirage.resume_source as enum ('application', 'admin_upload');

create table hirage.resumes (
  id           uuid primary key default gen_random_uuid(),
  job_id       uuid not null references hirage.jobs (id) on delete cascade,
  document_id  uuid not null references hirage.documents (id) on delete cascade,
  candidate_id uuid references hirage.profiles (id) on delete set null,
  source       hirage.resume_source not null,
  created_at   timestamptz not null default now(),
  unique (job_id, document_id)
);

create index resumes_job_idx on hirage.resumes (job_id);

-- Pool membership changes invalidate the stored ranking but never the cached
-- explanations, so the version bump lives on the pool, not on the job description.
create or replace function hirage.bump_pool_version()
returns trigger
language plpgsql
as $$
begin
  update hirage.jobs
     set pool_version = pool_version + 1,
         updated_at = now()
   where id = coalesce(new.job_id, old.job_id);
  return coalesce(new, old);
end;
$$;

create trigger resumes_pool_version
  after insert or delete on hirage.resumes
  for each row execute function hirage.bump_pool_version();

-- ------------------------------------------------------------ applications ---

create type hirage.application_status as enum ('applied', 'withdrawn');

create table hirage.applications (
  id           uuid primary key default gen_random_uuid(),
  job_id       uuid not null references hirage.jobs (id) on delete cascade,
  candidate_id uuid not null references hirage.profiles (id) on delete cascade,
  resume_id    uuid references hirage.resumes (id) on delete set null,
  status       hirage.application_status not null default 'applied',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (job_id, candidate_id)
);

create index applications_candidate_idx on hirage.applications (candidate_id);

-- ---------------------------------------------------- rankings + rationale ---

create table hirage.rankings (
  id           uuid primary key default gen_random_uuid(),
  job_id       uuid not null references hirage.jobs (id) on delete cascade,
  jd_version   integer not null,
  pool_version integer not null,
  created_at   timestamptz not null default now(),
  unique (job_id, jd_version, pool_version)
);

create table hirage.ranking_items (
  ranking_id uuid not null references hirage.rankings (id) on delete cascade,
  resume_id  uuid not null references hirage.resumes (id) on delete cascade,
  rank       integer not null,
  score      double precision not null,
  primary key (ranking_id, resume_id)
);

create index ranking_items_order_idx on hirage.ranking_items (ranking_id, rank);

-- An explanation depends on exactly one resume and one job description version,
-- which is why raising k only costs the newly included candidates.
create table hirage.explanations (
  id         uuid primary key default gen_random_uuid(),
  resume_id  uuid not null references hirage.resumes (id) on delete cascade,
  jd_version integer not null,
  pros       text[] not null default '{}',
  cons       text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (resume_id, jd_version)
);

-- --------------------------------------------- shortlists and notifications ---

create table hirage.shortlists (
  id             uuid primary key default gen_random_uuid(),
  job_id         uuid not null references hirage.jobs (id) on delete cascade,
  resume_id      uuid not null references hirage.resumes (id) on delete cascade,
  candidate_email text,
  confirmed_by   uuid references hirage.profiles (id) on delete set null,
  notified       boolean not null default false,
  created_at     timestamptz not null default now(),
  unique (job_id, resume_id)
);

create table hirage.notifications (
  id              uuid primary key default gen_random_uuid(),
  recipient_id    uuid not null references hirage.profiles (id) on delete cascade,
  job_id          uuid references hirage.jobs (id) on delete set null,
  company_name    text not null,
  recruiter_name  text not null,
  recruiter_email text not null,
  body            text not null,
  read_at         timestamptz,
  created_at      timestamptz not null default now()
);

create index notifications_recipient_idx on hirage.notifications (recipient_id, created_at desc);

-- ------------------------------------------------------------- job queue -----

create type hirage.pipeline_kind as enum ('parse', 'shortlist');
create type hirage.pipeline_status as enum ('queued', 'running', 'succeeded', 'failed');

create table hirage.pipeline_jobs (
  id             uuid primary key default gen_random_uuid(),
  job_id         uuid not null references hirage.jobs (id) on delete cascade,
  kind           hirage.pipeline_kind not null,
  status         hirage.pipeline_status not null default 'queued',
  payload        jsonb not null default '{}'::jsonb,
  progress_done  integer not null default 0,
  progress_total integer not null default 0,
  message        text,
  error          text,
  created_at     timestamptz not null default now(),
  started_at     timestamptz,
  finished_at    timestamptz
);

create index pipeline_jobs_poll_idx on hirage.pipeline_jobs (status, created_at);
create index pipeline_jobs_job_idx on hirage.pipeline_jobs (job_id, created_at desc);

-- Only one live run of a given kind per job, so double-clicking Parse or
-- Shortlist cannot fan out into duplicate work.
create unique index pipeline_jobs_single_active_idx
  on hirage.pipeline_jobs (job_id, kind)
  where status in ('queued', 'running');

-- Claims the oldest queued task atomically so several workers can share a queue.
create or replace function hirage.claim_pipeline_job()
returns hirage.pipeline_jobs
language plpgsql
as $$
declare
  claimed hirage.pipeline_jobs;
begin
  select * into claimed
    from hirage.pipeline_jobs
   where status = 'queued'
   order by created_at
   limit 1
   for update skip locked;

  if claimed.id is null then
    return null;
  end if;

  update hirage.pipeline_jobs
     set status = 'running', started_at = now()
   where id = claimed.id
  returning * into claimed;

  return claimed;
end;
$$;

-- ------------------------------------------------------------- retrieval -----

-- Ranks every resume in a job's pool against one job-description embedding.
-- Score blends the single best chunk with the mean of that resume's top chunks
-- so a resume that matches broadly beats one with a single lucky paragraph.
create or replace function hirage.rank_job_pool(
  p_job_id uuid,
  p_query  public.vector(768)
)
returns table (resume_id uuid, score double precision)
language sql
stable
as $$
  with scored as (
    select r.id as rid,
           1 - (c.embedding OPERATOR(public.<=>) p_query) as sim,
           row_number() over (
             partition by r.id order by c.embedding OPERATOR(public.<=>) p_query
           ) as rn
      from hirage.resumes r
      join hirage.chunks c on c.document_id = r.document_id
     where r.job_id = p_job_id
       and c.embedding is not null
  )
  select rid,
         max(sim) * 0.6 + avg(sim) filter (where rn <= 3) * 0.4
    from scored
   where rn <= 8
   group by rid
   order by 2 desc;
$$;

-- ------------------------------------------------------------------ RLS ------

alter table hirage.profiles       enable row level security;
alter table hirage.jobs           enable row level security;
alter table hirage.documents      enable row level security;
alter table hirage.chunks         enable row level security;
alter table hirage.resumes        enable row level security;
alter table hirage.applications   enable row level security;
alter table hirage.rankings       enable row level security;
alter table hirage.ranking_items  enable row level security;
alter table hirage.explanations   enable row level security;
alter table hirage.shortlists     enable row level security;
alter table hirage.notifications  enable row level security;
alter table hirage.pipeline_jobs  enable row level security;

-- profiles: a user reads and edits only their own row. Admins read all rows so
-- the access section can look accounts up by email. Nobody can change their own
-- role from the client; promotion happens through a server route that uses the
-- service key after checking super-admin status.
create policy profiles_select_self on hirage.profiles
  for select using (id = auth.uid() or hirage.current_role_is_admin());

create policy profiles_update_self on hirage.profiles
  for update using (id = auth.uid())
  with check (id = auth.uid());

-- Role escalation is blocked at the row level rather than in the policy, because
-- a policy that reads `profiles` to compare the old role would recurse. Requests
-- made with the service key have no auth.uid() and are therefore allowed, which
-- is exactly the super-admin grant path in section 3.4.
create or replace function hirage.guard_profile_role()
returns trigger
language plpgsql
as $$
begin
  if new.role is distinct from old.role and auth.uid() is not null then
    raise exception 'role can only be changed by the super admin';
  end if;
  return new;
end;
$$;

create trigger profiles_guard_role
  before update on hirage.profiles
  for each row execute function hirage.guard_profile_role();

-- jobs: candidates see live jobs only; admins see and manage everything.
create policy jobs_select_live on hirage.jobs
  for select using (deleted_at is null or hirage.current_role_is_admin());

create policy jobs_admin_write on hirage.jobs
  for all using (hirage.current_role_is_admin())
  with check (hirage.current_role_is_admin());

-- Resume documents, chunks, rankings and explanations are admin-only reads.
-- Candidates never see another candidate's resume or where they ranked.
create policy documents_admin_read on hirage.documents
  for select using (hirage.current_role_is_admin());

create policy chunks_admin_read on hirage.chunks
  for select using (hirage.current_role_is_admin());

create policy resumes_admin_read on hirage.resumes
  for select using (hirage.current_role_is_admin());

create policy rankings_admin_read on hirage.rankings
  for select using (hirage.current_role_is_admin());

create policy ranking_items_admin_read on hirage.ranking_items
  for select using (hirage.current_role_is_admin());

create policy explanations_admin_read on hirage.explanations
  for select using (hirage.current_role_is_admin());

create policy shortlists_admin_read on hirage.shortlists
  for select using (hirage.current_role_is_admin());

create policy pipeline_jobs_admin_read on hirage.pipeline_jobs
  for select using (hirage.current_role_is_admin());

-- applications: a candidate manages their own; admins read all.
create policy applications_select on hirage.applications
  for select using (candidate_id = auth.uid() or hirage.current_role_is_admin());

create policy applications_insert_self on hirage.applications
  for insert with check (candidate_id = auth.uid());

create policy applications_update_self on hirage.applications
  for update using (candidate_id = auth.uid())
  with check (candidate_id = auth.uid());

-- notifications: one way. The recipient can read them and nothing else. There
-- is no client insert or update policy, so nobody can send or alter a message.
create policy notifications_select_own on hirage.notifications
  for select using (recipient_id = auth.uid());

-- ---------------------------------------------------------------- storage ----

insert into storage.buckets (id, name, public)
values ('resumes', 'resumes', false), ('job-descriptions', 'job-descriptions', false)
on conflict (id) do nothing;

-- Uploads are performed server side with the service key, so the only client
-- grant needed is admin read for previewing a stored file.
create policy hirage_storage_admin_read on storage.objects
  for select using (
    bucket_id in ('resumes', 'job-descriptions') and hirage.current_role_is_admin()
  );

-- ----------------------------------------------------------------- grants ----

-- A new schema grants the API roles nothing at all, and even in `public` the
-- Supabase defaults exclude DML. PostgreSQL checks the grant before it consults
-- a policy, so without this block every RLS policy above would be unreachable.
-- These grants are the ceiling; the policies narrow each role to its own rows.

grant usage on schema hirage to anon, authenticated, service_role;

-- The worker and the server-side admin paths run as service_role, which
-- bypasses RLS but still needs ordinary table privileges.
grant select, insert, update, delete on all tables in schema hirage to service_role;
grant usage, select on all sequences in schema hirage to service_role;

-- A signed-in user reads through RLS. Writes are limited to their own profile,
-- their own applications, and marking their own messages read.
grant select on
  hirage.profiles,
  hirage.jobs,
  hirage.documents,
  hirage.chunks,
  hirage.resumes,
  hirage.rankings,
  hirage.ranking_items,
  hirage.explanations,
  hirage.shortlists,
  hirage.pipeline_jobs
to authenticated;

grant update on hirage.profiles to authenticated;
grant select, insert, update on hirage.applications to authenticated;
grant select on hirage.notifications to authenticated;

-- Signed-out visitors only ever see the auth pages.
revoke all on all tables in schema hirage from anon;

-- Pipeline functions belong to the worker alone.
revoke execute on function hirage.claim_pipeline_job() from public;
grant execute on function hirage.claim_pipeline_job() to service_role;

revoke execute on function hirage.rank_job_pool(uuid, public.vector) from public;
grant execute on function hirage.rank_job_pool(uuid, public.vector) to service_role;
