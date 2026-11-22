-- Rotation standings (plan 3.2, 6.2): points and owed turns, computed, never
-- stored. Mirrors computeStandings in src/rotation/rotation.ts line by line;
-- supabase/functions/tests/rotation-standings.test.ts checks both agree.
--
-- Events since app_settings.rotation_epoch, in date order. On the same date:
-- passes (placed on their week's Monday), then adjustments (by time), then
-- films (by day_order). Counted: normal and Democrático films from the epoch
-- to today, adjustments from the epoch to today, passes from the epoch up to
-- the coming week. Dates are Europe/Lisbon. No epoch, or an epoch still in
-- the future: no rows.
--
-- SECURITY INVOKER on purpose: RLS applies, so only logged-in club members
-- get rows.

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

  -- The week "who's next" is for: this one, unless its normal or Democrático
  -- screening has already happened.
  v_week := date_trunc('week', v_today)::date;
  if exists (
    select 1 from public.films f
    where f.kind in ('normal', 'democratico')
      and f.screened_on between greatest(v_week, v_epoch) and v_today
  ) then
    v_week := v_week + 7;
  end if;

  for ev in
    select e.* from (
      select rp.week_start as d, 0 as ord, null::timestamptz as ts, 0 as sub, 0::bigint as id,
             'pass' as kind, rp.profile_id as pid, null::integer as delta, null::integer as set_to,
             false as clear_owed, null::public.film_kind as film_kind, null::uuid as turn_holder,
             null::uuid[] as present
      from public.rotation_passes rp
      where rp.week_start between v_epoch and v_week
      union all
      select (a.effective_at at time zone 'Europe/Lisbon')::date, 1, a.effective_at, 0, a.id,
             'adjustment', a.profile_id, a.delta, a.set_to, a.clear_owed_turn, null, null, null
      from public.rotation_adjustments a
      where (a.effective_at at time zone 'Europe/Lisbon')::date between v_epoch and v_today
      union all
      select f.screened_on, 2, null, f.day_order, f.id,
             'film', f.assigned_id, null, null, false, f.kind, f.turn_holder_id,
             array(select att.profile_id from public.attendance att where att.film_id = f.id)
      from public.films f
      where f.kind in ('normal', 'democratico') and f.screened_on between v_epoch and v_today
    ) e
    order by e.d, e.ord, e.ts, e.sub, e.id
  loop
    if ev.kind = 'pass' then
      v_owed := array_remove(v_owed, ev.pid); -- passing clears an owed turn
    elsif ev.kind = 'adjustment' then
      if ev.set_to is not null then
        v_points := jsonb_set(v_points, array[ev.pid::text], to_jsonb(ev.set_to));
      elsif ev.delta is not null then
        v_points := jsonb_set(v_points, array[ev.pid::text],
          to_jsonb(coalesce((v_points ->> ev.pid::text)::integer, 0) + ev.delta));
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

revoke execute on function app.rotation_replay() from public;
grant execute on function app.rotation_replay() to authenticated, service_role;

create view public.rotation_standings
with (security_invoker = true)
as
select r.profile_id, r.points, r.owed_rank, r.owed_since, r.week_start
from app.rotation_replay() r;

comment on view public.rotation_standings is
  'Chooser rotation (plan 6): points, owed turns (owed_rank 1 = first) and the coming week, for everyone in the rotation. Empty before go-live (no rotation_epoch).';

revoke all on public.rotation_standings from anon, authenticated;
grant select on public.rotation_standings to authenticated;
