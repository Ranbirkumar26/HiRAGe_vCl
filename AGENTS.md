# HiRAGe project notes

Read this before asking questions it already answers. See `README.md` for setup
and for how the pipeline and its caches work.

## Decision log

**Stack: Next.js 15 + Supabase + Gemini + a Node worker.** Chosen over a split
Next/FastAPI deployment because Supabase Auth already delivers the confirmation
and reset emails the spec requires, and `pgvector` keeps vectors next to the
rows they belong to. Parsing quality in pure JS (`unpdf`, `mammoth`) proved
sufficient and avoids running a second language runtime.

**Job queue in Postgres, not Edge Functions.** Edge Functions cap out around 150
seconds; a 1,200 document parse does not fit. A `pipeline_jobs` table plus
`claim_pipeline_job` (`FOR UPDATE SKIP LOCKED`) gives at-most-once claiming and
lets several workers share the queue if throughput ever needs it.

**Documents are content addressed.** `documents.content_hash` is unique across
the whole system, not per job. That is what makes an identical re-upload free,
and it means a resume submitted to two jobs is parsed and embedded once.

**Three separate cache keys.** Parse artefacts key on the file hash, rankings on
`(job, jd_version, pool_version)`, explanations on `(resume, jd_version)`. Every
invalidation rule in the spec then falls out of the keys rather than needing
explicit cache-busting code. `pool_version` is bumped by a trigger on insert or
delete of `resumes`, so it cannot be forgotten at a call site.

**Vectors are 768 dimensions**, sliced from `gemini-embedding-001`. Cosine
distance is scale invariant, so the shorter Matryoshka slice needs no
re-normalisation before storage, and the HNSW index stays small.

**Role escalation is blocked by a trigger, not a policy.** A policy on
`profiles` that compared the old role would have to read `profiles` and recurse.
The trigger allows the change only when `auth.uid()` is null, which is precisely
the service-key path used by the Access section.

**Candidates never read `shortlists`.** The Shortlisted marker in the
applications list is derived from the notification row instead. That keeps the
ranking and the shortlist table admin-only under RLS, and it matches the spec,
where the marker and the message always appear together.

**No job title field.** Section 3.2 lists description, company, recruiter name,
recruiter email and tags, so jobs are displayed by company and tags. Adding a
title would have been a feature the spec did not ask for.

**Legacy `.doc` is rejected, not parsed.** No reliable pure-JS extractor exists.
Ingesting it would produce garbage text that silently poisons the embeddings and
the ranking, so the upload is refused with a message telling the user to re-save
as `.docx` or PDF.

**Opting out removes the resume from the pool** and drops the job from the
applications list. The application row is retained with status `withdrawn` so a
re-application updates one row rather than accumulating history.

**Table grants are explicit.** Supabase's default privileges in `public` hand
the API roles only `TRUNCATE`, `REFERENCES` and `TRIGGER`, not DML. PostgreSQL
checks the grant before it ever consults a policy, so without the grant block at
the end of the migration every RLS policy would be unreachable and the app would
fail with `permission denied for table profiles` on its first page load. The
grants are the ceiling; the policies narrow each role to its own rows.

**`anon` gets nothing.** Every page requires a session, so the migration revokes
the default privileges from `anon` outright rather than relying on policies to
turn it away.

**HiRAGe has its own Supabase project.** It runs in `Hirage_claude`
(`onmchendtplhthfethvc`, ap-south-1), owned outright. Earlier iterations shared
a project with two other applications, which forced the `hirage` schema, a
profile backfill and a hardened auth trigger. The schema is kept because the
migrations are proven in that shape and re-targeting them to `public` would mean
editing four clients and every migration for no functional gain. The other
constraints are now historical, but the code that came out of them is sound and
stays.

**Migration `0005` exposes the schema.** PostgREST serves only schemas it is
told about, so `hirage` has to be added or every query returns PGRST106. Doing
it in a migration rather than the dashboard means a fresh project is correct
after `supabase db push` alone. It reads the existing list and appends, so it
cannot drop a schema something else depends on.

**`auth.users` is no longer shared.** On the dedicated project the user pool is
HiRAGe's alone, so `0002`'s backfill is a harmless no-op on a fresh database and
`0004`'s defensive trigger has nothing else to protect. Both are kept: they cost
nothing and the trigger hardening is correct regardless.

**Migration `0002` backfills profiles.** The confirmation trigger only fires on
new confirmations, so the ten accounts that already existed, including the fixed
super admin, would have signed in successfully and then been treated as signed
out because no profile row existed. This was caught by the deployment itself
rejecting a test insert for `rk26.ftw@gmail.com`, which revealed the account was
already present.

**Migration `0003` pins `search_path` on five functions.** Supabase's security
advisor flagged them. They are not SECURITY DEFINER, so the exposure was
limited, but `guard_profile_role` is what blocks self promotion and
`is_super_admin_email` is what decides who holds the admin role; neither should
resolve objects through a caller-controlled path.

**`vector` stays in `public`.** The advisor recommends moving it, but the
resident app's `document_chunks` and `match_chunks` depend on it there. HiRAGe
schema-qualifies its own use instead: `public.vector(768)` and
`OPERATOR(public.<=>)`.

**Migration `0004` stops the auth trigger breaking the resident app.** A trigger
that raises aborts the transaction that fired it, so a failed HiRAGe profile
insert would have blocked the other application's sign up on a table both share.
Two paths could reach it: `hirage.profiles.email` is NOT NULL while
`auth.users.email` is nullable for phone-only accounts, and it is UNIQUE so a
colliding address would fail. Losing a HiRAGe profile is recoverable, since
`0002` is re-runnable; blocking someone else's authentication is not. The insert
now swallows and logs its own failures.

## Verified against a real database

`supabase/migrations/0001_init.sql` was applied to a local Supabase stack and
exercised, not just written:

- Confirming a user creates the profile; an unconfirmed sign up creates none;
  confirming later creates it. `rk26.ftw@gmail.com` lands as admin.
- `pool_version` bumps on both insert and delete of a pool entry.
- `rank_job_pool` orders a two-resume pool correctly (exact match scores 1.0).
- `claim_pipeline_job` marks the task running and leaves nothing claimable; a
  second live run of the same kind is refused by the partial unique index.
- A signed-in user cannot change their own role but can edit their own profile;
  the service key can grant the role.
- A candidate session sees only its own profile, application and message, and
  zero rows in `resumes`, `documents`, `chunks`, `rankings` and `shortlists`.
  An admin session sees the pool.

The PDF and `.docx` parsers were run against real files, and `extractEmail` has
its own case table. That run caught a defect: the placeholder-domain filter
returned null when every address on a resume was a placeholder, discarding the
only contact the resume had. It now falls back to the first address found.

The same checks were then re-run against the hosted project after deployment:
role assignment and the confirmation gate, `pool_version` bumps, `rank_job_pool`
ordering, queue claiming and the single-active-run index, and RLS isolation (a
candidate session sees 1 of 10 profiles, 1 job, and zero rows in `resumes`,
`documents`, `chunks`, `rankings`, `shortlists` and `pipeline_jobs`). The
anonymous role is refused on every HiRAGe table. All test rows were removed
afterwards and the resident app's row counts were confirmed unchanged.

**Pros are not forced.** The response schema originally required at least two
pros. The first full run exposed what that produces: a frontend candidate ranked
third was credited with "holds a Senior Frontend Engineer title, aligning with
the Senior AI Engineer role". That is manufactured evidence, and the spec calls
explainability a primary requirement. `minItems` on pros is now 0 and the prompt
forbids inventing one. Re-tested against the same resume: zero pros, four
grounded cons.

## Gemini free-tier quota

Embedding and generation have separate free-tier quotas, and the embedding one
is the binding constraint: `EmbedContentRequestsPerDayPerProjectPerModel`,
1,000 requests per day per Google Cloud project per model. It counts requests,
not chunks, which is why `embedBatched` packs 64 chunks per call. A full 1,200
resume pool at roughly four chunks each is about 75 requests, so the cap is not
a problem for the design.

It was hit during the first live end-to-end run anyway, because the key's
project had already spent the day's allowance elsewhere. Generation quota was
unaffected. If this recurs, either wait for the reset (midnight Pacific) or use
a key from a different Google Cloud project.

The failure was contained exactly as the caching design intends: all three
resumes were parsed, chunked, embedded and stored before the job description
embedding failed, so a re-run repeats none of that work and needs a single
embedding call.

**Revoking the admin role was added on request.** Section 3.4 specifies granting
only. Revoking was asked for explicitly, so `revokeAdminAction` returns an
account to `candidate`. It is gated by `requireSuperAdmin` like granting, and it
refuses the fixed super admin address: removing that role would leave nobody able
to grant it back, and the confirmation trigger would restore it on the next
sign in anyway. Verified as a round trip: candidate to admin to candidate, with
the super admin's own role untouched.

## Deferred features

- Enable leaked password protection in Supabase Auth. The advisor flags it as
  off. It is a project-level setting that would also apply to the resident
  application's users, so it was left for the owner to turn on.
- Move HiRAGe to its own Supabase project once a free slot is available, which
  would also separate the user pool.

Recorded in the user's own words, not rejected:

- "Freeze: the job remains visible in the portal but can no longer be applied
  to." Only freezing is specified, so there is no unfreeze control. If a job
  should be reopened later, that needs to be added deliberately.
- OCR for scanned image PDFs. The spec says PDF and Word must parse reliably;
  documents with no text layer currently fail per document and are surfaced in
  the resume pool table.
- Read and unread state for candidate messages. `notifications.read_at` exists
  in the schema but nothing in the spec asks for a read indicator, so no UI
  reads or writes it.
- Pagination for the resume pool table. It shows the 200 most recent of up to
  1,200 and states the total.

## Conventions

- Server actions live in `src/lib/actions`, one module per role, and every one
  of them re-checks the role via `src/lib/auth/session.ts` before touching the
  service-role client.
- The service-role client is only ever imported from files that already ran a
  role check. Anything a user is allowed to see is read through the RLS-bound
  client in `src/lib/supabase/server.ts`.
- Colour is expressed through the CSS variables in `src/app/globals.css`. The
  palette is green, blue, white and black in both themes; components reference
  the semantic tokens, never raw hex.
