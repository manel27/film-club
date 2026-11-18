-- Matrix row "Read films, attendance, scores, comments, profiles, rotation":
-- A ✔ Mo ✔ Me ✔ V ✔ — ✘ (plus: a logged-in user without a profile sees
-- nothing; private tables stay private).
begin;
select plan(73);

create temporary table readable (name text) on commit drop;
insert into readable values
  ('profiles'), ('films'), ('attendance'), ('scores'), ('comments'),
  ('rotation_adjustments'), ('rotation_passes'), ('rotation_next'),
  ('app_settings'), ('film_stats');
grant select on readable to anon, authenticated;

-- Logged-in roles read everything shared (10 relations x 4 roles)
select tests.login_as('admin');
select ok(tests.row_count(format('select * from public.%I', name)) > 0, format('admin can read %s', name))
from readable order by name;
reset role;

select tests.login_as('moderator');
select ok(tests.row_count(format('select * from public.%I', name)) > 0, format('moderator can read %s', name))
from readable order by name;
reset role;

select tests.login_as('member');
select ok(tests.row_count(format('select * from public.%I', name)) > 0, format('member can read %s', name))
from readable order by name;
reset role;

select tests.login_as('viewer');
select ok(tests.row_count(format('select * from public.%I', name)) > 0, format('viewer can read %s', name))
from readable order by name;
reset role;

-- Readers see the same rows the database holds (no partial visibility)
select tests.login_as('viewer');
select is(tests.row_count('select * from public.scores'), 15, 'viewer sees every score row, including the easter egg');
select is(tests.row_count('select * from public.profiles'), 9, 'viewer sees every profile, including placeholders and system profiles');
reset role;

-- Not logged in: nothing at all (10 relations + the private ones + the RPC)
select tests.login_anon();
select throws_ok(format('select * from public.%I', name), '42501', null, format('anon cannot read %s', name))
from readable order by name;
select throws_ok('select * from public.invites', '42501', null, 'anon cannot read invites');
select throws_ok('select * from public.user_settings', '42501', null, 'anon cannot read user_settings');
select throws_ok('select * from public.rate_limits', '42501', null, 'anon cannot read rate_limits');
select throws_ok($$select * from public.film_duplicate_check('The Quiet Orchard', 2019)$$, '42501', null,
  'anon cannot call film_duplicate_check');
reset role;

-- Logged in but without a profile: nothing
insert into auth.users (id, instance_id, aud, role, email)
values ('10000000-0000-4000-8000-0000000000ff', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'orphan@example.test');
select tests.login_as_uid('10000000-0000-4000-8000-0000000000ff');
select is(tests.row_count(format('select * from public.%I', name)), 0, format('user without a profile reads no %s', name))
from readable order by name;
reset role;

-- Invites: admin only
select tests.login_as('admin');
select is(tests.row_count('select * from public.invites'), 1, 'admin can read invites');
reset role;
select tests.login_as('moderator');
select is(tests.row_count('select * from public.invites'), 0, 'moderator cannot read invites');
reset role;
select tests.login_as('member');
select is(tests.row_count('select * from public.invites'), 0, 'member cannot read invites');
reset role;
select tests.login_as('viewer');
select is(tests.row_count('select * from public.invites'), 0, 'viewer cannot read invites');
reset role;

-- user_settings: each person sees only their own
select tests.login_as('member');
select is(tests.row_count('select * from public.user_settings'), 1, 'member reads own user_settings');
reset role;
select tests.login_as('admin');
select is(tests.row_count('select * from public.user_settings'), 0, 'admin cannot read someone else''s user_settings');
reset role;

-- rate_limits: no browser role at all
select tests.login_as('admin');
select throws_ok('select * from public.rate_limits', '42501', null, 'admin cannot read rate_limits from a browser');
reset role;

select * from finish();
rollback;
