-- Phase 12 (plan 9 Admin; decisions A1, A2, A4, P1).
--
-- A2 "Remove login": the admin-remove-login Edge Function checks the caller
-- is an admin and calls profile_remove_login() below, which (under the admins
-- lock, in one transaction) unlinks the person from their login, makes an
-- admin or moderator a member (A4) and revokes their open link; the function
-- then deletes the auth user with auth.admin.deleteUser (its sessions go with
-- it). The profile and all its history (films, attendance, scores, comments,
-- rotation) stay; profiles.auth_user_id is `on delete set null` anyway.
--
-- P1: system profiles (Cinema, Sheet archive) are read-only for browsers and
-- never count as admins. A claimed profile can't lose its colour.
--
-- A1 "Export all data": export_data(), admins only.

-- ---------------------------------------------------------------------------
-- profiles_guard (migration 20261117120100) plus: system profiles can't be
-- updated or deleted from a browser (admin included), and a colour can't be
-- cleared while the profile has a login.
-- ---------------------------------------------------------------------------

create or replace function app.profiles_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  me uuid := app.current_profile_id();
begin
  if tg_op = 'DELETE' then
    if not app.is_privileged() and old.is_system then
      raise exception 'System profiles cannot be changed'
        using errcode = '42501';
    end if;
    if not app.is_privileged() and old.id = me then
      raise exception 'You cannot delete your own profile'
        using errcode = '42501';
    end if;
    if old.role = 'admin' then
      perform pg_advisory_xact_lock(hashtext('public.profiles:admins'));
      if app.other_admin_count(old.id) = 0 then
        raise exception 'The last admin cannot be removed'
          using errcode = '42501';
      end if;
    end if;
    return old;
  end if;

  new.colour := lower(new.colour);

  if not app.is_privileged() then
    if tg_op = 'INSERT' then
      if new.auth_user_id is not null or new.claimed_at is not null or new.is_system then
        raise exception 'auth_user_id, claimed_at and is_system are set by the invite flow or the import only'
          using errcode = '42501';
      end if;
    else
      if old.is_system then
        raise exception 'System profiles cannot be changed'
          using errcode = '42501';
      end if;
      if new.id <> old.id
        or new.auth_user_id is distinct from old.auth_user_id
        or new.claimed_at is distinct from old.claimed_at
        or new.is_system <> old.is_system
        or new.created_at <> old.created_at then
        raise exception 'id, auth_user_id, claimed_at, is_system and created_at cannot be changed here'
          using errcode = '42501';
      end if;
      if (new.role, new.colour, new.sheet_keyword) is distinct from (old.role, old.colour, old.sheet_keyword)
        and not app.is_admin() then
        raise exception 'Only the admin can change role, colour or sheet keyword'
          using errcode = '42501';
      end if;
      if new.role <> old.role and old.id = me then
        raise exception 'Admins cannot change their own role'
          using errcode = '42501';
      end if;
    end if;
  end if;

  -- A colour is how the club tells people apart: someone with a login keeps one.
  if tg_op = 'UPDATE' and new.colour is null and old.colour is not null
    and new.auth_user_id is not null then
    raise exception 'A person with a login needs a colour'
      using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' and old.role = 'admin' and new.role <> 'admin' then
    perform pg_advisory_xact_lock(hashtext('public.profiles:admins'));
    if app.other_admin_count(old.id) = 0 then
      raise exception 'The last admin cannot be demoted'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

-- System profiles are never admins that count (they can't log in anyway).
create or replace function app.other_admin_count(excluding uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.profiles p
  where p.role = 'admin'
    and not p.is_system
    and p.id is distinct from excluding;
$$;

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
-- admin-remove-login (secret key only). Under the admins lock, in one
-- transaction: checks, revokes the person's open link, unlinks their login
-- (profiles_unclaim clears claimed_at) and makes an admin or moderator a
-- member (A4). Returns the auth user to delete. Refuses (errcode + hint the
-- function maps to a message): unknown person (23503), no login / system
-- profile (23514, hint no_login), the admin's own login (42501, hint self), a
-- caller who isn't (any more) an admin with a login (42501, hint forbidden).
--
-- The guarantee: every removal is made by an admin who still has a login
-- when the lock is taken, and removes someone else, so it never leaves zero
-- admins with a login. Two admins removing each other at once queue on the
-- lock; the second finds its caller already unlinked and is refused.
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
  -- profiles_guard's lock: removals and demotions queue up behind each other.
  perform pg_advisory_xact_lock(hashtext('public.profiles:admins'));
  if not exists (
    select 1 from public.profiles p
    where p.id = p_admin_id and p.role = 'admin' and p.auth_user_id is not null and not p.is_system
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
  update public.profiles p
  set auth_user_id = null,
      role = case when p.role in ('admin', 'moderator') then 'member' else p.role end
  where p.id = p_profile_id;
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
  version text;
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
  -- The newest migration applied: the schema these rows fit (null if the
  -- CLI's table isn't there, so the backup never fails over it).
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    execute 'select max(version) from supabase_migrations.schema_migrations' into version;
  end if;
  return json_build_object(
    'format', 'film-club-export',
    'exported_at', now(),
    'schema_version', version,
    'row_counts', (select json_object_agg(k, json_array_length(v)) from json_each(tables) e (k, v)),
    'tables', tables
  );
end;
$$;

revoke execute on function public.export_data() from public, anon;
grant execute on function public.export_data() to authenticated;
