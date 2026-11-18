-- Matrix rows "Mark / unmark own attendance" (A ✔ Mo ✔ Me ✔ V ✘ — ✘) and
-- "Mark / unmark others' attendance" (A ✔ Mo ✔ Me ✘ V ✘ — ✘), including
-- unclaimed placeholders. Film 8 is a future film with no attendance.
begin;
select plan(26);

-- A viewer row to try to remove (set up by the import path).
insert into public.attendance (film_id, profile_id) values (1, tests.profile_id('viewer'));

-- ---------------------------------------------------------------- own: mark
select tests.login_as('admin');
select lives_ok($$insert into public.attendance (film_id, profile_id) values (8, tests.profile_id('admin'))$$,
  'admin can mark own attendance');
reset role;
select tests.login_as('moderator');
select lives_ok($$insert into public.attendance (film_id, profile_id) values (8, tests.profile_id('moderator'))$$,
  'moderator can mark own attendance');
reset role;
select tests.login_as('member');
select lives_ok($$insert into public.attendance (film_id, profile_id) values (8, tests.profile_id('member'))$$,
  'member can mark own attendance');
reset role;
select tests.login_as('viewer');
select throws_ok($$insert into public.attendance (film_id, profile_id) values (8, tests.profile_id('viewer'))$$,
  '42501', null, 'viewer cannot mark own attendance');
reset role;
select tests.login_anon();
select throws_ok($$insert into public.attendance (film_id, profile_id) values (8, '00000000-0000-4000-8000-0000000000a3')$$,
  '42501', null, 'anon cannot mark attendance');
reset role;

select is((select marked_by from public.attendance where film_id = 8 and profile_id = tests.profile_id('member')),
  tests.profile_id('member'), 'marked_by records who marked it');

-- ---------------------------------------------------------------- own: unmark
select tests.login_as('admin');
select is(tests.affected($$delete from public.attendance where film_id = 8 and profile_id = tests.profile_id('admin')$$), 1,
  'admin can unmark own attendance');
reset role;
select tests.login_as('moderator');
select is(tests.affected($$delete from public.attendance where film_id = 8 and profile_id = tests.profile_id('moderator')$$), 1,
  'moderator can unmark own attendance');
reset role;
select tests.login_as('member');
select is(tests.affected($$delete from public.attendance where film_id = 8 and profile_id = tests.profile_id('member')$$), 1,
  'member can unmark own attendance');
reset role;
select tests.login_as('viewer');
select is(tests.affected($$delete from public.attendance where film_id = 1 and profile_id = tests.profile_id('viewer')$$), 0,
  'viewer cannot unmark own attendance');
reset role;
select tests.login_anon();
select throws_ok($$delete from public.attendance where film_id = 1$$, '42501', null, 'anon cannot unmark attendance');
reset role;

-- ---------------------------------------------------------------- others: mark
select tests.login_as('admin');
select lives_ok($$insert into public.attendance (film_id, profile_id) values (8, tests.profile_id('member2'))$$,
  'admin can mark someone else''s attendance');
reset role;
select tests.login_as('moderator');
select lives_ok($$insert into public.attendance (film_id, profile_id) values (8, tests.profile_id('member'))$$,
  'moderator can mark someone else''s attendance');
select is((select marked_by from public.attendance where film_id = 8 and profile_id = tests.profile_id('member')),
  tests.profile_id('moderator'), 'marked_by records the moderator, not the person');
reset role;
select tests.login_as('member');
select throws_ok($$insert into public.attendance (film_id, profile_id) values (8, tests.profile_id('moderator'))$$,
  '42501', null, 'member cannot mark someone else''s attendance');
reset role;
select tests.login_as('viewer');
select throws_ok($$insert into public.attendance (film_id, profile_id) values (8, tests.profile_id('moderator'))$$,
  '42501', null, 'viewer cannot mark someone else''s attendance');
reset role;

-- ---------------------------------------------------------------- others: unmark
select tests.login_as('member');
select is(tests.affected($$delete from public.attendance where film_id = 8 and profile_id = tests.profile_id('member2')$$), 0,
  'member cannot unmark someone else''s attendance');
reset role;
select tests.login_as('viewer');
select is(tests.affected($$delete from public.attendance where film_id = 8 and profile_id = tests.profile_id('member2')$$), 0,
  'viewer cannot unmark someone else''s attendance');
reset role;
select tests.login_as('admin');
select is(tests.affected($$delete from public.attendance where film_id = 8 and profile_id = tests.profile_id('member2')$$), 1,
  'admin can unmark someone else''s attendance');
reset role;
select tests.login_as('moderator');
select is(tests.affected($$delete from public.attendance where film_id = 8 and profile_id = tests.profile_id('member')$$), 1,
  'moderator can unmark someone else''s attendance');
reset role;

-- ---------------------------------------------------------------- placeholders
select tests.login_as('moderator');
select lives_ok($$insert into public.attendance (film_id, profile_id) values (8, tests.profile_id('placeholder'))$$,
  'staff can mark an unclaimed placeholder present');
reset role;
select tests.login_as('member');
select throws_ok($$insert into public.attendance (film_id, profile_id) values (8, tests.profile_id('placeholder_no_colour'))$$,
  '42501', null, 'member cannot mark an unclaimed placeholder present');
select is(tests.affected($$delete from public.attendance where film_id = 8 and profile_id = tests.profile_id('placeholder')$$), 0,
  'member cannot unmark an unclaimed placeholder');
reset role;

-- ---------------------------------------------------------------- integrity
select tests.login_as('admin');
select throws_ok($$insert into public.attendance (film_id, profile_id) values (8, tests.profile_id('cinema'))$$,
  '23514', null, 'system profiles cannot attend');
select throws_ok($$insert into public.attendance (film_id, profile_id) values (8, tests.profile_id('admin')),
                                                                   (8, tests.profile_id('admin'))$$,
  '23505', null, 'a person is present at most once per film');
select throws_ok($$update public.attendance set marked_at = now() where film_id = 1$$,
  '42501', null, 'attendance rows are not updated (unmark = delete)');
reset role;

select * from finish();
rollback;
