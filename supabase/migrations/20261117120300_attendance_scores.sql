-- Attendance and scores (plan 4.2, 4.4, 5).

-- Shared: system profiles (Cinema, Sheet archive) are not people, so they
-- can't attend or score.
create function app.assert_not_system_profile(profile uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.profiles p where p.id = profile and p.is_system) then
    raise exception 'System profiles cannot attend or score films'
      using errcode = '23514';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Attendance: a row exists = present.
-- ---------------------------------------------------------------------------

create table public.attendance (
  film_id bigint not null references public.films (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete restrict,
  marked_by uuid references public.profiles (id) on delete set null,
  marked_at timestamptz not null default now(),
  primary key (film_id, profile_id)
);

comment on table public.attendance is 'A row means the person was present at the film''s screening.';

create index attendance_profile_id_idx on public.attendance (profile_id);

create function app.attendance_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform app.assert_not_system_profile(new.profile_id);
  if not app.is_privileged() then
    new.marked_by := app.current_profile_id();
    new.marked_at := now();
  end if;
  return new;
end;
$$;

create trigger attendance_guard
  before insert or update on public.attendance
  for each row execute function app.attendance_guard();

alter table public.attendance enable row level security;

create policy attendance_select_members on public.attendance
  for select to authenticated
  using ((select app.current_role()) is not null);

-- Own attendance: any role but viewer. Others' attendance: staff.
create policy attendance_insert_own_or_staff on public.attendance
  for insert to authenticated
  with check (
    (profile_id = (select app.current_profile_id()) and (select app.can_write()))
    or (select app.is_staff())
  );

create policy attendance_delete_own_or_staff on public.attendance
  for delete to authenticated
  using (
    (profile_id = (select app.current_profile_id()) and (select app.can_write()))
    or (select app.is_staff())
  );

-- No update policy: unmarking is a delete, re-marking an insert.
revoke all on public.attendance from anon, authenticated;
grant select, insert, delete on public.attendance to authenticated;

-- ---------------------------------------------------------------------------
-- Scores: 0–10 with two decimals. The only exception is the locked
-- easter-egg film's scores (plan 4.4).
-- ---------------------------------------------------------------------------

create table public.scores (
  film_id bigint not null references public.films (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete restrict,
  score numeric(4, 2) not null,
  entered_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (film_id, profile_id)
);

comment on table public.scores is
  'Scores 0–10 (two decimals), any time, with or without attendance. entered_by = who typed it (self or staff).';

create index scores_profile_id_idx on public.scores (profile_id);

-- Reads a film's lock state whatever the caller can see.
create function app.film_lock_state(film bigint, out is_easter_egg boolean, out scores_locked boolean)
language sql
volatile
security definer
set search_path = ''
as $$
  -- FOR SHARE: a concurrent "lock the scores" update waits for this
  -- transaction (and vice versa), so a score can't slip in as the lock lands.
  select f.is_easter_egg, f.scores_locked
  from public.films f
  where f.id = film
  for share;
$$;

-- SECURITY INVOKER on purpose (app.is_privileged()).
create function app.scores_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  old_state record;
  new_state record;
begin
  -- The lock applies to everyone, including admin and the secret key.
  if tg_op in ('UPDATE', 'DELETE') then
    select * into old_state from app.film_lock_state(old.film_id);
    if old_state.scores_locked then
      raise exception 'Scores for this film are locked and cannot be changed by anyone'
        using errcode = '42501';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  select * into new_state from app.film_lock_state(new.film_id);
  if new_state.scores_locked then
    raise exception 'Scores for this film are locked and cannot be changed by anyone'
      using errcode = '42501';
  end if;

  if new.score < 0 then
    raise exception 'Score must be between 0 and 10'
      using errcode = '23514';
  end if;
  -- Above 10 only for the easter-egg film, while still unlocked, and only
  -- from the import (secret key / postgres), never from a browser.
  if new.score > 10
    and not (new_state.is_easter_egg and app.is_privileged()) then
    raise exception 'Score must be between 0 and 10'
      using errcode = '23514';
  end if;

  perform app.assert_not_system_profile(new.profile_id);

  if not app.is_privileged() then
    new.entered_by := app.current_profile_id();
    if tg_op = 'INSERT' then
      new.created_at := now();
    elsif new.created_at <> old.created_at then
      raise exception 'created_at cannot be changed'
        using errcode = '42501';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;

  return new;
end;
$$;

create trigger scores_guard
  before insert or update or delete on public.scores
  for each row execute function app.scores_guard();

alter table public.scores enable row level security;

create policy scores_select_members on public.scores
  for select to authenticated
  using ((select app.current_role()) is not null);

-- Own score: any role but viewer. Others' scores: staff (decision 14).
create policy scores_insert_own_or_staff on public.scores
  for insert to authenticated
  with check (
    (profile_id = (select app.current_profile_id()) and (select app.can_write()))
    or (select app.is_staff())
  );

create policy scores_update_own_or_staff on public.scores
  for update to authenticated
  using (
    (profile_id = (select app.current_profile_id()) and (select app.can_write()))
    or (select app.is_staff())
  )
  with check (
    (profile_id = (select app.current_profile_id()) and (select app.can_write()))
    or (select app.is_staff())
  );

create policy scores_delete_own_or_staff on public.scores
  for delete to authenticated
  using (
    (profile_id = (select app.current_profile_id()) and (select app.can_write()))
    or (select app.is_staff())
  );

revoke all on public.scores from anon, authenticated;
grant select, insert, update, delete on public.scores to authenticated;

revoke execute on all functions in schema app from public;
grant execute on all functions in schema app to authenticated, service_role;
