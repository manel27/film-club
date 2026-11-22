-- Matrix rows "Record own pass" (A ✔ Mo ✔ Me ✔ V ✘ — ✘), "Record others'
-- passes, record next-chooser decision" (A ✔ Mo ✔ Me ✘ V ✘ — ✘) and
-- "Rotation adjustments" (A ✔ Mo ✔ Me ✘ V ✘ — ✘; decision N4).
begin;
select plan(49);

-- A viewer pass to try to remove (import path).
insert into public.rotation_passes (week_start, profile_id) values ('2026-03-02', tests.profile_id('viewer'));

-- ---------------------------------------------------------------- own pass
select tests.login_as('admin');
select lives_ok($$insert into public.rotation_passes (week_start, profile_id) values ('2026-03-02', tests.profile_id('admin'))$$,
  'admin can record own pass');
reset role;
select tests.login_as('moderator');
select lives_ok($$insert into public.rotation_passes (week_start, profile_id) values ('2026-03-02', tests.profile_id('moderator'))$$,
  'moderator can record own pass');
reset role;
select tests.login_as('member');
select lives_ok($$insert into public.rotation_passes (week_start, profile_id) values ('2099-03-02', tests.profile_id('member'))$$,
  'member can record own pass (a coming week)');
select is(tests.affected($$delete from public.rotation_passes where week_start = '2099-03-02' and profile_id = tests.profile_id('member')$$), 1,
  'member can withdraw own pass');
select throws_ok($$insert into public.rotation_passes (week_start, profile_id) values ('2099-03-03', tests.profile_id('member'))$$,
  '23514', null, 'a pass week must start on a Monday');
reset role;
select tests.login_as('viewer');
select throws_ok($$insert into public.rotation_passes (week_start, profile_id) values ('2026-03-09', tests.profile_id('viewer'))$$,
  '42501', null, 'viewer cannot record own pass');
select is(tests.affected($$delete from public.rotation_passes where profile_id = tests.profile_id('viewer')$$), 0,
  'viewer cannot withdraw own pass');
reset role;
select tests.login_anon();
select throws_ok($$insert into public.rotation_passes (week_start, profile_id) values ('2026-03-09', '00000000-0000-4000-8000-0000000000a3')$$,
  '42501', null, 'anon cannot record a pass');
reset role;

-- ---------------------------------------------------------------- others' passes
select tests.login_as('admin');
select lives_ok($$insert into public.rotation_passes (week_start, profile_id) values ('2026-03-09', tests.profile_id('member'))$$,
  'admin can record someone else''s pass');
reset role;
select tests.login_as('moderator');
select lives_ok($$insert into public.rotation_passes (week_start, profile_id) values ('2026-03-09', tests.profile_id('placeholder'))$$,
  'moderator can record someone else''s pass (placeholder too)');
reset role;
select is((select created_by from public.rotation_passes where week_start = '2026-03-09' and profile_id = tests.profile_id('placeholder')),
  tests.profile_id('moderator'), 'created_by records who entered the pass');
select tests.login_as('member');
select throws_ok($$insert into public.rotation_passes (week_start, profile_id) values ('2026-03-09', tests.profile_id('member2'))$$,
  '42501', null, 'member cannot record someone else''s pass');
select is(tests.affected($$delete from public.rotation_passes where week_start = '2026-03-09' and profile_id = tests.profile_id('placeholder')$$), 0,
  'member cannot withdraw someone else''s pass');
reset role;
select tests.login_as('viewer');
select throws_ok($$insert into public.rotation_passes (week_start, profile_id) values ('2026-03-09', tests.profile_id('member2'))$$,
  '42501', null, 'viewer cannot record someone else''s pass');
reset role;
select tests.login_as('moderator');
select is(tests.affected($$delete from public.rotation_passes where week_start = '2026-03-09' and profile_id = tests.profile_id('member')$$), 1,
  'moderator can withdraw someone else''s pass');
reset role;
select tests.login_as('admin');
select is(tests.affected($$delete from public.rotation_passes where week_start = '2026-03-09' and profile_id = tests.profile_id('placeholder')$$), 1,
  'admin can withdraw someone else''s pass');
select throws_ok($$insert into public.rotation_passes (week_start, profile_id) values ('2026-03-09', tests.profile_id('cinema'))$$,
  '23514', null, 'system profiles cannot pass');
reset role;

-- ---------------------------------------------------------------- next-chooser decisions
select tests.login_as('admin');
select lives_ok($$insert into public.rotation_next (week_start, profile_id) values ('2026-03-16', tests.profile_id('member'))$$,
  'admin can record a next-chooser decision');
reset role;
select tests.login_as('moderator');
select lives_ok($$insert into public.rotation_next (week_start, profile_id) values ('2026-03-23', tests.profile_id('member2'))$$,
  'moderator can record a next-chooser decision');
select is(tests.affected($$update public.rotation_next set profile_id = tests.profile_id('member2') where week_start = '2026-03-16'$$), 1,
  'moderator can change a decision');
reset role;
select is((select decided_by from public.rotation_next where week_start = '2026-03-16'), tests.profile_id('moderator'),
  'decided_by records the last decider');
select tests.login_as('moderator');
select throws_ok($$insert into public.rotation_next (week_start, profile_id) values ('2026-04-06', tests.profile_id('cinema'))$$,
  '23514', null, 'a system profile cannot be picked as next chooser');
select throws_ok($$update public.rotation_next set profile_id = tests.profile_id('archive') where week_start = '2026-03-23'$$,
  '23514', null, 'a decision cannot be changed to a system profile');
select is(tests.affected($$update public.rotation_next set created_at = '2000-01-01' where week_start = '2026-03-23'$$), 1,
  'a browser update that touches created_at succeeds...');
reset role;
select isnt((select created_at from public.rotation_next where week_start = '2026-03-23'), '2000-01-01'::timestamptz,
  '...but created_at is kept (immutable for browsers)');
select tests.login_as('moderator');
insert into public.rotation_next (week_start, profile_id, created_at) values ('2026-04-13', tests.profile_id('member'), '2000-01-01');
reset role;
select ok((select created_at > '2020-01-01' from public.rotation_next where week_start = '2026-04-13'),
  'a forged created_at on insert is replaced by the server time');
select throws_ok($$insert into public.rotation_next (week_start, profile_id) values ('2026-04-20', '00000000-0000-4000-8000-0000000000c2')$$,
  '23514', null, 'the import cannot pick a system profile as next chooser either');
select tests.login_as('member');
select throws_ok($$insert into public.rotation_next (week_start, profile_id) values ('2026-03-30', tests.profile_id('member'))$$,
  '42501', null, 'member cannot record a next-chooser decision');
select is(tests.affected($$update public.rotation_next set profile_id = tests.profile_id('member') where week_start = '2026-03-16'$$), 0,
  'member cannot change a decision');
select is(tests.affected($$delete from public.rotation_next where week_start = '2026-03-16'$$), 0,
  'member cannot delete a decision');
reset role;
select tests.login_as('viewer');
select throws_ok($$insert into public.rotation_next (week_start, profile_id) values ('2026-03-30', tests.profile_id('viewer'))$$,
  '42501', null, 'viewer cannot record a next-chooser decision');
reset role;
select tests.login_anon();
select throws_ok($$insert into public.rotation_next (week_start, profile_id) values ('2026-03-30', '00000000-0000-4000-8000-0000000000a3')$$,
  '42501', null, 'anon cannot record a next-chooser decision');
reset role;
select tests.login_as('moderator');
select is(tests.affected($$delete from public.rotation_next where week_start = '2026-03-16'$$), 1,
  'moderator can delete a decision');
reset role;

-- ---------------------------------------------------------------- adjustments
select tests.login_as('admin');
select lives_ok($$insert into public.rotation_adjustments (profile_id, set_to, reason) values (tests.profile_id('member'), 4, 'go-live')$$,
  'admin can enter a starting value');
reset role;
select tests.login_as('moderator');
select lives_ok($$insert into public.rotation_adjustments (profile_id, delta, reason) values (tests.profile_id('member2'), -1, 'correction')$$,
  'moderator can enter a correction');
select lives_ok($$insert into public.rotation_adjustments (profile_id, clear_owed_turn, reason) values (tests.profile_id('member'), true, 'owed turn cleared')$$,
  'moderator can clear an owed turn');
select is(tests.affected($$update public.rotation_adjustments set reason = 'typo fixed' where reason = 'go-live'$$), 1,
  'moderator can edit an adjustment');
reset role;
select is((select created_by from public.rotation_adjustments where reason = 'correction'), tests.profile_id('moderator'),
  'created_by records the moderator');
select is((select created_by from public.rotation_adjustments where reason = 'typo fixed'), tests.profile_id('admin'),
  'editing keeps the original author on record');
select tests.login_as('member');
select throws_ok($$insert into public.rotation_adjustments (profile_id, set_to) values (tests.profile_id('member'), 99)$$,
  '42501', null, 'member cannot enter an adjustment (not even for themselves)');
select is(tests.affected($$update public.rotation_adjustments set set_to = 99$$), 0, 'member cannot edit adjustments');
select is(tests.affected($$delete from public.rotation_adjustments$$), 0, 'member cannot delete adjustments');
reset role;
select tests.login_as('viewer');
select throws_ok($$insert into public.rotation_adjustments (profile_id, set_to) values (tests.profile_id('viewer'), 99)$$,
  '42501', null, 'viewer cannot enter an adjustment');
select is(tests.affected($$update public.rotation_adjustments set set_to = 99$$), 0, 'viewer cannot edit adjustments');
reset role;
select tests.login_anon();
select throws_ok($$insert into public.rotation_adjustments (profile_id, set_to) values ('00000000-0000-4000-8000-0000000000a3', 99)$$,
  '42501', null, 'anon cannot enter an adjustment');
reset role;
select tests.login_as('moderator');
select is(tests.affected($$delete from public.rotation_adjustments where reason = 'correction'$$), 1,
  'moderator can delete an adjustment');
select throws_ok($$insert into public.rotation_adjustments (profile_id, delta, set_to) values (tests.profile_id('member'), 1, 2)$$,
  '23514', null, 'an adjustment is either a delta or a set_to, not both');
select throws_ok($$insert into public.rotation_adjustments (profile_id) values (tests.profile_id('member'))$$,
  '23514', null, 'an empty adjustment is rejected');
select throws_ok($$insert into public.rotation_adjustments (profile_id, set_to) values (tests.profile_id('member'), -1)$$,
  '23514', null, 'a starting value cannot be negative');
reset role;

select * from finish();
rollback;
