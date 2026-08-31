-- Make the auth trigger unable to break the application it shares a table with.
--
-- `on_auth_user_confirmed` fires on `auth.users`, which this project shares with
-- another application. A trigger raising an exception aborts the transaction
-- that fired it, so any failure inserting a HiRAGe profile would have blocked
-- that application's sign up or email confirmation outright.
--
-- Two concrete ways it could have fired:
--   * `hirage.profiles.email` is NOT NULL, but `auth.users.email` is nullable
--     for phone-only or some OAuth accounts. There are none today, but adding
--     one would have failed the insert.
--   * `hirage.profiles.email` is UNIQUE, so an address colliding with an
--     existing HiRAGe profile would have failed the insert.
--
-- HiRAGe losing a profile row is recoverable: migration 0002 is re-runnable and
-- backfills anything missed. Blocking another application's authentication is
-- not. The failure is therefore logged and swallowed.

create or replace function hirage.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = hirage, public
as $$
begin
  -- No address means nothing HiRAGe could route a shortlist notification to.
  if new.email is null then
    return new;
  end if;

  insert into hirage.profiles (id, email, role)
  values (
    new.id,
    new.email,
    case when hirage.is_super_admin_email(new.email) then 'admin'::hirage.user_role
         else 'candidate'::hirage.user_role end
  )
  on conflict (id) do nothing;

  return new;
exception
  when others then
    raise warning 'hirage.handle_new_user skipped for %: %', new.id, sqlerrm;
    return new;
end;
$$;
