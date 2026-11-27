-- Phase 17a: stats_data() for the Stats page. Seed: films 1-6 are screened,
-- 7 is the easter egg (2025), 8 is screened on 2026-12-05 (future while that
-- date is ahead; the test pins it to tomorrow so it doesn't depend on the clock).
begin;
select plan(14);

update public.films
set screened_on = (now() at time zone 'Europe/Lisbon')::date + 1
where id = 8;

select tests.login_anon();
select throws_ok($$select public.stats_data()$$, '42501', null, 'anon cannot call stats_data');
reset role;

select ok(not has_function_privilege('public', 'public.stats_data()', 'execute'),
  'PUBLIC has no execute grant');
select ok(
  (select not prosecdef and provolatile = 's' and proconfig = array['search_path=""']
   from pg_proc where oid = 'public.stats_data()'::regprocedure),
  'it is security invoker, stable, with an empty search_path');

create temporary table got (who text, data jsonb) on commit drop;
grant insert on got to authenticated;

select tests.login_as('member');
insert into got select 'member', public.stats_data();
reset role;
select tests.login_as('viewer');
insert into got select 'viewer', public.stats_data();
reset role;
-- A login with no profile: RLS hides every row from the caller.
select tests.login_as_uid(gen_random_uuid());
insert into got select 'nobody', public.stats_data();
reset role;

select is(
  (select array_agg((f ->> 0)::int order by (f ->> 0)::int)
   from got, jsonb_array_elements(data -> 'films') f where who = 'member'),
  array[1, 2, 3, 4, 5, 6], 'a member gets the screened films, not the easter egg or a future film');
select is(
  (select data -> 'films' -> 0 from got where who = 'member'),
  jsonb_build_array(1, 'The Quiet Orchard', 2019, '2026-01-10', 'normal',
    '00000000-0000-4000-8000-0000000000a3', jsonb_build_array('Drama'),
    jsonb_build_array('Oona Marlow'), null),
  'a film is [id, title, release_year, screened_on, kind, assigned_id, genres, directors, runtime_min]');
select is(
  (select jsonb_array_length(data -> 'scores') from got where who = 'member'),
  12, 'every score of the screened films (the easter egg''s 11s left out)');
select is(
  (select data -> 'scores' -> 0 from got where who = 'member'),
  jsonb_build_array(1, '00000000-0000-4000-8000-0000000000a1', 7.50),
  'a score is [film_id, profile_id, score]');
select is(
  (select count(*)::int from got, jsonb_array_elements(data -> 'scores') s
   where who = 'member' and (s ->> 0)::int in (7, 8)),
  0, 'no score of the easter egg or a future film');
select is(
  (select jsonb_array_length(data -> 'attendance') from got where who = 'member'),
  14, 'every attendance mark of the screened films');
select is(
  (select data -> 'attendance' -> 0 from got where who = 'member'),
  jsonb_build_array(1, '00000000-0000-4000-8000-0000000000a1'),
  'an attendance mark is [film_id, profile_id]');
select is(
  (select data from got where who = 'viewer'),
  (select data from got where who = 'member'),
  'a viewer gets the same data');
select is(
  (select data from got where who = 'nobody'),
  '{"films": [], "scores": [], "attendance": []}'::jsonb,
  'it runs with the caller''s rights: no profile, no rows (RLS applies)');

-- Today counts as screened (the same "today" as the films page).
update public.films set screened_on = (now() at time zone 'Europe/Lisbon')::date where id = 8;
insert into public.attendance (film_id, profile_id) values (8, tests.profile_id('member'));
select tests.login_as('member');
select ok(
  (select bool_or((f ->> 0)::int = 8) from jsonb_array_elements(public.stats_data() -> 'films') f),
  'a film screened today is in');
select is(
  (select count(*)::int from jsonb_array_elements(public.stats_data() -> 'attendance') a
   where (a ->> 0)::int = 8),
  1, 'and so is its attendance');
reset role;

select * from finish();
rollback;
