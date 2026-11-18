-- Profiles (plan 4.2) and the role helpers every RLS policy uses (plan 3.2).
--
-- A profile id is NOT the auth user id: placeholder profiles for people from
-- the sheet exist before anyone logs in, and are linked to an auth user when
-- the invite is claimed (auth_user_id set by the invite-claim Edge Function).

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users (id) on delete set null,
  display_name text not null
    constraint profiles_display_name_length check (char_length(btrim(display_name)) between 1 and 50),
  sheet_keyword text unique
    constraint profiles_sheet_keyword_length check (char_length(sheet_keyword) between 1 and 20),
  colour char(7)
    constraint profiles_colour_hex check (colour ~ '^#[0-9a-f]{6}$'),
  role public.profile_role not null default 'member',
  is_claimed boolean generated always as (auth_user_id is not null) stored,
  claimed_at timestamptz,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- System profiles ("Cinema", "Sheet archive") can never log in.
  constraint profiles_system_cannot_login check (not is_system or auth_user_id is null)
);

comment on table public.profiles is
  'Club members, placeholders (unclaimed, no login yet) and system profiles (Cinema, Sheet archive).';
comment on column public.profiles.is_system is
  'System profiles (Cinema placeholder chooser, Sheet archive legacy-notes author): no login, not in rotation.';

-- Two people with the same name (ignoring case) would be confusing in pickers.
create unique index profiles_display_name_ci_key on public.profiles (lower(btrim(display_name)));

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- Role helpers. SECURITY DEFINER so they can read profiles regardless of RLS
-- (and without recursing into the profiles policies); fixed search_path.
-- ---------------------------------------------------------------------------

create function app.current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from public.profiles p
  where p.auth_user_id = auth.uid()
    and auth.uid() is not null;
$$;

-- Null when the caller is not logged in or has no profile: such callers get
-- nothing from any policy.
create function app.current_role()
returns public.profile_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
  from public.profiles p
  where p.auth_user_id = auth.uid()
    and auth.uid() is not null;
$$;

create function app.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(app.current_role() in ('admin', 'moderator'), false);
$$;

create function app.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(app.current_role() = 'admin', false);
$$;

-- Any logged-in role that may write anything at all (everyone but viewers).
create function app.can_write()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(app.current_role() in ('admin', 'moderator', 'member'), false);
$$;

create function app.other_admin_count(excluding uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.profiles p
  where p.role = 'admin'
    and p.id is distinct from excluding;
$$;

-- System profiles (Cinema, Sheet archive) are not people: they can't attend,
-- score, pass, be a Democrático turn-holder or be picked as next chooser.
create function app.assert_not_system_profile(profile uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.profiles p where p.id = profile and p.is_system) then
    raise exception 'System profiles (Cinema, Sheet archive) cannot be used here'
      using errcode = '23514';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Protected columns (plan 5: "Change roles, colours: admin; a trigger blocks
-- self-changes to role/colour and demoting the last admin").
--   * role, colour, sheet_keyword: admin only.
--   * an admin can't change their own role (no accidental self-lockout).
--   * auth_user_id, claimed_at, is_system: secret key / import only
--     (claiming happens in the invite-claim Edge Function).
--   * the last admin can't be demoted or deleted, by anyone.
-- SECURITY INVOKER on purpose: app.is_privileged() must see the caller's role.
-- ---------------------------------------------------------------------------

create function app.profiles_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  me uuid := app.current_profile_id();
begin
  if tg_op = 'DELETE' then
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

create trigger profiles_guard
  before insert or update or delete on public.profiles
  for each row execute function app.profiles_guard();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;

create policy profiles_select_members on public.profiles
  for select to authenticated
  using ((select app.current_role()) is not null);

create policy profiles_insert_admin on public.profiles
  for insert to authenticated
  with check ((select app.is_admin()));

create policy profiles_update_admin on public.profiles
  for update to authenticated
  using ((select app.is_admin()))
  with check ((select app.is_admin()));

-- Own display name (protected columns are guarded by the trigger above).
-- Viewers can't edit their own profile (plan 5).
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select app.current_profile_id()) and (select app.can_write()))
  with check (id = (select app.current_profile_id()) and (select app.can_write()));

create policy profiles_delete_admin on public.profiles
  for delete to authenticated
  using ((select app.is_admin()));

-- Column-level grants: browsers (every role, admin included) never see or
-- write auth_user_id, which links a profile to its login. Only the secret key
-- (invite-claim, admin-reset-link, the import) reads or sets it. Because of
-- this, `select *` on profiles is refused for browsers: read through the
-- profile_directory view below, or name the columns.
revoke all on public.profiles from anon, authenticated;
grant select (id, display_name, sheet_keyword, colour, role, is_claimed, claimed_at, is_system, created_at, updated_at)
  on public.profiles to authenticated;
grant insert (display_name, sheet_keyword, colour, role) on public.profiles to authenticated;
grant update (display_name, sheet_keyword, colour, role) on public.profiles to authenticated;
grant delete on public.profiles to authenticated;

-- Everything a browser may read about people, `select *`-friendly.
-- security_invoker: the profiles RLS policies apply to the caller.
create view public.profile_directory
with (security_invoker = true)
as
select id, display_name, sheet_keyword, colour, role, is_claimed, claimed_at, is_system, created_at, updated_at
from public.profiles;

comment on view public.profile_directory is
  'Profiles without auth_user_id (login links are secret-key only). Use this for reads in the UI.';

revoke all on public.profile_directory from anon, authenticated;
grant select on public.profile_directory to authenticated;

revoke execute on all functions in schema app from public;
grant execute on all functions in schema app to authenticated, service_role;
