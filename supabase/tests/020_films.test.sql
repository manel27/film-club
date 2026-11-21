-- Matrix rows "Add / edit films": A ✔ Mo ✔ Me ✘ V ✘ — ✘
-- and "Delete films": A ✔ Mo ✘ Me ✘ V ✘ — ✘
-- plus film constraints and import-only columns.
begin;
select plan(45);

-- ---------------------------------------------------------------- add
select tests.login_as('admin');
select lives_ok($$insert into public.films (tmdb_id, title, release_year, screened_on, assigned_id)
  values (910001, 'Admin Pick', 2001, '2026-03-07', tests.profile_id('admin'))$$,
  'admin can add a film');
reset role;

select tests.login_as('moderator');
select lives_ok($$insert into public.films (tmdb_id, title, release_year, screened_on, assigned_id)
  values (910002, 'Moderator Pick', 2002, '2026-03-14', tests.profile_id('member'))$$,
  'moderator can add a film');
reset role;

select tests.login_as('member');
select throws_ok($$insert into public.films (tmdb_id, title, release_year, screened_on, assigned_id)
  values (910003, 'Member Pick', 2003, '2026-03-21', tests.profile_id('member'))$$,
  '42501', null, 'member cannot add a film');
reset role;

select tests.login_as('viewer');
select throws_ok($$insert into public.films (tmdb_id, title, release_year, screened_on, assigned_id)
  values (910004, 'Viewer Pick', 2004, '2026-03-28', tests.profile_id('member'))$$,
  '42501', null, 'viewer cannot add a film');
reset role;

select tests.login_anon();
select throws_ok($$insert into public.films (tmdb_id, title, release_year, screened_on, assigned_id)
  values (910005, 'Anon Pick', 2005, '2026-04-04', '00000000-0000-4000-8000-0000000000a3')$$,
  '42501', null, 'anon cannot add a film');
reset role;

select is((select created_by from public.films where tmdb_id = 910002), tests.profile_id('moderator'),
  'created_by is recorded as the caller');

-- A forged created_by is overwritten with the caller
select tests.login_as('moderator');
insert into public.films (tmdb_id, title, release_year, screened_on, assigned_id, created_by)
values (910006, 'Forged Author', 2006, '2026-04-11', tests.profile_id('member'), tests.profile_id('admin'));
reset role;
select is((select created_by from public.films where tmdb_id = 910006), tests.profile_id('moderator'),
  'a forged created_by is replaced by the caller');

-- ---------------------------------------------------------------- edit
select tests.login_as('admin');
select is(tests.affected($$update public.films set overview = 'edited by admin' where id = 1$$), 1, 'admin can edit a film');
reset role;
select tests.login_as('moderator');
select is(tests.affected($$update public.films set overview = 'edited by moderator' where id = 2$$), 1, 'moderator can edit a film');
reset role;
select tests.login_as('member');
select is(tests.affected($$update public.films set overview = 'edited by member' where id = 1$$), 0, 'member cannot edit a film');
reset role;
select tests.login_as('viewer');
select is(tests.affected($$update public.films set overview = 'edited by viewer' where id = 1$$), 0, 'viewer cannot edit a film');
reset role;
select tests.login_anon();
select throws_ok($$update public.films set overview = 'x' where id = 1$$, '42501', null, 'anon cannot edit a film');
reset role;
select is((select overview from public.films where id = 1), 'edited by admin', 'member/viewer edits had no effect');

-- ---------------------------------------------------------------- delete
select tests.login_as('member');
select is(tests.affected($$delete from public.films where tmdb_id = 910001$$), 0, 'member cannot delete a film');
reset role;
select tests.login_as('viewer');
select is(tests.affected($$delete from public.films where tmdb_id = 910001$$), 0, 'viewer cannot delete a film');
reset role;
select tests.login_anon();
select throws_ok($$delete from public.films where tmdb_id = 910001$$, '42501', null, 'anon cannot delete a film');
reset role;
select tests.login_as('admin');
select is(tests.affected($$delete from public.films where tmdb_id = 910001$$), 1, 'admin can delete a film');
reset role;
select tests.login_as('moderator');
select is(tests.affected($$delete from public.films where tmdb_id = 910002$$), 0, 'moderator cannot delete a film');
select is(tests.affected($$delete from public.films where id = 2$$), 0, 'moderator cannot delete a film with history');
reset role;
select ok(exists (select 1 from public.films where tmdb_id = 910002), 'the moderator''s delete had no effect');
select tests.login_as('admin');
select is(tests.affected($$delete from public.films where tmdb_id = 910002$$), 1, 'admin can delete a film added by a moderator');
reset role;

-- Deleting a film removes its attendance, scores and comments
select ok((select count(*) from public.scores where film_id = 2) > 0
      and (select count(*) from public.attendance where film_id = 2) > 0
      and (select count(*) from public.comments where film_id = 2) > 0,
  'film 2 has attendance, scores and comments before the delete');
select tests.login_as('admin');
select is(tests.affected($$delete from public.films where id = 2$$), 1, 'admin can delete a film with history');
reset role;
select is((select count(*)::int from public.scores where film_id = 2)
        + (select count(*)::int from public.attendance where film_id = 2)
        + (select count(*)::int from public.comments where film_id = 2), 0,
  'its attendance, scores and comments are deleted with it');

-- One film per statement from the browser (no bulk wipe)
select tests.login_as('admin');
select throws_ok($$delete from public.films where id in (3, 4)$$,
  '42501', 'Films can only be deleted one at a time', 'admin cannot delete two films in one statement');
select throws_ok($$delete from public.films where id <> 7$$,
  '42501', 'Films can only be deleted one at a time', 'admin cannot delete every film in one statement');
reset role;
select is((select count(*)::int from public.films where id in (3, 4)), 2, 'the refused bulk delete removed nothing');
select tests.login_as('moderator');
select is(tests.affected($$delete from public.films where id in (3, 4)$$), 0,
  'a moderator''s bulk delete matches no rows');
reset role;

-- ---------------------------------------------------------------- constraints
select tests.login_as('admin');
select throws_ok($$insert into public.films (title, screened_on, assigned_id)
  values ('No Year Manual', '2026-05-02', tests.profile_id('admin'))$$,
  '23514', null, 'a manual film (no TMDB id) needs a release year (decision N1)');
select throws_ok($$insert into public.films (tmdb_id, title, release_year, screened_on)
  values (910010, 'No Chooser', 2010, '2026-05-02')$$,
  '23502', null, 'the assigned person is required');
select throws_ok($$insert into public.films (tmdb_id, title, release_year, assigned_id)
  values (910011, 'No Date', 2011, tests.profile_id('admin'))$$,
  '23502', null, 'the screening date is required');
select throws_ok($$insert into public.films (tmdb_id, title, release_year, screened_on, kind, assigned_id, turn_holder_id)
  values (910012, 'Normal With Turn Holder', 2012, '2026-05-02', 'normal', tests.profile_id('admin'), tests.profile_id('member'))$$,
  '23514', null, 'turn_holder_id is only allowed on democratico films');
select lives_ok($$insert into public.films (tmdb_id, title, release_year, screened_on, kind, assigned_id, turn_holder_id)
  values (910013, 'Democratic Choice', 2013, '2026-05-09', 'democratico', tests.profile_id('member2'), tests.profile_id('member'))$$,
  'a democratico film records proposer and turn-holder');
select throws_ok($$insert into public.films (tmdb_id, title, release_year, screened_on, kind, assigned_id, turn_holder_id)
  values (910016, 'System Turn Holder', 2016, '2026-05-09', 'democratico', tests.profile_id('member'), tests.profile_id('cinema'))$$,
  '23514', null, 'a system profile cannot be the Democrático turn-holder');
select throws_ok($$update public.films set turn_holder_id = tests.profile_id('archive') where tmdb_id = 910013$$,
  '23514', null, 'a turn-holder cannot be changed to a system profile');
select lives_ok($$insert into public.films (title, release_year, screened_on, kind, assigned_id)
  values ('Cinema Trip', 2026, '2026-05-16', 'cinema', tests.profile_id('cinema'))$$,
  'a cinema film can be assigned to the Cinema system profile');
select throws_ok($$insert into public.films (tmdb_id, title, release_year, screened_on, assigned_id)
  values (910014, '   ', 2014, '2026-05-23', tests.profile_id('admin'))$$,
  '23514', null, 'a blank title is rejected');

-- Import-only columns
select throws_ok($$insert into public.films (tmdb_id, title, release_year, screened_on, assigned_id, is_easter_egg)
  values (910015, 'Sneaky Egg', 2015, '2026-05-30', tests.profile_id('admin'), true)$$,
  '42501', null, 'staff cannot create an easter-egg film');
select throws_ok($$update public.films set is_easter_egg = true where id = 1$$,
  '42501', null, 'staff cannot turn a film into an easter egg');
select throws_ok($$update public.films set legacy_sheet_row = 42 where id = 1$$,
  '42501', null, 'staff cannot set legacy_sheet_row');
select throws_ok($$update public.films set created_by = tests.profile_id('member') where id = 1$$,
  '42501', null, 'staff cannot rewrite created_by');
reset role;

select tests.login_service_role();
select lives_ok($$update public.films set legacy_sheet_row = 42 where id = 1$$,
  'the import (secret key) can set legacy_sheet_row');
reset role;

select throws_ok($$insert into public.films (tmdb_id, title, release_year, screened_on, kind, assigned_id, turn_holder_id)
  values (910017, 'Import System Turn Holder', 2017, '2026-05-09', 'democratico', '00000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-0000000000c1')$$,
  '23514', null, 'the import cannot use a system profile as turn-holder either');

-- A profile with films can't be deleted (history is kept)
select throws_ok($$delete from public.profiles where id = '00000000-0000-4000-8000-0000000000a4'$$,
  '23503', null, 'a profile that chose films cannot be deleted');

-- The import (secret key) is not limited to one film per statement
select tests.login_service_role();
select is(tests.affected($$delete from public.films where id in (3, 4)$$), 2,
  'the secret key can delete several films in one statement');
reset role;

select * from finish();
rollback;
