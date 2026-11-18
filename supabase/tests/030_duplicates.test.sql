-- No-duplicate rule (plan 4.3): TMDB id, manual title + year, manual vs TMDB
-- cross-match in both directions, original titles, and nobody is exempt
-- (admin, the secret key and a direct postgres import are blocked too).
-- Seed: 1 'The Quiet Orchard' (2019, TMDB 900001); 2 'Neon Harbour' /
-- 'Porto de Néon' (2021, TMDB 900002); 3 'Paper Moons Over the River'
-- (2018, manual).
begin;
select plan(31);

-- ---------------------------------------------------------------- TMDB id
select tests.login_as('admin');
select throws_ok($$insert into public.films (tmdb_id, title, release_year, screened_on, assigned_id)
  values (900001, 'Totally Different Title', 1999, '2026-06-06', tests.profile_id('admin'))$$,
  '23505', null, 'admin: same TMDB id is a duplicate');
reset role;
select tests.login_as('moderator');
select throws_ok($$insert into public.films (tmdb_id, title, release_year, screened_on, assigned_id)
  values (900001, 'The Quiet Orchard', 2019, '2026-06-06', tests.profile_id('admin'))$$,
  '23505', null, 'moderator: same TMDB id is a duplicate');
reset role;
select tests.login_service_role();
select throws_ok($$insert into public.films (tmdb_id, title, release_year, screened_on, assigned_id)
  values (900001, 'The Quiet Orchard', 2019, '2026-06-06', '00000000-0000-4000-8000-0000000000a1')$$,
  '23505', null, 'secret key: same TMDB id is a duplicate');
reset role;
select throws_ok($$insert into public.films (tmdb_id, title, release_year, screened_on, assigned_id)
  values (900001, 'The Quiet Orchard', 2019, '2026-06-06', '00000000-0000-4000-8000-0000000000a1')$$,
  '23505', null, 'direct postgres import: same TMDB id is a duplicate');

-- ---------------------------------------------------------------- manual title + year
select tests.login_as('admin');
select throws_ok($$insert into public.films (title, release_year, screened_on, assigned_id)
  values ('Paper Moons Over the River', 2018, '2026-06-06', tests.profile_id('admin'))$$,
  '23505', null, 'admin: manual film with same title and year is a duplicate');
select throws_ok($$insert into public.films (title, release_year, screened_on, assigned_id)
  values ('  PAPER moons, over the river!! ', 2018, '2026-06-06', tests.profile_id('admin'))$$,
  '23505', null, 'case, punctuation and spacing are ignored');
select throws_ok($$insert into public.films (title, release_year, screened_on, assigned_id)
  values ('Pâper Moöns Over the Rivér', 2018, '2026-06-06', tests.profile_id('admin'))$$,
  '23505', null, 'accents are ignored');
select throws_ok($$insert into public.films (title, release_year, screened_on, assigned_id)
  values (U&'Paper Moons\200B Over the Ri\00ADver', 2018, '2026-06-06', tests.profile_id('admin'))$$,
  '23505', null, 'invisible characters (zero-width space, soft hyphen) are ignored');
select throws_ok($$insert into public.films (title, release_year, screened_on, assigned_id)
  values (U&'\FEFFThe Quiet\2060 Orchard', 2019, '2026-06-06', tests.profile_id('admin'))$$,
  '23505', null, 'BOM and word joiner are ignored in the manual vs TMDB cross-match');
select lives_ok($$insert into public.films (title, release_year, screened_on, assigned_id)
  values ('Paper Moons Over the River', 1987, '2026-06-06', tests.profile_id('admin'))$$,
  'same manual title with a different year is a different film');
reset role;
select tests.login_service_role();
select throws_ok($$insert into public.films (title, release_year, screened_on, assigned_id)
  values ('Paper Moons Over the River', 2018, '2026-06-06', '00000000-0000-4000-8000-0000000000a1')$$,
  '23505', null, 'secret key: manual duplicate blocked');
reset role;

-- A remake that shares its title: same title, different years, both allowed
select lives_ok($$insert into public.films (title, release_year, screened_on, assigned_id)
  values ('Spooky Flick', 2000, '2024-09-14', '00000000-0000-4000-8000-0000000000a1'),
         ('Spooky Flick', 2026, '2026-07-04', '00000000-0000-4000-8000-0000000000a1')$$,
  'same title in two different years: two films');

-- ---------------------------------------------------------------- cross-match
select tests.login_as('admin');
select throws_ok($$insert into public.films (title, release_year, screened_on, assigned_id)
  values ('The Quiet Orchard', 2019, '2026-06-06', tests.profile_id('admin'))$$,
  '23505', null, 'manual film matching an existing TMDB film (title + year) is a duplicate');
select throws_ok($$insert into public.films (tmdb_id, title, release_year, screened_on, assigned_id)
  values (920001, 'Paper Moons Over the River', 2018, '2026-06-06', tests.profile_id('admin'))$$,
  '23505', null, 'TMDB film matching an existing manual film (title + year) is a duplicate');
select throws_ok($$insert into public.films (title, release_year, screened_on, assigned_id)
  values ('Porto de Neon', 2021, '2026-06-06', tests.profile_id('admin'))$$,
  '23505', null, 'manual film matching a TMDB film''s original title is a duplicate');
select throws_ok($$insert into public.films (tmdb_id, title, original_title, release_year, screened_on, assigned_id)
  values (920002, 'Moons of Paper', 'Paper Moons Over the River', 2018, '2026-06-06', tests.profile_id('admin'))$$,
  '23505', null, 'TMDB film whose original title matches a manual film is a duplicate');
select lives_ok($$insert into public.films (tmdb_id, title, release_year, screened_on, assigned_id)
  values (920003, 'Neon Harbour', 2021, '2026-06-06', tests.profile_id('admin'))$$,
  'two different TMDB films sharing a title and year are allowed');
reset role;

select tests.login_service_role();
select throws_ok($$insert into public.films (title, release_year, screened_on, assigned_id)
  values ('the quiet orchard', 2019, '2026-06-06', '00000000-0000-4000-8000-0000000000a1')$$,
  '23505', null, 'secret key: manual vs TMDB cross-match blocked');
reset role;
select throws_ok($$insert into public.films (tmdb_id, title, release_year, screened_on, assigned_id)
  values (920004, 'Paper Moons Over The River', 2018, '2026-06-06', '00000000-0000-4000-8000-0000000000a1')$$,
  '23505', null, 'direct postgres import: TMDB vs manual cross-match blocked');

-- ---------------------------------------------------------------- updates
select tests.login_as('admin');
select throws_ok($$update public.films set tmdb_id = 900001 where id = 8$$,
  '23505', null, 'editing a film into an existing TMDB id is blocked');
select throws_ok($$update public.films set tmdb_id = null, title = 'Paper Moons Over the River', release_year = 2018 where id = 8$$,
  '23505', null, 'editing a film into an existing manual title + year is blocked');
select lives_ok($$update public.films set overview = 'still unique' where id = 3$$,
  'editing other fields of a film does not trip the duplicate check against itself');
select lives_ok($$update public.films set title = 'Paper Moons Over the River ' where id = 3$$,
  'a film does not clash with itself');
reset role;

-- Cinema and Maratona count as shown
select tests.login_as('moderator');
select throws_ok($$insert into public.films (tmdb_id, title, release_year, screened_on, kind, assigned_id)
  values (900003, 'Midnight Marathon', 2015, '2026-06-06', 'normal', tests.profile_id('member'))$$,
  '23505', null, 'a maratona film counts as already shown');
reset role;

-- ---------------------------------------------------------------- UI check RPC
select tests.login_as('member');
select is(
  (select array_agg(id order by id) from public.film_duplicate_check('the QUIET orchard', 2019)),
  array[1::bigint], 'film_duplicate_check finds a title + year match');
select is(
  (select array_agg(id order by id) from public.film_duplicate_check('Anything', 1950, 900002)),
  array[2::bigint], 'film_duplicate_check finds a TMDB id match');
select is(
  (select array_agg(id order by id) from public.film_duplicate_check('Porto de Néon', 2021)),
  array[2::bigint], 'film_duplicate_check matches original titles');
select is(
  (select count(*)::int from public.film_duplicate_check('Neon Harbour', 2021, 999999)),
  0, 'film_duplicate_check: a different TMDB film with the same title is not a clash');
select is(
  (select array_agg(id order by id) from public.film_duplicate_check(U&'The\200D Quiet Orchard', 2019)),
  array[1::bigint], 'film_duplicate_check ignores invisible characters');
select is(
  (select count(*)::int from public.film_duplicate_check('A Film Nobody Has Seen', 2020)),
  0, 'film_duplicate_check returns nothing for a new film');
select is(
  (select screened_on from public.film_duplicate_check('Paper Moons Over the River', 2018)),
  '2026-01-24'::date, 'film_duplicate_check returns the screening date for "Already watched on"');
reset role;

select * from finish();
rollback;
