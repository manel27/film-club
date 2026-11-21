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
