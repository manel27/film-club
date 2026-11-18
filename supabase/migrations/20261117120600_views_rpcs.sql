-- Read helpers for the UI (plan 3.2). Both run with the caller's rights, so
-- RLS applies: logged-in club members see results, everyone else nothing.
-- rotation_standings (phase 9), profile_watch_list (phase 10), keepalive
-- (phase 12) and the admin export (phase 11) come later.

-- Per-film stats. The easter-egg film's locked scores are
-- excluded from every aggregate (decision N2): its score_count is 0 and its
-- avg_score is null; the film page reads its scores directly.
create view public.film_stats
with (security_invoker = true)
as
select
  f.id as film_id,
  f.is_easter_egg,
  coalesce(a.present_count, 0) as present_count,
  case when f.is_easter_egg then 0 else coalesce(s.score_count, 0) end as score_count,
  case when f.is_easter_egg then null else s.avg_score end as avg_score
from public.films f
left join (
  select film_id, count(*)::integer as present_count
  from public.attendance
  group by film_id
) a on a.film_id = f.id
left join (
  select film_id, count(*)::integer as score_count, round(avg(score), 2) as avg_score
  from public.scores
  group by film_id
) s on s.film_id = f.id;

comment on view public.film_stats is
  'Per-film present count, score count and average (two decimals). Easter-egg scores are excluded.';

revoke all on public.film_stats from anon, authenticated;
grant select on public.film_stats to authenticated;

-- UI duplicate warning (plan 4.3): films already in the list that the given
-- title/year/TMDB id would clash with. Mirrors app.films_no_duplicate(), which
-- remains the real guard.
create function public.film_duplicate_check(
  p_title text,
  p_release_year integer default null,
  p_tmdb_id integer default null,
  p_original_title text default null
)
returns table (
  id bigint,
  title text,
  release_year integer,
  tmdb_id integer,
  screened_on date,
  kind public.film_kind
)
language sql
stable
security invoker
set search_path = ''
as $$
  with candidate as (
    select
      app.normalize_title(p_title) as title_norm,
      app.normalize_title(p_original_title) as original_title_norm
  )
  select f.id, f.title, f.release_year, f.tmdb_id, f.screened_on, f.kind
  from public.films f, candidate c
  where (p_tmdb_id is not null and f.tmdb_id = p_tmdb_id)
     or (
       f.release_year is not distinct from p_release_year
       and not (f.tmdb_id is not null and p_tmdb_id is not null and f.tmdb_id <> p_tmdb_id)
       and (
         f.title_norm in (c.title_norm, c.original_title_norm)
         or f.original_title_norm in (c.title_norm, c.original_title_norm)
       )
     )
  order by f.screened_on;
$$;

comment on function public.film_duplicate_check(text, integer, integer, text) is
  'Films that would clash with the given title/year/TMDB id ("Already watched on <date>").';

revoke execute on function public.film_duplicate_check(text, integer, integer, text) from public, anon;
grant execute on function public.film_duplicate_check(text, integer, integer, text) to authenticated, service_role;
