-- Matrix rows "Enter / edit own score" (A ✔ Mo ✔ Me ✔ V ✘ — ✘) and
-- "Enter / edit / delete others' scores" (A ✔ Mo ✔ Me ✘ V ✘ — ✘), plus the
-- 0–10 range with two decimals. Film 8 has no scores yet.
begin;
select plan(42);

-- A viewer score to try to change (import path).
insert into public.scores (film_id, profile_id, score) values (1, tests.profile_id('viewer'), 5);

-- ---------------------------------------------------------------- own: enter
select tests.login_as('admin');
select lives_ok($$insert into public.scores (film_id, profile_id, score) values (8, tests.profile_id('admin'), 8)$$,
  'admin can enter own score');
reset role;
select tests.login_as('moderator');
select lives_ok($$insert into public.scores (film_id, profile_id, score) values (8, tests.profile_id('moderator'), 7.5)$$,
  'moderator can enter own score');
reset role;
select tests.login_as('member');
select lives_ok($$insert into public.scores (film_id, profile_id, score) values (8, tests.profile_id('member'), 6.25)$$,
  'member can enter own score (before the screening, without attendance)');
reset role;
select tests.login_as('viewer');
select throws_ok($$insert into public.scores (film_id, profile_id, score) values (8, tests.profile_id('viewer'), 5)$$,
  '42501', null, 'viewer cannot enter own score');
reset role;
select tests.login_anon();
select throws_ok($$insert into public.scores (film_id, profile_id, score) values (8, '00000000-0000-4000-8000-0000000000a3', 5)$$,
  '42501', null, 'anon cannot enter a score');
reset role;

-- ---------------------------------------------------------------- own: edit / delete
select tests.login_as('admin');
select is(tests.affected($$update public.scores set score = 9 where film_id = 8 and profile_id = tests.profile_id('admin')$$), 1,
  'admin can edit own score');
reset role;
select tests.login_as('moderator');
select is(tests.affected($$update public.scores set score = 8 where film_id = 8 and profile_id = tests.profile_id('moderator')$$), 1,
  'moderator can edit own score');
reset role;
select tests.login_as('member');
select is(tests.affected($$update public.scores set score = 7.25 where film_id = 8 and profile_id = tests.profile_id('member')$$), 1,
  'member can edit own score');
reset role;
select is((select score from public.scores where film_id = 8 and profile_id = tests.profile_id('member')), 7.25::numeric,
  'two decimals are stored exactly');
select tests.login_as('viewer');
select is(tests.affected($$update public.scores set score = 9 where film_id = 1 and profile_id = tests.profile_id('viewer')$$), 0,
  'viewer cannot edit own score');
select is(tests.affected($$delete from public.scores where film_id = 1 and profile_id = tests.profile_id('viewer')$$), 0,
  'viewer cannot delete own score');
reset role;
select tests.login_anon();
select throws_ok($$update public.scores set score = 1$$, '42501', null, 'anon cannot edit scores');
select throws_ok($$delete from public.scores$$, '42501', null, 'anon cannot delete scores');
reset role;
select tests.login_as('member');
select is(tests.affected($$delete from public.scores where film_id = 8 and profile_id = tests.profile_id('member')$$), 1,
  'member can remove own score');
select throws_ok($$update public.scores set profile_id = tests.profile_id('member2') where film_id = 1 and profile_id = tests.profile_id('member')$$,
  '42501', null, 'member cannot move own score onto someone else');
reset role;

-- ---------------------------------------------------------------- others: enter
select tests.login_as('admin');
select lives_ok($$insert into public.scores (film_id, profile_id, score) values (8, tests.profile_id('member2'), 4)$$,
  'admin can enter someone else''s score');
reset role;
select tests.login_as('moderator');
select lives_ok($$insert into public.scores (film_id, profile_id, score) values (8, tests.profile_id('member'), 3)$$,
  'moderator can enter someone else''s score');
reset role;
select is((select entered_by from public.scores where film_id = 8 and profile_id = tests.profile_id('member')),
  tests.profile_id('moderator'), 'entered_by records the moderator');
select tests.login_as('member');
select throws_ok($$insert into public.scores (film_id, profile_id, score) values (8, tests.profile_id('viewer'), 5)$$,
  '42501', null, 'member cannot enter someone else''s score');
reset role;
select tests.login_as('viewer');
select throws_ok($$insert into public.scores (film_id, profile_id, score) values (8, tests.profile_id('placeholder'), 5)$$,
  '42501', null, 'viewer cannot enter someone else''s score');
reset role;

-- ---------------------------------------------------------------- others: edit
select tests.login_as('member');
select is(tests.affected($$update public.scores set score = 1 where film_id = 8 and profile_id = tests.profile_id('member2')$$), 0,
  'member cannot edit someone else''s score');
reset role;
select tests.login_as('viewer');
select is(tests.affected($$update public.scores set score = 1 where film_id = 8 and profile_id = tests.profile_id('member2')$$), 0,
  'viewer cannot edit someone else''s score');
reset role;
select tests.login_as('admin');
select is(tests.affected($$update public.scores set score = 5.5 where film_id = 8 and profile_id = tests.profile_id('member2')$$), 1,
  'admin can edit someone else''s score');
reset role;
select tests.login_as('moderator');
select is(tests.affected($$update public.scores set score = 6.5 where film_id = 8 and profile_id = tests.profile_id('member2')$$), 1,
  'moderator can edit someone else''s score');
reset role;
select is((select entered_by from public.scores where film_id = 8 and profile_id = tests.profile_id('member2')),
  tests.profile_id('moderator'), 'entered_by follows the last editor');

-- ---------------------------------------------------------------- others: delete
select tests.login_as('member');
select is(tests.affected($$delete from public.scores where film_id = 8 and profile_id = tests.profile_id('member2')$$), 0,
  'member cannot delete someone else''s score');
reset role;
select tests.login_as('viewer');
select is(tests.affected($$delete from public.scores where film_id = 8 and profile_id = tests.profile_id('member2')$$), 0,
  'viewer cannot delete someone else''s score');
reset role;
select tests.login_as('moderator');
select is(tests.affected($$delete from public.scores where film_id = 8 and profile_id = tests.profile_id('member2')$$), 1,
  'moderator can delete someone else''s score');
reset role;
select tests.login_as('admin');
select is(tests.affected($$delete from public.scores where film_id = 8 and profile_id = tests.profile_id('member')$$), 1,
  'admin can delete someone else''s score');
reset role;

-- ---------------------------------------------------------------- placeholders
select tests.login_as('admin');
select lives_ok($$insert into public.scores (film_id, profile_id, score) values (8, tests.profile_id('placeholder'), 7)$$,
  'staff can score for an unclaimed placeholder');
reset role;
select tests.login_as('member');
select is(tests.affected($$update public.scores set score = 0 where film_id = 8 and profile_id = tests.profile_id('placeholder')$$), 0,
  'member cannot change an unclaimed placeholder''s score');
reset role;

-- ---------------------------------------------------------------- range
select tests.login_as('member');
select throws_ok($$insert into public.scores (film_id, profile_id, score) values (4, tests.profile_id('member'), -0.01)$$,
  '23514', 'Score must be between 0 and 10', 'a score below 0 is rejected');
select throws_ok($$insert into public.scores (film_id, profile_id, score) values (4, tests.profile_id('member'), 10.01)$$,
  '23514', 'Score must be between 0 and 10', 'a score above 10 is rejected');
select throws_ok($$insert into public.scores (film_id, profile_id, score) values (4, tests.profile_id('member'), 11)$$,
  '23514', 'Score must be between 0 and 10', 'an 11 is rejected on an ordinary film');
select throws_ok($$insert into public.scores (film_id, profile_id, score) values (4, tests.profile_id('member'), 100)$$,
  '22003', null, 'a score that doesn''t fit numeric(4,2) is rejected');
select lives_ok($$insert into public.scores (film_id, profile_id, score) values (4, tests.profile_id('member'), 0)$$,
  '0 is allowed');
select lives_ok($$update public.scores set score = 10 where film_id = 4 and profile_id = tests.profile_id('member')$$,
  '10 is allowed');
select throws_ok($$update public.scores set score = 10.5 where film_id = 4 and profile_id = tests.profile_id('member')$$,
  '23514', 'Score must be between 0 and 10', 'an edit above 10 is rejected');
select throws_ok($$insert into public.scores (film_id, profile_id, score) values (4, tests.profile_id('member'), null)$$,
  '23502', null, 'a score cannot be null');
reset role;
select tests.login_as('admin');
select throws_ok($$insert into public.scores (film_id, profile_id, score) values (4, tests.profile_id('admin'), 10.5)$$,
  '23514', 'Score must be between 0 and 10', 'admin is held to 0–10 too');
select throws_ok($$insert into public.scores (film_id, profile_id, score) values (4, tests.profile_id('archive'), 5)$$,
  '23514', null, 'system profiles cannot score');
reset role;
select tests.login_service_role();
select throws_ok($$insert into public.scores (film_id, profile_id, score) values (4, '00000000-0000-4000-8000-0000000000a4', 11)$$,
  '23514', 'Score must be between 0 and 10', 'the secret key is held to 0–10 on ordinary films');
reset role;

select * from finish();
rollback;
