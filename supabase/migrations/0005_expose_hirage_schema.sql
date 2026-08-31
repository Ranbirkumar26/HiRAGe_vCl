-- Expose the `hirage` schema to PostgREST.
--
-- PostgREST only serves schemas it has been told about, so without this every
-- query returns PGRST106 "Invalid schema: hirage". Doing it here rather than in
-- the dashboard makes it reproducible: a fresh project gets it from the
-- migration rather than from someone remembering to tick a box.
--
-- The existing list is read and appended to rather than overwritten, so this
-- cannot silently drop a schema another application relies on, and it is a
-- no-op when `hirage` is already present.

do $$
declare
  current_schemas text;
begin
  select split_part(cfg, '=', 2)
    into current_schemas
    from (select unnest(rolconfig) as cfg from pg_roles where rolname = 'authenticator') t
   where cfg like 'pgrst.db_schemas=%';

  current_schemas := coalesce(current_schemas, 'public, graphql_public');

  if position('hirage' in current_schemas) = 0 then
    execute format(
      'alter role authenticator set pgrst.db_schemas = %L',
      current_schemas || ', hirage'
    );
  end if;
end
$$;

notify pgrst, 'reload config';
notify pgrst, 'reload schema';
