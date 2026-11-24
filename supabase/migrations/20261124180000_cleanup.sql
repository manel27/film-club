-- Phase 15 cleanup. Additive only: one nullable column, replaced functions,
-- the profile_directory view gains a column at its end.
--
-- 1. profiles.login_removed_at: when the person's login was last removed
--    (admin-remove-login, or the auth user deleted), so Admin -> People can
--    tell "login removed" from "never invited". Null for existing rows (no
--    history to recover). Set and cleared only by profiles_unclaim; browsers
--    have no insert/update grant on it (column-level grants, migration
--    20261117120100), so they can't write it.
-- 2. export_data() also returns each table's column names, so an empty
--    table's CSV still has its header line.

alter table public.profiles add column login_removed_at timestamptz;

grant select (login_removed_at) on public.profiles to authenticated;

create or replace view public.profile_directory
with (security_invoker = true)
as
select id, display_name, sheet_keyword, colour, role, is_claimed, claimed_at, is_system, created_at,
       updated_at, login_removed_at
from public.profiles;

-- Same trigger as migration 20261123140000, plus login_removed_at: stamped
-- when a login goes, cleared when one is linked again.
create or replace function app.profiles_unclaim()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.auth_user_id is null then
    new.claimed_at := null;
    if old.auth_user_id is not null then
      new.login_removed_at := now();
    end if;
  else
    new.login_removed_at := null;
  end if;
  return new;
end;
$$;

-- Same as migration 20261123140000, plus profiles.login_removed_at and 'columns'.
create or replace function public.export_data()
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
             created_at, updated_at, login_removed_at
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
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    execute 'select max(version) from supabase_migrations.schema_migrations' into version;
  end if;
  return json_build_object(
    'format', 'film-club-export',
    'exported_at', now(),
    'schema_version', version,
    'row_counts', (select json_object_agg(k, json_array_length(v)) from json_each(tables) e (k, v)),
    -- Each table's columns in row order (attnum, as json_agg writes them);
    -- profiles is the select above, not the whole table (no auth_user_id).
    'columns', (select json_object_agg(k, case when k = 'profiles'
        then json_build_array('id', 'display_name', 'sheet_keyword', 'colour', 'role', 'is_claimed',
          'claimed_at', 'is_system', 'created_at', 'updated_at', 'login_removed_at')
        else (select json_agg(a.attname order by a.attnum) from pg_catalog.pg_attribute a
          where a.attrelid = format('public.%I', k)::regclass and a.attnum > 0 and not a.attisdropped)
        end) from json_object_keys(tables) k),
    'tables', tables
  );
end;
$$;
