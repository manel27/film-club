-- Matrix row "Change the easter-egg film's locked scores": ✘ for everyone,
-- including the secret key and a direct postgres session (plan 4.4).
-- Seed film 7 is the synthetic easter egg: three scores of 11, locked.
begin;
select plan(43);

select ok((select scores_locked and is_easter_egg from public.films where id = 7), 'film 7 is the locked easter egg');

-- ---------------------------------------------------------------- insert
select tests.login_as('admin');
select throws_ok($$insert into public.scores (film_id, profile_id, score) values (7, tests.profile_id('member2'), 5)$$,
  '42501', 'Scores for this film are locked and cannot be changed by anyone', 'admin cannot add a score to the locked film');
reset role;
select tests.login_as('moderator');
select throws_ok($$insert into public.scores (film_id, profile_id, score) values (7, tests.profile_id('member2'), 5)$$,
  '42501', 'Scores for this film are locked and cannot be changed by anyone', 'moderator cannot add a score to the locked film');
reset role;
select tests.login_as('member');
select throws_ok($$insert into public.scores (film_id, profile_id, score) values (7, tests.profile_id('member2'), 5)$$,
  '42501', null, 'member cannot add a score to the locked film');
reset role;
select tests.login_as('member2');
select throws_ok($$insert into public.scores (film_id, profile_id, score) values (7, tests.profile_id('member2'), 5)$$,
  '42501', 'Scores for this film are locked and cannot be changed by anyone', 'member cannot add own score to the locked film');
reset role;
select tests.login_as('viewer');
select throws_ok($$insert into public.scores (film_id, profile_id, score) values (7, tests.profile_id('viewer'), 5)$$,
  '42501', null, 'viewer cannot add a score to the locked film');
reset role;
select tests.login_service_role();
select throws_ok($$insert into public.scores (film_id, profile_id, score) values (7, '00000000-0000-4000-8000-0000000000a4', 11)$$,
  '42501', 'Scores for this film are locked and cannot be changed by anyone', 'secret key cannot add a score to the locked film');
reset role;
select throws_ok($$insert into public.scores (film_id, profile_id, score) values (7, '00000000-0000-4000-8000-0000000000a4', 11)$$,
  '42501', 'Scores for this film are locked and cannot be changed by anyone', 'postgres cannot add a score to the locked film');

-- ---------------------------------------------------------------- update
select tests.login_as('admin');
select throws_ok($$update public.scores set score = 10 where film_id = 7$$,
  '42501', 'Scores for this film are locked and cannot be changed by anyone', 'admin cannot edit the locked scores');
reset role;
select tests.login_as('moderator');
select throws_ok($$update public.scores set score = 10 where film_id = 7$$,
  '42501', 'Scores for this film are locked and cannot be changed by anyone', 'moderator cannot edit the locked scores');
reset role;
select tests.login_as('member');
select throws_ok($$update public.scores set score = 10 where film_id = 7 and profile_id = tests.profile_id('member')$$,
  '42501', 'Scores for this film are locked and cannot be changed by anyone', 'member cannot edit own locked score');
reset role;
select tests.login_as('viewer');
select is(tests.affected($$update public.scores set score = 10 where film_id = 7$$), 0, 'viewer cannot edit the locked scores');
reset role;
select tests.login_service_role();
select throws_ok($$update public.scores set score = 10 where film_id = 7$$,
  '42501', 'Scores for this film are locked and cannot be changed by anyone', 'secret key cannot edit the locked scores');
select throws_ok($$update public.scores set film_id = 1 where film_id = 7$$,
  '42501', 'Scores for this film are locked and cannot be changed by anyone', 'secret key cannot move the locked scores away');
reset role;
select throws_ok($$update public.scores set score = 10 where film_id = 7$$,
  '42501', 'Scores for this film are locked and cannot be changed by anyone', 'postgres cannot edit the locked scores');

-- ---------------------------------------------------------------- delete
select tests.login_as('admin');
select throws_ok($$delete from public.scores where film_id = 7$$,
  '42501', 'Scores for this film are locked and cannot be changed by anyone', 'admin cannot delete the locked scores');
reset role;
select tests.login_as('moderator');
select throws_ok($$delete from public.scores where film_id = 7$$,
  '42501', 'Scores for this film are locked and cannot be changed by anyone', 'moderator cannot delete the locked scores');
reset role;
select tests.login_as('member');
select throws_ok($$delete from public.scores where film_id = 7 and profile_id = tests.profile_id('member')$$,
  '42501', 'Scores for this film are locked and cannot be changed by anyone', 'member cannot delete own locked score');
reset role;
select tests.login_service_role();
select throws_ok($$delete from public.scores where film_id = 7$$,
  '42501', 'Scores for this film are locked and cannot be changed by anyone', 'secret key cannot delete the locked scores');
reset role;
select throws_ok($$delete from public.scores where film_id = 7$$,
  '42501', 'Scores for this film are locked and cannot be changed by anyone', 'postgres cannot delete the locked scores');

-- ---------------------------------------------------------------- unlock / delete film
select tests.login_as('admin');
select throws_ok($$update public.films set scores_locked = false where id = 7$$,
  '42501', 'scores_locked cannot be unset', 'admin cannot unlock the film');
select throws_ok($$delete from public.films where id = 7$$,
  '42501', 'This film''s scores are locked; the film cannot be deleted', 'admin cannot delete the locked film');
reset role;
select tests.login_as('moderator');
-- Moderators can't delete any film (RLS hides it from the delete).
select is(tests.affected($$delete from public.films where id = 7$$), 0,
  'moderator cannot delete the locked film');
reset role;
select tests.login_service_role();
select throws_ok($$update public.films set scores_locked = false where id = 7$$,
  '42501', 'scores_locked cannot be unset', 'secret key cannot unlock the film');
select throws_ok($$delete from public.films where id = 7$$,
  '42501', 'This film''s scores are locked; the film cannot be deleted', 'secret key cannot delete the locked film');
reset role;
select throws_ok($$update public.films set scores_locked = false where id = 7$$,
  '42501', 'scores_locked cannot be unset', 'postgres cannot unlock the film');
select throws_ok($$update public.films set is_easter_egg = false where id = 7$$,
  '23514', null, 'the locked film cannot stop being the easter egg');
select throws_ok($$delete from public.films where id = 7$$,
  '42501', 'This film''s scores are locked; the film cannot be deleted', 'postgres cannot delete the locked film');

-- TRUNCATE skips row triggers: the statement-level guard stops it, even for postgres
select throws_ok($$truncate public.scores$$, '42501', null, 'postgres cannot truncate scores while a film is locked');
select throws_ok($$truncate public.films cascade$$, '42501', null, 'postgres cannot truncate films (cascade) while a film is locked');
select throws_ok($$truncate public.profiles cascade$$, '42501', null, 'postgres cannot truncate profiles cascade (reaches films/scores)');
select throws_ok($$truncate public.attendance, public.scores$$, '42501', null, 'a multi-table truncate including scores is blocked');
select tests.login_service_role();
select throws_ok($$truncate public.scores$$, '42501', null, 'the secret key cannot truncate scores');
reset role;
select tests.login_as('admin');
select throws_ok($$truncate public.scores$$, '42501', null, 'a browser admin cannot truncate scores');
reset role;

select results_eq($$select profile_id, score from public.scores where film_id = 7 order by profile_id$$,
  $$values (tests.profile_id('admin'), 11.00::numeric),
           (tests.profile_id('moderator'), 11.00::numeric),
           (tests.profile_id('member'), 11.00::numeric)$$,
  'the three 11s are untouched');

-- Other film details stay editable by staff
select tests.login_as('moderator');
select is(tests.affected($$update public.films set overview = 'You just lost the game!' where id = 7$$), 1,
  'staff can still edit the easter egg''s other details');
reset role;

-- ---------------------------------------------------------------- >10 only via import, before locking
insert into public.films (id, tmdb_id, title, release_year, screened_on, kind, assigned_id, is_easter_egg)
overriding system value
values (500, 930001, 'Unlocked Egg', 2011, '2025-07-01', 'democratico', tests.profile_id('admin'), true);

select tests.login_as('admin');
select throws_ok($$insert into public.scores (film_id, profile_id, score) values (500, tests.profile_id('admin'), 11)$$,
  '23514', 'Score must be between 0 and 10', 'a browser admin cannot enter 11 even on an unlocked easter egg');
reset role;
select tests.login_service_role();
select lives_ok($$insert into public.scores (film_id, profile_id, score) values (500, '00000000-0000-4000-8000-0000000000a1', 11)$$,
  'the import (secret key) can enter 11 on an unlocked easter egg');
select lives_ok($$update public.films set scores_locked = true where id = 500$$, 'the import then locks it');
select throws_ok($$update public.scores set score = 10 where film_id = 500$$,
  '42501', 'Scores for this film are locked and cannot be changed by anyone', 'once locked, even the import cannot change it');
reset role;

-- ---------------------------------------------------------------- stats exclude the egg
select is((select avg_score from public.film_stats where film_id = 7), null, 'film_stats: no average for the easter egg');
select is((select score_count from public.film_stats where film_id = 7), 0, 'film_stats: easter-egg scores are not counted');
select is((select avg_score from public.film_stats where film_id = 1), 7.69::numeric, 'film_stats: ordinary average, two decimals');

select * from finish();
rollback;
