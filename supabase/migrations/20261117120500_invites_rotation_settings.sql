-- Invites (plan 7: tables only), rotation inputs (plan 6: tables only; the
-- standings view comes in phase 9), settings and rate limits.

-- ---------------------------------------------------------------------------
-- Invites. Only the SHA-256 hash of the token is stored. Created and claimed
-- by Edge Functions (secret key); the admin can list and revoke.
-- ---------------------------------------------------------------------------

create table public.invites (
  id uuid primary key default gen_random_uuid(),
  token_hash bytea not null unique
    constraint invites_token_hash_sha256 check (octet_length(token_hash) = 32),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '14 days'),
  used_at timestamptz,
  revoked_at timestamptz,
  constraint invites_expiry_after_creation check (expires_at > created_at)
);

comment on table public.invites is
  'Single-use, 14-day, revocable invite links. Only the SHA-256 hash of the token is stored.';

-- One open (unused, unrevoked) invite per profile. Expiry can't be part of an
-- index predicate, so invite-create revokes an expired one before re-issuing.
create unique index invites_one_open_per_profile on public.invites (profile_id)
  where used_at is null and revoked_at is null;

create function app.invites_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target record;
begin
  if tg_op = 'INSERT' then
    select p.is_system, p.is_claimed, p.colour into target
    from public.profiles p where p.id = new.profile_id;
    if target.is_system then
      raise exception 'System profiles cannot be invited' using errcode = '23514';
    end if;
    if target.is_claimed then
      raise exception 'This profile has already been claimed' using errcode = '23514';
    end if;
    if target.colour is null then
      raise exception 'Set the person''s colour before creating an invite' using errcode = '23514';
    end if;
    return new;
  end if;

  -- UPDATE from a browser (admin): only revoking is allowed.
  if not app.is_privileged() then
    if new.id <> old.id
      or new.token_hash <> old.token_hash
      or new.profile_id <> old.profile_id
      or new.created_by is distinct from old.created_by
      or new.created_at <> old.created_at
      or new.expires_at <> old.expires_at
      or new.used_at is distinct from old.used_at
      or (old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at)
      or new.revoked_at is null then
      raise exception 'Invites can only be revoked here'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger invites_guard
  before insert or update on public.invites
  for each row execute function app.invites_guard();

alter table public.invites enable row level security;

create policy invites_select_admin on public.invites
  for select to authenticated
  using ((select app.is_admin()));

create policy invites_update_admin on public.invites
  for update to authenticated
  using ((select app.is_admin()))
  with check ((select app.is_admin()));

-- No insert/delete policies: invite-create and invite-claim use the secret key.
revoke all on public.invites from anon, authenticated;
grant select, update on public.invites to authenticated;

-- ---------------------------------------------------------------------------
-- Rotation inputs (plan 6). Points are computed, not stored.
-- ---------------------------------------------------------------------------

-- Browsers can't forge who recorded a rotation input. SECURITY INVOKER on
-- purpose (app.is_privileged()).
create function app.rotation_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_table_name in ('rotation_adjustments', 'rotation_passes') then
    perform app.assert_not_system_profile(new.profile_id);
  end if;
  if not app.is_privileged() then
    if tg_table_name = 'rotation_next' then
      new.decided_by := app.current_profile_id();
    elsif tg_op = 'INSERT' then
      new.created_by := app.current_profile_id();
      new.created_at := now();
    else
      -- The original author stays on record (shown in the rotation history).
      new.created_by := old.created_by;
      new.created_at := old.created_at;
    end if;
  end if;
  return new;
end;
$$;

-- Adjustments: starting values (set_to), corrections (delta), clearing an
-- owed turn. Staff only (decision N4).
create table public.rotation_adjustments (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles (id) on delete restrict,
  delta integer,
  set_to integer
    constraint rotation_adjustments_set_to_nonnegative check (set_to >= 0),
  clear_owed_turn boolean not null default false,
  reason text
    constraint rotation_adjustments_reason_length check (char_length(reason) <= 500),
  effective_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint rotation_adjustments_one_kind check (
    num_nonnulls(delta, set_to) <= 1
    and (delta is not null or set_to is not null or clear_owed_turn)
  )
);

comment on table public.rotation_adjustments is
  'Manual rotation changes by staff: starting values (set_to), corrections (delta), clearing an owed turn.';

create index rotation_adjustments_profile_effective_idx
  on public.rotation_adjustments (profile_id, effective_at);

create trigger rotation_adjustments_guard
  before insert or update on public.rotation_adjustments
  for each row execute function app.rotation_guard();

-- Passes: "I can't make that week" (week = Monday of a Mon–Sun week).
create table public.rotation_passes (
  week_start date not null
    constraint rotation_passes_week_start_monday check (extract(isodow from week_start) = 1),
  profile_id uuid not null references public.profiles (id) on delete restrict,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (week_start, profile_id)
);

create index rotation_passes_profile_id_idx on public.rotation_passes (profile_id);

create trigger rotation_passes_guard
  before insert or update on public.rotation_passes
  for each row execute function app.rotation_guard();

-- Next-chooser decisions recorded by staff (tie-breaks, Democrático).
create table public.rotation_next (
  week_start date primary key
    constraint rotation_next_week_start_monday check (extract(isodow from week_start) = 1),
  profile_id uuid not null references public.profiles (id) on delete restrict,
  decided_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index rotation_next_profile_id_idx on public.rotation_next (profile_id);

create trigger rotation_next_guard
  before insert or update on public.rotation_next
  for each row execute function app.rotation_guard();

create trigger rotation_next_set_updated_at
  before update on public.rotation_next
  for each row execute function app.set_updated_at();

alter table public.rotation_adjustments enable row level security;
alter table public.rotation_passes enable row level security;
alter table public.rotation_next enable row level security;

create policy rotation_adjustments_select_members on public.rotation_adjustments
  for select to authenticated
  using ((select app.current_role()) is not null);
create policy rotation_adjustments_insert_staff on public.rotation_adjustments
  for insert to authenticated
  with check ((select app.is_staff()));
create policy rotation_adjustments_update_staff on public.rotation_adjustments
  for update to authenticated
  using ((select app.is_staff()))
  with check ((select app.is_staff()));
create policy rotation_adjustments_delete_staff on public.rotation_adjustments
  for delete to authenticated
  using ((select app.is_staff()));

create policy rotation_passes_select_members on public.rotation_passes
  for select to authenticated
  using ((select app.current_role()) is not null);
create policy rotation_passes_insert_own_or_staff on public.rotation_passes
  for insert to authenticated
  with check (
    (profile_id = (select app.current_profile_id()) and (select app.can_write()))
    or (select app.is_staff())
  );
create policy rotation_passes_delete_own_or_staff on public.rotation_passes
  for delete to authenticated
  using (
    (profile_id = (select app.current_profile_id()) and (select app.can_write()))
    or (select app.is_staff())
  );

create policy rotation_next_select_members on public.rotation_next
  for select to authenticated
  using ((select app.current_role()) is not null);
create policy rotation_next_insert_staff on public.rotation_next
  for insert to authenticated
  with check ((select app.is_staff()));
create policy rotation_next_update_staff on public.rotation_next
  for update to authenticated
  using ((select app.is_staff()))
  with check ((select app.is_staff()));
create policy rotation_next_delete_staff on public.rotation_next
  for delete to authenticated
  using ((select app.is_staff()));

revoke all on public.rotation_adjustments, public.rotation_passes, public.rotation_next from anon, authenticated;
grant select, insert, update, delete on public.rotation_adjustments, public.rotation_next to authenticated;
grant select, insert, delete on public.rotation_passes to authenticated;

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------

create table public.app_settings (
  key text primary key
    constraint app_settings_key_format check (key ~ '^[a-z][a-z0-9_]{0,62}$'),
  value jsonb not null,
  updated_at timestamptz not null default now()
);

comment on table public.app_settings is 'Club-wide settings, e.g. rotation_epoch (go-live date). Admin-writable.';

create trigger app_settings_set_updated_at
  before update on public.app_settings
  for each row execute function app.set_updated_at();

alter table public.app_settings enable row level security;

create policy app_settings_select_members on public.app_settings
  for select to authenticated
  using ((select app.current_role()) is not null);
create policy app_settings_insert_admin on public.app_settings
  for insert to authenticated
  with check ((select app.is_admin()));
create policy app_settings_update_admin on public.app_settings
  for update to authenticated
  using ((select app.is_admin()))
  with check ((select app.is_admin()));
create policy app_settings_delete_admin on public.app_settings
  for delete to authenticated
  using ((select app.is_admin()));

revoke all on public.app_settings from anon, authenticated;
grant select, insert, update, delete on public.app_settings to authenticated;

-- Per-person UI preferences. Private to their owner; viewers keep theirs in
-- localStorage (they can't write).
create table public.user_settings (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  theme text
    constraint user_settings_theme check (theme in ('superman', 'batman', 'letterboxd')),
  films_view text
    constraint user_settings_films_view check (films_view in ('list', 'posters')),
  updated_at timestamptz not null default now()
);

create trigger user_settings_set_updated_at
  before update on public.user_settings
  for each row execute function app.set_updated_at();

alter table public.user_settings enable row level security;

create policy user_settings_select_own on public.user_settings
  for select to authenticated
  using (profile_id = (select app.current_profile_id()));
create policy user_settings_insert_own on public.user_settings
  for insert to authenticated
  with check (profile_id = (select app.current_profile_id()) and (select app.can_write()));
create policy user_settings_update_own on public.user_settings
  for update to authenticated
  using (profile_id = (select app.current_profile_id()) and (select app.can_write()))
  with check (profile_id = (select app.current_profile_id()) and (select app.can_write()));
create policy user_settings_delete_own on public.user_settings
  for delete to authenticated
  using (profile_id = (select app.current_profile_id()) and (select app.can_write()));

revoke all on public.user_settings from anon, authenticated;
grant select, insert, update, delete on public.user_settings to authenticated;

-- ---------------------------------------------------------------------------
-- Rate limits for Edge Functions. Secret key only: RLS on, no policies, no
-- grants to browser roles.
-- ---------------------------------------------------------------------------

create table public.rate_limits (
  bucket text not null,
  subject text not null,
  window_start timestamptz not null,
  count integer not null default 0
    constraint rate_limits_count_nonnegative check (count >= 0),
  primary key (bucket, subject, window_start)
);

alter table public.rate_limits enable row level security;
revoke all on public.rate_limits from anon, authenticated;

revoke execute on all functions in schema app from public;
grant execute on all functions in schema app to authenticated, service_role;
