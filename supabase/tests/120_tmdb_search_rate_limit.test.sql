-- public.tmdb_search_hit(): the tmdb-search rate limit (60 a minute per
-- profile). Members and staff are counted; viewers, visitors and the old
-- windows are not.
begin;
select plan(9);

select ok(
  (select p.prosecdef from pg_proc p where p.oid = 'public.tmdb_search_hit()'::regprocedure),
  'tmdb_search_hit() is SECURITY DEFINER (browsers cannot touch rate_limits)');
select ok(not has_function_privilege('anon', 'public.tmdb_search_hit()', 'execute'),
  'anon cannot execute tmdb_search_hit()');

-- An old window is cleared on the next hit.
insert into public.rate_limits (bucket, subject, window_start, count)
values ('tmdb-search', tests.profile_id('member')::text, now() - interval '1 hour', 99);

select tests.login_as('member');
select is(public.tmdb_search_hit(), true, 'a member''s first search is allowed');
select is((select count(*)::int from generate_series(2, 60) where public.tmdb_search_hit()), 59,
  'searches 2 to 60 in the same minute are allowed');
select is(public.tmdb_search_hit(), false, 'search 61 in the same minute is refused');
reset role;

select is(
  (select count(*)::int from public.rate_limits
   where subject = tests.profile_id('member')::text and window_start < date_trunc('minute', now())),
  0, 'the old window was deleted');

select tests.login_as('moderator');
select is(public.tmdb_search_hit(), true, 'each profile has its own allowance');
reset role;

select tests.login_as('viewer');
select is(public.tmdb_search_hit(), false, 'viewers may not search');
reset role;
select is(
  (select count(*)::int from public.rate_limits where subject = tests.profile_id('viewer')::text),
  0, 'nothing is counted for a viewer');

select * from finish();
rollback;
