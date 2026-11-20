-- The caller's own profile (phase 3: auth context / app shell).
--
-- Browsers can't see profiles.auth_user_id (column grants), so they can't tell
-- which row of profile_directory is theirs. This returns exactly that row, or
-- no row at all when the login isn't linked to a profile yet (the UI then
-- shows "Your account isn't linked yet").
--
-- SECURITY INVOKER on purpose: app.current_profile_id() (SECURITY DEFINER)
-- does the auth_user_id lookup, and the profile_directory view still applies
-- the profiles RLS policies for the caller. No auth_user_id is returned.

create function public.my_profile()
returns setof public.profile_directory
language sql
stable
security invoker
set search_path = ''
as $$
  select d.*
  from public.profile_directory d
  where d.id = app.current_profile_id();
$$;

comment on function public.my_profile() is
  'The logged-in caller''s own profile (no auth_user_id); no row when the login is not linked to a profile.';

revoke execute on function public.my_profile() from public, anon;
grant execute on function public.my_profile() to authenticated, service_role;
