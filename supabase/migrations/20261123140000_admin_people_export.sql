-- Phase 12 (plan 9 Admin; decisions A1, A2).
--
-- A2 "Remove login": the admin-remove-login Edge Function checks the caller
-- is an admin, calls profile_remove_login() below (checks + revokes the
-- person's open link), then deletes the auth user with auth.admin.deleteUser.
-- profiles.auth_user_id is `on delete set null`, so the profile and all its
-- history (films, attendance, scores, comments, rotation) stay; deleting the
-- auth user also deletes its sessions, so its tokens get nothing (S1).
--
-- A1 "Export all data": export_data(), admins only.

-- When a login goes (auth user deleted), the profile is unclaimed again, so
-- it can be re-invited and claimed_at doesn't claim a login that's gone.
-- Runs after profiles_guard (trigger names fire in alphabetical order).
create function app.profiles_unclaim()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.auth_user_id is null then
    new.claimed_at := null;
  end if;
  return new;
end;
$$;

create trigger profiles_unclaim
  before update of auth_user_id on public.profiles
  for each row execute function app.profiles_unclaim();

-- ---------------------------------------------------------------------------
-- admin-remove-login (secret key only). Returns the login to delete. Refuses
-- (errcode + hint the function maps to a message): unknown person (23503),
-- no login / system profile (23514, hint no_login), the admin's own login
-- (42501, hint self), a caller who isn't an admin with a login (42501, hint
-- forbidden). Together these protect the last admin: the caller is an admin
-- with a login and can't remove their own, so one always remains. The
-- profile stays claimed until the auth user is deleted, so a failed delete
-- can simply be retried.
-- ---------------------------------------------------------------------------

create function public.profile_remove_login(p_profile_id uuid, p_admin_id uuid)
returns uuid
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  target record;
begin
  -- profiles_guard's lock: a demotion of the caller can't slip in meanwhile.
  perform pg_advisory_xact_lock(hashtext('public.profiles:admins'));
  if not exists (
    select 1 from public.profiles p
    where p.id = p_admin_id and p.role = 'admin' and p.auth_user_id is not null
  ) then
    raise exception 'Only an admin can remove a login' using errcode = '42501', hint = 'forbidden';
  end if;
  select p.auth_user_id, p.role, p.is_system into target
  from public.profiles p where p.id = p_profile_id
  for update;
  if not found then
    raise exception 'No such person' using errcode = '23503';
  end if;
  if p_profile_id = p_admin_id then
    raise exception 'You cannot remove your own login' using errcode = '42501', hint = 'self';
  end if;
  if target.is_system or target.auth_user_id is null then
    raise exception 'This person has no login' using errcode = '23514', hint = 'no_login';
  end if;
  update public.invites set revoked_at = now()
  where profile_id = p_profile_id and used_at is null and revoked_at is null;
  return target.auth_user_id;
end;
$$;

revoke execute on function public.profile_remove_login(uuid, uuid) from public, anon, authenticated;
grant execute on function public.profile_remove_login(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- export_data(): one JSON value with every table needed to rebuild the club's
-- data, admins only (plan 5 "Export all data": admin RPC). One value, not
-- rows, so PostgREST's max-rows limit (1,000) never truncates it.
--
-- Left out on purpose: auth ids and emails (profiles come from the
-- profile_directory columns), invites (token hashes; links are short-lived
-- and re-issued), rate_limits. Columns keep their table order (json, not
-- jsonb). SECURITY DEFINER because user_settings rows are private to their
-- owner; the admin check comes first.
-- ---------------------------------------------------------------------------

create function public.export_data()
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  tables json;
begin
  if not app.is_admin() then
    raise exception 'Only the admin can export the data' using errcode = '42501';
  end if;
  tables := json_build_object(
    'profiles', (select coalesce(json_agg(t order by t.created_at, t.id), '[]') from (
      select id, display_name, sheet_keyword, colour, role, is_claimed, claimed_at, is_system,
             created_at, updated_at
      from public.profiles) t),
    'films', (select coalesce(json_agg(t order by t.id), '[]') from public.films t),
    'attendance', (select coalesce(json_agg(t order by t.film_id, t.profile_id), '[]') from public.attendance t),
    'scores', (select coalesce(json_agg(t order by t.film_id, t.profile_id), '[]') from public.scores t),
    'comments', (select coalesce(json_agg(t order by t.id), '[]') from public.comments t),
    'rotation_adjustments', (select coalesce(json_agg(t order by t.effective_at, t.id), '[]') from public.rotation_adjustments t),
    'rotation_passes', (select coalesce(json_agg(t order by t.week_start, t.profile_id), '[]') from public.rotation_passes t),
    'rotation_next', (select coalesce(json_agg(t order by t.week_start), '[]') from public.rotation_next t),
    'app_settings', (select coalesce(json_agg(t order by t.key), '[]') from public.app_settings t),
    'user_settings', (select coalesce(json_agg(t order by t.profile_id), '[]') from public.user_settings t)
  );
  return json_build_object(
    'format', 'film-club-export',
    'exported_at', now(),
    -- The newest migration applied: the schema these rows fit.
    'schema_version', (select max(m.version) from supabase_migrations.schema_migrations m),
    'row_counts', (select json_object_agg(k, json_array_length(v)) from json_each(tables) e (k, v)),
    'tables', tables
  );
end;
$$;

revoke execute on function public.export_data() from public, anon;
grant execute on function public.export_data() to authenticated;
