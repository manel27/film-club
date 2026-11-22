-- rotation_standings (plan 6): the worked example 6.3 (with its variant),
-- who may read it, and that staff adjustments, passes and decisions reach it
-- while members and viewers can't change them. The TS algorithm is checked
-- against this view on the same data by
-- supabase/functions/tests/rotation-standings.test.ts.
--
-- Worked example cast: Ana = Orla (admin), Bea = Kwame (member),
-- Gui = Tamsin (moderator), Rocha = Viggo (placeholder member).
begin;
select plan(44);

select ok((select c.reloptions @> array['security_invoker=true'] from pg_class c where c.oid = 'public.rotation_standings'::regclass),
  'rotation_standings runs with the caller''s rights (RLS applies)');

-- A clean window: go-live on Monday 2026-03-02, after all seed screenings
-- except the planned one (removed so the result never depends on today).
update public.app_settings set value = '"2026-03-02"' where key = 'rotation_epoch';
delete from public.films where id = 8;

create temporary view we as
select string_agg(p.display_name || ' ' || s.points || coalesce(' owed#' || s.owed_rank, ''), ', ' order by p.display_name) as standings
from public.rotation_standings s
join public.profiles p on p.id = s.profile_id
where p.id in (tests.profile_id('admin'), tests.profile_id('moderator'), tests.profile_id('member'), tests.profile_id('placeholder'));

create temporary table cast_ids (role text primary key, id uuid) on commit drop;
insert into cast_ids values
  ('ana', tests.profile_id('admin')), ('bea', tests.profile_id('member')),
  ('gui', tests.profile_id('moderator')), ('rocha', tests.profile_id('placeholder'));

-- ---------------------------------------------------------------- who is in it
select is((select count(*)::integer from public.rotation_standings), 6,
  'everyone in the rotation is listed (seed: 4 logins + 2 placeholders)');
select is((select count(*)::integer from public.rotation_standings where profile_id in
  (tests.profile_id('viewer'), tests.profile_id('cinema'), tests.profile_id('archive'))), 0,
  'viewers and system profiles are not in the rotation');
select is((select count(distinct week_start)::integer from public.rotation_standings where extract(isodow from week_start) = 1
  and week_start between (now() at time zone 'Europe/Lisbon')::date - 6 and (now() at time zone 'Europe/Lisbon')::date + 7), 1,
  'week_start is the Monday of this week or the next');
select is((select standings from we), 'Kwame 0, Orla 0, Tamsin 0, Viggo 0', 'everyone starts at 0 at go-live');

-- ---------------------------------------------------------------- worked example
insert into public.rotation_adjustments (profile_id, set_to, reason, effective_at)
select id, v, 'Starting value', '2026-03-02 00:00 Europe/Lisbon'
from cast_ids join (values ('ana', 3), ('bea', 2), ('gui', 2), ('rocha', 0)) v (role, v) using (role);
select is((select standings from we), 'Kwame 2, Orla 3, Tamsin 2, Viggo 0', 'starting values: Ana 3, Bea 2, Gui 2, Rocha 0');

insert into public.films (title, release_year, screened_on, kind, assigned_id, turn_holder_id) values
  ('Rotation week 1', 2001, '2026-03-07', 'normal', tests.profile_id('admin'), null);
insert into public.attendance (film_id, profile_id)
select f.id, c.id from public.films f, cast_ids c where f.title = 'Rotation week 1' and c.role in ('ana', 'bea', 'gui');
select is((select standings from we), 'Kwame 3, Orla 0, Tamsin 3, Viggo 0', 'week 1: normal, Ana chooses and resets');

insert into public.films (title, release_year, screened_on, kind, assigned_id, turn_holder_id) values
  ('Rotation week 2', 2002, '2026-03-14', 'democratico', tests.profile_id('placeholder'), tests.profile_id('member'));
insert into public.attendance (film_id, profile_id)
select f.id, c.id from public.films f, cast_ids c where f.title = 'Rotation week 2' and c.role in ('ana', 'gui', 'rocha');
select is((select standings from we), 'Kwame 3 owed#1, Orla 1, Tamsin 4, Viggo 1',
  'week 2: Democrático resets nobody; Bea gets an owed turn');
select is((select owed_since from public.rotation_standings where profile_id = tests.profile_id('member')), '2026-03-14'::date,
  'the owed turn records the Democrático Bea missed');

-- Variant: Bea passes for week 3; her owed turn clears and she keeps 3.
insert into public.rotation_passes (week_start, profile_id) values ('2026-03-16', tests.profile_id('member'));
select is((select standings from we), 'Kwame 3, Orla 1, Tamsin 4, Viggo 1', 'variant: a pass clears the owed turn, points kept');
delete from public.rotation_passes where week_start = '2026-03-16';

insert into public.films (title, release_year, screened_on, kind, assigned_id, turn_holder_id) values
  ('Rotation week 3', 2003, '2026-03-21', 'normal', tests.profile_id('member'), null);
insert into public.attendance (film_id, profile_id)
select f.id, c.id from public.films f, cast_ids c where f.title = 'Rotation week 3';
select is((select standings from we), 'Kwame 0, Orla 2, Tamsin 5, Viggo 2', 'week 3: Bea chooses, resets, owed turn cleared');

insert into public.rotation_passes (week_start, profile_id) values ('2026-03-30', tests.profile_id('placeholder'));
insert into public.films (title, release_year, screened_on, kind, assigned_id, turn_holder_id) values
  ('Rotation week 4', 2004, '2026-03-28', 'normal', tests.profile_id('moderator'), null);
insert into public.attendance (film_id, profile_id)
select f.id, c.id from public.films f, cast_ids c where f.title = 'Rotation week 4' and c.role in ('gui', 'rocha');
select is((select standings from we), 'Kwame 0, Orla 2, Tamsin 0, Viggo 3', 'week 4: Gui resets; Rocha (passing week 5) still gains +1');

-- Cinema and Maratona change nothing (6.1, 6.4).
insert into public.films (title, release_year, screened_on, kind, assigned_id) values
  ('Rotation cinema', 2005, '2026-04-04', 'cinema', tests.profile_id('cinema')),
  ('Rotation maratona', 2006, '2026-04-04', 'maratona', tests.profile_id('admin'));
insert into public.attendance (film_id, profile_id)
select f.id, c.id from public.films f, cast_ids c where f.title in ('Rotation cinema', 'Rotation maratona');
select is((select standings from we), 'Kwame 0, Orla 2, Tamsin 0, Viggo 3', 'Cinema and Maratona: no effect');

-- ---------------------------------------------------------------- reading
select tests.login_as('viewer');
select is((select count(*)::integer from public.rotation_standings), 6, 'a viewer can read the standings');
reset role;
select tests.login_as('member');
select is((select points from public.rotation_standings where profile_id = tests.profile_id('placeholder')), 3,
  'a member can read the standings');
reset role;
select tests.login_anon();
select throws_ok('select * from public.rotation_standings', '42501', null, 'anon cannot read the standings');
select throws_ok('select * from app.rotation_replay()', '42501', null, 'anon cannot call the replay');
reset role;

-- ---------------------------------------------------------------- staff write, others can't
select tests.login_as('moderator');
select lives_ok($$insert into public.rotation_adjustments (profile_id, delta, reason) values (tests.profile_id('placeholder'), 2, 'correction')$$,
  'moderator can correct points');
select lives_ok($$insert into public.rotation_adjustments (profile_id, clear_owed_turn, reason) values (tests.profile_id('member'), true, 'cleared')$$,
  'moderator can clear an owed turn');
select lives_ok($$insert into public.rotation_next (week_start, profile_id) values (date_trunc('week', now())::date, tests.profile_id('admin'))$$,
  'moderator can record a next-chooser decision');
select is((select points from public.rotation_standings where profile_id = tests.profile_id('placeholder')), 5,
  'the moderator''s correction reaches the standings');
reset role;
select tests.login_as('member');
select throws_ok($$insert into public.rotation_adjustments (profile_id, delta) values (tests.profile_id('member'), 9)$$,
  '42501', null, 'member cannot adjust points');
select throws_ok($$insert into public.rotation_next (week_start, profile_id) values (date_trunc('week', now())::date + 7, tests.profile_id('member'))$$,
  '42501', null, 'member cannot record a next-chooser decision');
reset role;
select tests.login_as('viewer');
select throws_ok($$insert into public.rotation_adjustments (profile_id, delta) values (tests.profile_id('viewer'), 9)$$,
  '42501', null, 'viewer cannot adjust points');
reset role;

-- ---------------------------------------------------------------- R2: never below 0
insert into public.rotation_adjustments (profile_id, delta, reason) values (tests.profile_id('placeholder'), -100, 'too much');
select is((select points from public.rotation_standings where profile_id = tests.profile_id('placeholder')), 0,
  'a correction never takes points below 0');
insert into public.rotation_adjustments (profile_id, delta, reason) values (tests.profile_id('placeholder'), 1, 'one back');
select is((select points from public.rotation_standings where profile_id = tests.profile_id('placeholder')), 1,
  'the floor applies after each correction (0 + 1, not 5 - 100 + 1)');

-- ---------------------------------------------------------------- sane values
select throws_ok($$insert into public.rotation_adjustments (profile_id, delta) values (tests.profile_id('member'), 1001)$$,
  '23514', null, 'a correction is at most 1000');
select throws_ok($$insert into public.rotation_adjustments (profile_id, delta) values (tests.profile_id('member'), -2147483648)$$,
  '23514', null, 'a correction is at least -1000');
select throws_ok($$insert into public.rotation_adjustments (profile_id, set_to) values (tests.profile_id('member'), 1001)$$,
  '23514', null, 'a starting value is at most 1000');

-- ---------------------------------------------------------------- R4: own passes from the coming week on
-- Kwame passed for this week, the week's screening has happened (today), so
-- the coming week is next week: his pass is history and stays put.
insert into public.rotation_passes (week_start, profile_id) values
  (date_trunc('week', (now() at time zone 'Europe/Lisbon')::date)::date, tests.profile_id('member'));
insert into public.films (title, release_year, screened_on, kind, assigned_id) values
  ('Rotation this week', 2007, (now() at time zone 'Europe/Lisbon')::date, 'normal', tests.profile_id('admin'));
select is(app.rotation_coming_week(), date_trunc('week', (now() at time zone 'Europe/Lisbon')::date)::date + 7,
  'after this week''s screening the coming week is next week');
select tests.login_as('member');
select is(tests.affected($$delete from public.rotation_passes where profile_id = tests.profile_id('member')
  and week_start = date_trunc('week', (now() at time zone 'Europe/Lisbon')::date)::date$$), 0,
  'a member cannot remove a pass for a week already screened');
select throws_ok($$insert into public.rotation_passes (week_start, profile_id) values ('2026-03-23', tests.profile_id('member'))$$,
  '42501', null, 'a member cannot add a pass for a past week');
select lives_ok($$insert into public.rotation_passes (week_start, profile_id)
  values (date_trunc('week', (now() at time zone 'Europe/Lisbon')::date)::date + 7, tests.profile_id('member'))$$,
  'a member can pass for the coming week');
select is(tests.affected($$delete from public.rotation_passes where profile_id = tests.profile_id('member')
  and week_start = date_trunc('week', (now() at time zone 'Europe/Lisbon')::date)::date + 7$$), 1,
  'a member can take back a pass for the coming week');
reset role;
select tests.login_as('moderator');
select is(tests.affected($$delete from public.rotation_passes where profile_id = tests.profile_id('member')
  and week_start = date_trunc('week', (now() at time zone 'Europe/Lisbon')::date)::date$$), 1,
  'staff can still correct a past pass');

-- ---------------------------------------------------------------- viewers aren't in the rotation
select throws_ok($$insert into public.rotation_passes (week_start, profile_id) values ('2099-03-02', tests.profile_id('viewer'))$$,
  '42501', null, 'staff cannot record a pass for a viewer');
select throws_ok($$insert into public.rotation_next (week_start, profile_id) values ('2099-03-02', tests.profile_id('viewer'))$$,
  '42501', null, 'staff cannot pick a viewer as next chooser');
select throws_ok($$update public.rotation_next set profile_id = tests.profile_id('viewer') where week_start = date_trunc('week', now())::date$$,
  '42501', null, 'staff cannot change a decision to a viewer');
reset role;

-- ---------------------------------------------------------------- epoch format (R3)
select tests.login_as('admin');
select throws_ok($$update public.app_settings set value = '"2026-02-30"' where key = 'rotation_epoch'$$,
  '23514', null, 'the epoch must be a real date');
select throws_ok($$update public.app_settings set value = '"2026/03/02"' where key = 'rotation_epoch'$$,
  '23514', null, 'the epoch must be written YYYY-MM-DD');
select throws_ok($$update public.app_settings set value = '20260302' where key = 'rotation_epoch'$$,
  '23514', null, 'the epoch must be a JSON string');
select is(tests.affected($$update public.app_settings set value = '"2026-03-04"' where key = 'rotation_epoch'$$), 1,
  'the admin can set a valid epoch (any weekday)');
reset role;

-- ---------------------------------------------------------------- epoch
update public.app_settings set value = to_jsonb(((now() at time zone 'Europe/Lisbon')::date + 1)::text) where key = 'rotation_epoch';
select is((select count(*)::integer from public.rotation_standings), 0, 'an epoch in the future: no standings yet');
delete from public.app_settings where key = 'rotation_epoch';
select is((select count(*)::integer from public.rotation_standings), 0, 'no epoch (before go-live): no standings');

select * from finish();
rollback;
