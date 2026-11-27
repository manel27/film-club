-- Phase 12 admin (decisions A1, A2): export_data() is admin only and
-- complete; profile_remove_login() is secret key only with its guards; a
-- removed login leaves the profile and its history, unclaimed.
begin;
select plan(56);

-- ---------------------------------------------------------------- export: admin only
select tests.login_anon();
select throws_ok($$select public.export_data()$$, '42501', null, 'anon cannot export');
reset role;
select tests.login_as('viewer');
select throws_ok($$select public.export_data()$$, '42501', null, 'viewer cannot export');
reset role;
select tests.login_as('member');
select throws_ok($$select public.export_data()$$, '42501', null, 'member cannot export');
reset role;
select tests.login_as('moderator');
select throws_ok($$select public.export_data()$$, '42501', null, 'moderator cannot export');
reset role;

-- More than PostgREST's 1,000 rows of scores: 150 films x 7 people.
insert into public.films (title, release_year, screened_on, kind, assigned_id)
select 'Bulk film ' || n, 2000, date '2025-01-04' + n * 7, 'normal', tests.profile_id('member')
from generate_series(1, 150) n;
insert into public.scores (film_id, profile_id, score)
select f.id, p.id, 5
from public.films f cross join public.profiles p
where f.title like 'Bulk film %' and not p.is_system;
insert into public.user_settings (profile_id, theme) values (tests.profile_id('member'), 'batman')
  on conflict (profile_id) do update set theme = 'batman';

create temporary table export on commit drop as select null::json as data;
grant all on export to authenticated;
select tests.login_as('admin');
update export set data = public.export_data();
reset role;

select is((select data->>'format' from export), 'film-club-export', 'export: format marker');
select ok((select (data->>'exported_at')::timestamptz <= now() from export), 'export: exported_at');
select is((select data->>'schema_version' from export),
  (select max(version) from supabase_migrations.schema_migrations), 'export: schema version is the newest migration');

-- Every table, with every row (each count against the table itself).
select is((select (data->'row_counts'->>t)::int from export),
  tests.row_count(format('select 1 from public.%I', t)), format('export: all %s rows', t))
from unnest(array['profiles', 'films', 'attendance', 'scores', 'comments', 'rotation_adjustments',
  'rotation_passes', 'rotation_next', 'app_settings', 'user_settings', 'suggestions', 'suggestion_replies']) t;
select is((select json_array_length(data->'tables'->'scores') from export),
  (select count(*)::int from public.scores), 'export: the scores array has every row');
select ok((select count(*) > 1000 from public.scores), 'export: more than 1,000 scores were exported');
select is((select (select array_agg(k order by k) from json_object_keys(data->'tables') k) from export),
  array['app_settings', 'attendance', 'comments', 'films', 'profiles', 'rotation_adjustments',
    'rotation_next', 'rotation_passes', 'scores', 'suggestion_replies', 'suggestions', 'user_settings'],
  'export: no invites or rate_limits');
select ok((select data::text not like '%auth_user_id%' from export), 'export: no auth user ids');
select ok((select data::text not like '%@example.test%' from export), 'export: no emails');
select ok((select data::text not like '%token_hash%' from export), 'export: no token hashes');
select is((select u->>'theme' from export, json_array_elements(data->'tables'->'user_settings') u
  where u->>'profile_id' = tests.profile_id('member')::text), 'batman',
  'export: other people''s user settings are included');

-- ---------------------------------------------------------------- remove login: secret key only
select tests.login_as('admin');
select throws_ok($$select public.profile_remove_login(tests.profile_id('member'), tests.profile_id('admin'))$$,
  '42501', null, 'admin cannot call profile_remove_login directly (admin-remove-login only)');
reset role;
select tests.login_anon();
select throws_ok($$select public.profile_remove_login(tests.profile_id('member'), tests.profile_id('admin'))$$,
  '42501', null, 'anon cannot call profile_remove_login');
reset role;

-- The FK keeps profiles when their auth user goes.
select is((select confdeltype from pg_constraint where conrelid = 'public.profiles'::regclass and contype = 'f'
  and confrelid = 'auth.users'::regclass), 'n', 'profiles.auth_user_id is on delete set null (never cascade)');

select tests.login_service_role();
select throws_ok($$select public.profile_remove_login(tests.profile_id('member'), tests.profile_id('moderator'))$$,
  '42501', 'Only an admin can remove a login', 'a non-admin caller is refused');
select throws_ok($$select public.profile_remove_login(tests.profile_id('admin'), tests.profile_id('admin'))$$,
  '42501', 'You cannot remove your own login', 'the admin cannot remove their own login');
select throws_ok($$select public.profile_remove_login(tests.profile_id('placeholder'), tests.profile_id('admin'))$$,
  '23514', 'This person has no login', 'an unclaimed person has no login to remove');
select throws_ok($$select public.profile_remove_login(tests.profile_id('cinema'), tests.profile_id('admin'))$$,
  '23514', 'This person has no login', 'a system profile has no login to remove');
select throws_ok($$select public.profile_remove_login('00000000-0000-4000-8000-00000000ffff', tests.profile_id('admin'))$$,
  '23503', 'No such person', 'an unknown person');
reset role;


-- ---------------------------------------------------------------- system profiles are read-only (P1)
select tests.login_as('admin');
select throws_ok($$update public.profiles set display_name = 'Cinema!' where id = tests.profile_id('cinema')$$,
  '42501', 'System profiles cannot be changed', 'admin cannot rename a system profile');
select throws_ok($$update public.profiles set colour = '#000000' where id = tests.profile_id('archive')$$,
  '42501', 'System profiles cannot be changed', 'admin cannot recolour a system profile');
select throws_ok($$update public.profiles set role = 'admin' where id = tests.profile_id('cinema')$$,
  '42501', 'System profiles cannot be changed', 'admin cannot change a system profile''s role');
select throws_ok($$delete from public.profiles where id = tests.profile_id('archive')$$,
  '42501', 'System profiles cannot be changed', 'admin cannot delete a system profile');
reset role;
select tests.login_as('member');
select is(tests.attempt($$update public.profiles set display_name = 'Cinema!' where id = tests.profile_id('cinema')$$), 0,
  'member cannot rename a system profile');
reset role;
-- Migrations and the import (privileged) still can; a system "admin" never counts.
update public.profiles set role = 'admin' where id = tests.profile_id('archive');
select is(app.other_admin_count(tests.profile_id('admin')), 0, 'a system profile never counts as another admin');
select throws_ok($$update public.profiles set role = 'member' where id = tests.profile_id('admin')$$,
  '42501', 'The last admin cannot be demoted', 'so the last real admin is still protected');
update public.profiles set role = 'member' where id = tests.profile_id('archive');

-- ---------------------------------------------------------------- a login keeps its colour
select tests.login_as('admin');
select throws_ok($$update public.profiles set colour = null where id = tests.profile_id('member2')$$,
  '23514', 'A person with a login needs a colour', 'a claimed person''s colour cannot be cleared');
select is(tests.affected($$update public.profiles set colour = null where id = tests.profile_id('placeholder')$$), 1,
  'an unclaimed person''s colour can be cleared');
reset role;

-- ---------------------------------------------------------------- remove login: success
create temporary table before on commit drop as
select (select count(*) from public.scores where profile_id = tests.profile_id('member')) scores,
       (select count(*) from public.attendance where profile_id = tests.profile_id('member')) attendance,
       (select count(*) from public.comments where author_id = tests.profile_id('member')) comments,
       (select count(*) from public.films where assigned_id = tests.profile_id('member')) films;

insert into public.invites (token_hash, profile_id, kind, expires_at)
values (extensions.digest('remove-me', 'sha256'), tests.profile_id('member'), 'reset', now() + interval '1 hour');

select tests.login_service_role();
select is(public.profile_remove_login(tests.profile_id('member'), tests.profile_id('admin')),
  tests.auth_user_id('member'), 'returns the login to delete');
reset role;
select ok((select revoked_at is not null from public.invites where token_hash = extensions.digest('remove-me', 'sha256')),
  'their open reset link is revoked');
select is((select row(auth_user_id, claimed_at, is_claimed, role)::text from public.profiles where id = tests.profile_id('member')),
  row(null::uuid, null::timestamptz, false, 'member'::public.profile_role)::text,
  'unlinked at once, in the same transaction (no access even if the login is never deleted)');

-- What auth.admin.deleteUser does next.
delete from auth.users where id = tests.auth_user_id('member');

select ok((select (s.scores, s.attendance, s.comments, s.films) = (
    (select count(*) from public.scores where profile_id = tests.profile_id('member')),
    (select count(*) from public.attendance where profile_id = tests.profile_id('member')),
    (select count(*) from public.comments where author_id = tests.profile_id('member')),
    (select count(*) from public.films where assigned_id = tests.profile_id('member')))
  from before s), 'their scores, attendance, comments and chosen films stay');
select ok((select scores > 0 and films > 0 from before), 'they had history to keep');
select is((select count(*)::int from auth.sessions where user_id = tests.auth_user_id('member')), 0,
  'their sessions are gone');

-- They can be invited again.
select tests.login_service_role();
select lives_ok($$insert into public.invites (token_hash, profile_id, kind, expires_at)
  values (extensions.digest('welcome-back', 'sha256'), tests.profile_id('member'), 'invite', now() + interval '1 day')$$,
  'a removed person can be invited again');
reset role;

-- ---------------------------------------------------------------- A4: staff become members
update public.profiles set role = 'moderator' where id = tests.profile_id('member2');
select tests.login_service_role();
select lives_ok($$select public.profile_remove_login(tests.profile_id('member2'), tests.profile_id('admin'))$$,
  'admin removes a moderator''s login');
reset role;
select is((select role from public.profiles where id = tests.profile_id('member2')), 'member'::public.profile_role,
  'a moderator whose login is removed becomes a member');

-- Two admins removing each other: the second call (queued on the lock) finds
-- its caller already unlinked and is refused, so an admin login remains.
update public.profiles set role = 'admin' where id = tests.profile_id('moderator');
select tests.login_service_role();
select is(public.profile_remove_login(tests.profile_id('moderator'), tests.profile_id('admin')),
  tests.auth_user_id('moderator'), 'admin A removes admin B''s login');
select throws_ok($$select public.profile_remove_login(tests.profile_id('admin'), tests.profile_id('moderator'))$$,
  '42501', 'Only an admin can remove a login', 'admin B, just unlinked, cannot then remove admin A');
reset role;
select is((select role from public.profiles where id = tests.profile_id('moderator')), 'member'::public.profile_role,
  'an admin whose login is removed becomes a member');
select is((select count(*)::int from public.profiles where role = 'admin' and auth_user_id is not null), 1,
  'one admin login remains');

select * from finish();
rollback;
