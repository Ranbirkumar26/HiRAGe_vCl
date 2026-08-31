-- Backfill HiRAGe profiles for accounts that already existed.
--
-- `on_auth_user_confirmed` only fires on a new confirmation, so every account
-- created before HiRAGe was installed would sign in successfully and then find
-- no profile, which reads to the app as "not signed in". This project shares
-- `auth.users` with another application, so those accounts are real users who
-- must be able to reach the candidate portal, and the fixed super admin address
-- must arrive already holding the admin role.
--
-- Written to be safely re-runnable.

insert into hirage.profiles (id, email, role)
select u.id,
       u.email,
       case when hirage.is_super_admin_email(u.email) then 'admin'::hirage.user_role
            else 'candidate'::hirage.user_role end
  from auth.users u
 where u.email_confirmed_at is not null
   and u.email is not null
on conflict (id) do nothing;
