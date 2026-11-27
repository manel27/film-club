-- Phase 17a: the Stats page's data (PLAN 10.2, decision F5). Additive only.
--
-- One call returns every screened film (screened_on on or before today in
-- Lisbon, as the films page counts it) except the easter egg (decision N2),
-- with all their scores and attendance, as compact arrays in one jsonb value:
-- PostgREST's 1,000-row limit never cuts it short. Security invoker, so RLS
-- applies: someone without a profile gets empty arrays. Every score counts,
-- as in film_stats (system profiles can't score: app.scores_guard).
--
-- Shape: {"films": [[id, title, release_year, screened_on, kind, assigned_id,
-- genres, directors, runtime_min], ...], "scores": [[film_id, profile_id,
-- score], ...], "attendance": [[film_id, profile_id], ...]}
create function public.stats_data()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with shown as (
    select f.id, f.title, f.release_year, f.screened_on, f.kind, f.assigned_id,
           f.genres, f.directors, f.runtime_min
    from public.films f
    where not f.is_easter_egg
      and f.screened_on <= (now() at time zone 'Europe/Lisbon')::date
  )
  select jsonb_build_object(
    'films', coalesce((
      select jsonb_agg(jsonb_build_array(s.id, s.title, s.release_year, s.screened_on, s.kind,
                                         s.assigned_id, s.genres, s.directors, s.runtime_min)
                       order by s.id)
      from shown s), '[]'::jsonb),
    'scores', coalesce((
      select jsonb_agg(jsonb_build_array(sc.film_id, sc.profile_id, sc.score)
                       order by sc.film_id, sc.profile_id)
      from public.scores sc
      join shown s on s.id = sc.film_id), '[]'::jsonb),
    'attendance', coalesce((
      select jsonb_agg(jsonb_build_array(a.film_id, a.profile_id)
                       order by a.film_id, a.profile_id)
      from public.attendance a
      join shown s on s.id = a.film_id), '[]'::jsonb)
  );
$$;

comment on function public.stats_data() is
  'Screened films (not the easter egg) with their scores and attendance, for the Stats page.';

revoke execute on function public.stats_data() from public, anon;
grant execute on function public.stats_data() to authenticated;
