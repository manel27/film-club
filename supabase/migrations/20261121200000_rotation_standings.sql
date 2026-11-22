-- Rotation standings (plan 3.2, 6.2): points and owed turns, computed, never
-- stored. Mirrors computeStandings in src/rotation/rotation.ts line by line;
-- supabase/functions/tests/rotation-standings.test.ts checks both agree.
-- Also: the rotation_epoch format, sane adjustment values, and the owner's
-- decisions R2 (points never below 0) and R4 (own passes only from the
-- coming week on).
--
-- Events since app_settings.rotation_epoch, in date order. On the same date:
-- passes (placed on their week's Monday), then adjustments (by id), then
-- films (by day_order, then id). Counted: normal and Democrático films from
-- the epoch to today, adjustments whose Lisbon date is from the epoch to
-- today, passes from the epoch up to the coming week. No epoch, or an epoch
-- still in the future: no rows.
--
-- SECURITY INVOKER on purpose: RLS applies, so only logged-in club members
-- get rows.

-- ---------------------------------------------------------------------------
-- Settings and adjustment values
-- ---------------------------------------------------------------------------

-- A real calendar date written YYYY-MM-DD (make_date is immutable; a cast isn't).
create function app.is_iso_date(value text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
begin
  if value is null or value !~ '^\d{4}-\d{2}-\d{2}$' then
    return false;
  end if;
  perform make_date(substr(value, 1, 4)::integer, substr(value, 6, 2)::integer, substr(value, 9, 2)::integer);
  return true;
exception when others then
  return false;
end;
$$;

alter table public.app_settings
  add constraint app_settings_rotation_epoch_date check (
    key <> 'rotation_epoch'
    or (jsonb_typeof(value) = 'string' and app.is_iso_date(value #>> '{}'))
  );

-- Keeps every total far inside integer range.
alter table public.rotation_adjustments
  add constraint rotation_adjustments_delta_range check (delta between -1000 and 1000),
  add constraint rotation_adjustments_set_to_max check (set_to <= 1000);

-- ---------------------------------------------------------------------------
-- The coming week: the Monday of the week "who's next" is for. This week,
-- unless its normal or Democrático screening (on or after the epoch) has
-- already happened; then next week. Same as comingWeek() in rotation.ts.
-- ---------------------------------------------------------------------------

create function app.rotation_coming_week()
returns date
language sql
stable
security invoker
set search_path = ''
as $$
  with t as (
    select (now() at time zone 'Europe/Lisbon')::date as today,
           date_trunc('week', (now() at time zone 'Europe/Lisbon')::date)::date as monday
  )
  select t.monday + case when exists (
    select 1 from public.films f
    where f.kind in ('normal', 'democratico')
      and f.screened_on <= t.today
      -- greatest() ignores a null (no epoch).
      and f.screened_on >= greatest(t.monday, (
        select (s.value #>> '{}')::date from public.app_settings s where s.key = 'rotation_epoch'
      ))
  ) then 7 else 0 end
  from t;
$$;

-- ---------------------------------------------------------------------------
-- The replay
-- ---------------------------------------------------------------------------

create function app.rotation_replay()
returns table (
  profile_id uuid,
  points integer,
  owed_rank integer,
  owed_since date,
  week_start date
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Europe/Lisbon')::date;
  v_epoch date;
  v_week date;
  v_points jsonb := '{}'::jsonb;
  v_owed uuid[] := '{}'::uuid[]; -- oldest first
  v_since jsonb := '{}'::jsonb;
  v_id uuid;
  ev record;
begin
  select (s.value #>> '{}')::date into v_epoch
  from public.app_settings s where s.key = 'rotation_epoch';
  if v_epoch is null or v_today < v_epoch then
    return;
  end if;
  v_week := app.rotation_coming_week();

  for ev in
    select e.* from (
      select rp.week_start as d, 0 as ord, 0 as sub, 0::bigint as id,
             'pass' as kind, rp.profile_id as pid, null::integer as delta, null::integer as set_to,
             false as clear_owed, null::public.film_kind as film_kind, null::uuid as turn_holder,
             null::uuid[] as present
      from public.rotation_passes rp
      where rp.week_start between v_epoch and v_week
      union all
      select (a.effective_at at time zone 'Europe/Lisbon')::date, 1, 0, a.id,
             'adjustment', a.profile_id, a.delta, a.set_to, a.clear_owed_turn, null, null, null
      from public.rotation_adjustments a
      where (a.effective_at at time zone 'Europe/Lisbon')::date between v_epoch and v_today
      union all
      select f.screened_on, 2, f.day_order, f.id,
             'film', f.assigned_id, null, null, false, f.kind, f.turn_holder_id,
             array(select att.profile_id from public.attendance att where att.film_id = f.id)
      from public.films f
      where f.kind in ('normal', 'democratico') and f.screened_on between v_epoch and v_today
    ) e
    order by e.d, e.ord, e.sub, e.id
  loop
    if ev.kind = 'pass' then
      v_owed := array_remove(v_owed, ev.pid); -- passing clears an owed turn
    elsif ev.kind = 'adjustment' then
      if ev.set_to is not null then
        v_points := jsonb_set(v_points, array[ev.pid::text], to_jsonb(ev.set_to));
      elsif ev.delta is not null then
        v_points := jsonb_set(v_points, array[ev.pid::text],  -- never below 0 (R2)
          to_jsonb(greatest(0, coalesce((v_points ->> ev.pid::text)::integer, 0) + ev.delta)));
      end if;
      if ev.clear_owed then
        v_owed := array_remove(v_owed, ev.pid);
      end if;
    else
      foreach v_id in array ev.present loop
        v_points := jsonb_set(v_points, array[v_id::text],
          to_jsonb(coalesce((v_points ->> v_id::text)::integer, 0) + 1));
      end loop;
      if ev.film_kind = 'normal' then
        v_points := jsonb_set(v_points, array[ev.pid::text], to_jsonb(0)); -- after the +1, even if absent
        v_owed := array_remove(v_owed, ev.pid); -- they took their turn
      elsif ev.turn_holder is not null and not (ev.turn_holder = any (v_owed)) then
        v_owed := v_owed || ev.turn_holder; -- nobody resets
        v_since := jsonb_set(v_since, array[ev.turn_holder::text], to_jsonb(ev.d));
      end if;
    end if;
  end loop;

  return query
  select
    p.id,
    coalesce((v_points ->> p.id::text)::integer, 0),
    array_position(v_owed, p.id),
    case when p.id = any (v_owed) then (v_since ->> p.id::text)::date end,
    v_week
  from public.profiles p
  where p.role <> 'viewer' and not p.is_system;
end;
$$;

create view public.rotation_standings
with (security_invoker = true)
as
select r.profile_id, r.points, r.owed_rank, r.owed_since, r.week_start
from app.rotation_replay() r;

comment on view public.rotation_standings is
  'Chooser rotation (plan 6): points, owed turns (owed_rank 1 = first) and the coming week, for everyone in the rotation. Empty before go-live (no rotation_epoch).';

revoke all on public.rotation_standings from anon, authenticated;
grant select on public.rotation_standings to authenticated;

-- ---------------------------------------------------------------------------
-- Passes (R4) and decisions: members may add or remove their own pass only
-- for the coming week or later (a past pass would rewrite owed turns).
-- Viewers aren't in the rotation, so nobody passes or is picked for them
-- (system profiles are refused by app.rotation_guard).
-- ---------------------------------------------------------------------------

create function app.is_viewer_profile(profile uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (select 1 from public.profiles p where p.id = profile and p.role = 'viewer');
$$;

drop policy rotation_passes_insert_own_or_staff on public.rotation_passes;
drop policy rotation_passes_delete_own_or_staff on public.rotation_passes;

create policy rotation_passes_insert_own_or_staff on public.rotation_passes
  for insert to authenticated
  with check (
    not app.is_viewer_profile(profile_id)
    and (
      (profile_id = (select app.current_profile_id()) and (select app.can_write())
        and week_start >= (select app.rotation_coming_week()))
      or (select app.is_staff())
    )
  );
create policy rotation_passes_delete_own_or_staff on public.rotation_passes
  for delete to authenticated
  using (
    (profile_id = (select app.current_profile_id()) and (select app.can_write())
      and week_start >= (select app.rotation_coming_week()))
    or (select app.is_staff())
  );

drop policy rotation_next_insert_staff on public.rotation_next;
drop policy rotation_next_update_staff on public.rotation_next;

create policy rotation_next_insert_staff on public.rotation_next
  for insert to authenticated
  with check ((select app.is_staff()) and not app.is_viewer_profile(profile_id));
create policy rotation_next_update_staff on public.rotation_next
  for update to authenticated
  using ((select app.is_staff()))
  with check ((select app.is_staff()) and not app.is_viewer_profile(profile_id));

revoke execute on all functions in schema app from public;
grant execute on all functions in schema app to authenticated, service_role;
