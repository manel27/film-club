-- Add / edit film (phase 8): the tmdb-search rate limit, non-empty titles,
-- whitespace-only comments refused, and day_order on add / date change.
--
-- Rate limit for the tmdb-search Edge Function (plan 2.8: "60 searches per
-- user per minute, tracked in a small table").
--
-- The function calls this with the caller's JWT, so it never needs the secret
-- key. SECURITY DEFINER because browsers have no access to rate_limits; the
-- subject is always the caller's own profile, so calling it directly from a
-- browser only uses up the caller's own allowance. Viewers, unlinked logins
-- and visitors get false without a row being written.

create function public.tmdb_search_hit()
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := app.current_profile_id();
  win timestamptz := date_trunc('minute', now());
  hits integer;
begin
  if me is null or not app.can_write() then
    return false;
  end if;

  -- Old windows are never read again.
  delete from public.rate_limits
  where bucket = 'tmdb-search' and subject = me::text and window_start < win;

  insert into public.rate_limits as r (bucket, subject, window_start, count)
  values ('tmdb-search', me::text, win, 1)
  on conflict (bucket, subject, window_start) do update set count = r.count + 1
  returning r.count into hits;

  return hits <= 60;
end;
$$;

comment on function public.tmdb_search_hit() is
  'Counts one TMDB search for the caller; false when over 60 a minute (or the caller is a viewer / not a member).';

revoke execute on function public.tmdb_search_hit() from public, anon;
grant execute on function public.tmdb_search_hit() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Titles must keep at least one letter or digit once normalised (plan 4.3):
-- a title of zero-width spaces, punctuation or emoji only would normalise to
-- '' and dodge the duplicate rule. Adding the constraint checks every
-- existing row; the migration fails (changing nothing) if one breaks it.
-- ---------------------------------------------------------------------------

alter table public.films
  add constraint films_title_norm_not_empty check (title_norm <> '');

-- ---------------------------------------------------------------------------
-- Comments: btrim() only strips spaces, so a body of newlines or tabs passed
-- the old check. A body now needs at least one non-whitespace character.
-- ---------------------------------------------------------------------------

alter table public.comments
  drop constraint comments_body_length,
  add constraint comments_body_length
    check (char_length(btrim(body)) <= 4000 and body ~ '[^[:space:]]');

-- ---------------------------------------------------------------------------
-- day_order: a film added with day_order null, or moved to another day, goes
-- after that day's other films. The lock (per day, until commit) makes two
-- saves on the same day queue up instead of both taking the same number.
-- An explicit day_order (the import, or a reorder) is kept as given.
-- SECURITY DEFINER so it counts every film of the day.
-- ---------------------------------------------------------------------------

create function app.films_day_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.day_order is not null then
    return new;
  end if;
  if tg_op = 'UPDATE'
    and (new.screened_on = old.screened_on or new.day_order is distinct from old.day_order) then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtext('public.films:day_order'), new.screened_on - date '2000-01-01');
  select coalesce(max(f.day_order), 0) + 1
    into new.day_order
  from public.films f
  where f.screened_on = new.screened_on
    and f.id is distinct from new.id;
  return new;
end;
$$;

create trigger films_day_order
  before insert or update of screened_on on public.films
  for each row execute function app.films_day_order();

revoke execute on function app.films_day_order() from public;
grant execute on function app.films_day_order() to authenticated, service_role;
