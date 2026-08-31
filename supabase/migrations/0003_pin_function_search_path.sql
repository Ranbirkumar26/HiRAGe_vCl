-- Pin search_path on the functions that did not already set one.
--
-- These run with the caller's privileges rather than SECURITY DEFINER, so the
-- exposure is smaller than it would otherwise be, but two of them make security
-- decisions: `guard_profile_role` is what blocks self promotion, and
-- `is_super_admin_email` is what decides who arrives holding the admin role.
-- A caller controlling search_path could otherwise shadow the objects they
-- resolve. `hirage, public` is used because the pgvector type and its operators
-- live in `public` on this project.

alter function hirage.is_super_admin_email(text) set search_path = hirage, public;
alter function hirage.bump_pool_version()        set search_path = hirage, public;
alter function hirage.claim_pipeline_job()       set search_path = hirage, public;
alter function hirage.guard_profile_role()       set search_path = hirage, public;
alter function hirage.rank_job_pool(uuid, public.vector) set search_path = hirage, public;
