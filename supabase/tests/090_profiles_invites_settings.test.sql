-- Matrix rows "Create / revoke invites, create profiles" (A only), "Change
-- roles, colours" (A only; no self role change; last admin protected),
-- "Edit own display name / saved theme" (A ✔ Mo ✔ Me ✔ V ✘ — ✘), plus
-- placeholder claiming, app_settings and user_settings.
begin;
select plan(83);

-- ---------------------------------------------------------------- create profiles
select tests.login_as('admin');
select lives_ok($$insert into public.profiles (display_name, colour) values ('Newcomer', '#123ABC')$$,
  'admin can create a profile');
reset role;
select is((select colour::text from public.profiles where display_name = 'Newcomer'), '#123abc', 'colours are stored in lower case');
select ok((select not is_claimed from public.profiles where display_name = 'Newcomer'), 'a new profile is an unclaimed placeholder');
select tests.login_as('moderator');
select throws_ok($$insert into public.profiles (display_name) values ('Mod Friend')$$, '42501', null, 'moderator cannot create a profile');
reset role;
select tests.login_as('member');
select throws_ok($$insert into public.profiles (display_name) values ('Member Friend')$$, '42501', null, 'member cannot create a profile');
reset role;
select tests.login_as('viewer');
select throws_ok($$insert into public.profiles (display_name) values ('Viewer Friend')$$, '42501', null, 'viewer cannot create a profile');
reset role;
select tests.login_anon();
select throws_ok($$insert into public.profiles (display_name) values ('Anon Friend')$$, '42501', null, 'anon cannot create a profile');
reset role;
select tests.login_as('admin');
select throws_ok($$insert into public.profiles (display_name, is_system) values ('Fake System', true)$$,
  '42501', null, 'admin cannot create system profiles from a browser');
select throws_ok($$insert into public.profiles (display_name, auth_user_id) values ('Pre-linked', tests.auth_user_id('viewer'))$$,
  '42501', null, 'admin cannot pre-link an auth user from a browser');
select throws_ok($$insert into public.profiles (display_name) values ('  orla ')$$,
  '23505', null, 'display names are unique (ignoring case and spaces)');
select throws_ok($$insert into public.profiles (display_name, colour) values ('Bad Colour', 'red')$$,
  '23514', null, 'colour must be a #rrggbb hex value');

-- ---------------------------------------------------------------- roles and colours
select is(tests.affected($$update public.profiles set role = 'moderator' where id = tests.profile_id('member2')$$), 1,
  'admin can promote a member to moderator');
select is(tests.affected($$update public.profiles set colour = '#000000' where id = tests.profile_id('member')$$), 1,
  'admin can change someone''s colour');
select is(tests.affected($$update public.profiles set colour = '#111111' where id = tests.profile_id('admin')$$), 1,
  'admin can change own colour');
select throws_ok($$update public.profiles set role = 'member' where id = tests.profile_id('admin')$$,
  '42501', 'Admins cannot change their own role', 'admin cannot change own role');
reset role;
select tests.login_as('moderator');
select is(tests.affected($$update public.profiles set role = 'viewer' where id = tests.profile_id('member')$$), 0,
  'moderator cannot change someone else''s role');
select throws_ok($$update public.profiles set role = 'admin' where id = tests.profile_id('moderator')$$,
  '42501', 'Only the admin can change role, colour or sheet keyword', 'moderator cannot change own role');
select throws_ok($$update public.profiles set colour = '#222222' where id = tests.profile_id('moderator')$$,
  '42501', 'Only the admin can change role, colour or sheet keyword', 'moderator cannot change own colour');
reset role;
select tests.login_as('member');
select throws_ok($$update public.profiles set role = 'admin' where id = tests.profile_id('member')$$,
  '42501', 'Only the admin can change role, colour or sheet keyword', 'member cannot promote themselves');
select throws_ok($$update public.profiles set colour = '#333333' where id = tests.profile_id('member')$$,
  '42501', 'Only the admin can change role, colour or sheet keyword', 'member cannot change own colour');
select is(tests.affected($$update public.profiles set colour = '#333333' where id = tests.profile_id('member2')$$), 0,
  'member cannot change someone else''s colour');
reset role;
select tests.login_as('viewer');
select is(tests.affected($$update public.profiles set role = 'admin' where id = tests.profile_id('viewer')$$), 0,
  'viewer cannot change own role');
reset role;

-- Last admin
select throws_ok($$update public.profiles set role = 'member' where id = tests.profile_id('admin')$$,
  '42501', 'The last admin cannot be demoted', 'the last admin cannot be demoted, even by postgres');
select tests.login_service_role();
select throws_ok($$delete from public.profiles where id = tests.profile_id('admin')$$,
  '42501', 'The last admin cannot be removed', 'the last admin cannot be deleted, even with the secret key');
reset role;
update public.profiles set role = 'admin' where id = tests.profile_id('moderator');
select tests.login_as('moderator');
select is(tests.affected($$update public.profiles set role = 'member' where id = tests.profile_id('admin')$$), 1,
  'with two admins, one admin can demote the other');
reset role;
update public.profiles set role = 'admin' where id = tests.profile_id('admin');
update public.profiles set role = 'moderator' where id = tests.profile_id('moderator');

-- Deleting profiles
select tests.login_as('admin');
select throws_ok($$delete from public.profiles where id = tests.profile_id('admin')$$,
  '42501', null, 'admin cannot delete own profile');
select is(tests.affected($$delete from public.profiles where display_name = 'Newcomer'$$), 1,
  'admin can delete a profile with no history');
reset role;
select tests.login_as('moderator');
select is(tests.affected($$delete from public.profiles where id = tests.profile_id('placeholder_no_colour')$$), 0,
  'moderator cannot delete profiles');
reset role;

-- ---------------------------------------------------------------- own display name
select tests.login_as('admin');
select is(tests.affected($$update public.profiles set display_name = 'Orla A.' where id = tests.profile_id('admin')$$), 1,
  'admin can edit own display name');
reset role;
select tests.login_as('moderator');
select is(tests.affected($$update public.profiles set display_name = 'Tamsin M.' where id = tests.profile_id('moderator')$$), 1,
  'moderator can edit own display name');
select is(tests.affected($$update public.profiles set display_name = 'Renamed' where id = tests.profile_id('member')$$), 0,
  'moderator cannot edit someone else''s display name');
reset role;
select tests.login_as('member');
select is(tests.affected($$update public.profiles set display_name = 'Kwame K.' where id = tests.profile_id('member')$$), 1,
  'member can edit own display name');
select is(tests.affected($$update public.profiles set display_name = 'Renamed' where id = tests.profile_id('member2')$$), 0,
  'member cannot edit someone else''s display name');
select throws_ok($$update public.profiles set auth_user_id = null where id = tests.profile_id('member')$$,
  '42501', null, 'member cannot unlink own login');
select throws_ok($$update public.profiles set is_system = true where id = tests.profile_id('member')$$,
  '42501', null, 'member cannot turn own profile into a system profile');
reset role;
select tests.login_as('viewer');
select is(tests.affected($$update public.profiles set display_name = 'Petra P.' where id = tests.profile_id('viewer')$$), 0,
  'viewer cannot edit own display name');
reset role;
select tests.login_anon();
select throws_ok($$update public.profiles set display_name = 'x'$$, '42501', null, 'anon cannot edit profiles');
reset role;

-- ---------------------------------------------------------------- claiming a placeholder
insert into auth.users (id, instance_id, aud, role, email)
values ('10000000-0000-4000-8000-0000000000b1', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'viggo@example.test');
select tests.login_as('admin');
select throws_ok($$update public.profiles set auth_user_id = '10000000-0000-4000-8000-0000000000b1' where id = tests.profile_id('placeholder')$$,
  '42501', null, 'admin cannot claim a placeholder from a browser');
reset role;
select tests.login_service_role();
select is(tests.affected($$update public.profiles set auth_user_id = '10000000-0000-4000-8000-0000000000b1', claimed_at = now()
  where id = '00000000-0000-4000-8000-0000000000b1'$$), 1, 'invite-claim (secret key) links the placeholder to the new login');
reset role;
select ok((select is_claimed from public.profiles where id = tests.profile_id('placeholder')), 'the placeholder is now claimed');
select tests.login_as_uid('10000000-0000-4000-8000-0000000000b1');
select is(app.current_role(), 'member'::public.profile_role, 'the claimed placeholder logs in with its prepared role');
select lives_ok($$insert into public.scores (film_id, profile_id, score) values (8, tests.profile_id('placeholder'), 6)$$,
  'the claimed person can now score as themselves');
reset role;

-- ---------------------------------------------------------------- invites
select tests.login_as('admin');
select is(tests.affected($$update public.invites set revoked_at = '2000-01-01' where profile_id = tests.profile_id('placeholder')$$), 1,
  'admin can revoke an invite');
reset role;
select ok((select revoked_at > '2020-01-01' from public.invites where profile_id = tests.profile_id('placeholder')),
  'the revocation time is the server''s, not the browser''s');
select tests.login_as('admin');
select throws_ok($$update public.invites set revoked_at = null where profile_id = tests.profile_id('placeholder')$$,
  '42501', 'Invites can only be revoked here', 'admin cannot un-revoke an invite');
select throws_ok($$update public.invites set expires_at = now() + interval '1 year'$$,
  '42501', 'Invites can only be revoked here', 'admin cannot extend an invite');
select throws_ok($$insert into public.invites (token_hash, profile_id) values (extensions.digest('x', 'sha256'), tests.profile_id('placeholder_no_colour'))$$,
  '42501', null, 'invites are created by the Edge Function, not directly by a browser');
select throws_ok($$delete from public.invites$$, '42501', null, 'invites cannot be deleted from a browser');
reset role;
select tests.login_as('moderator');
select is(tests.affected($$update public.invites set revoked_at = now()$$), 0, 'moderator cannot revoke invites');
reset role;
select tests.login_as('member');
select is(tests.affected($$update public.invites set revoked_at = now()$$), 0, 'member cannot revoke invites');
reset role;
select tests.login_as('viewer');
select is(tests.affected($$update public.invites set revoked_at = now()$$), 0, 'viewer cannot revoke invites');
reset role;

select tests.login_service_role();
select throws_ok($$insert into public.invites (token_hash, profile_id) values (extensions.digest('a', 'sha256'), '00000000-0000-4000-8000-0000000000b2')$$,
  '23514', 'Set the person''s colour before creating an invite', 'an invite needs the person''s colour first');
select throws_ok($$insert into public.invites (token_hash, profile_id) values (extensions.digest('b', 'sha256'), '00000000-0000-4000-8000-0000000000a3')$$,
  '23514', 'This profile has already been claimed', 'claimed profiles cannot be invited');
select throws_ok($$insert into public.invites (token_hash, profile_id) values (extensions.digest('c', 'sha256'), '00000000-0000-4000-8000-0000000000c1')$$,
  '23514', 'System profiles cannot be invited', 'system profiles cannot be invited');
select throws_ok($$insert into public.invites (token_hash, profile_id) values ('\x00', '00000000-0000-4000-8000-0000000000b2')$$,
  '23514', null, 'only a 32-byte SHA-256 hash is stored');
reset role;
update public.profiles set colour = '#abcdef' where id = tests.profile_id('placeholder_no_colour');
select tests.login_service_role();
select lives_ok($$insert into public.invites (token_hash, profile_id) values (extensions.digest('d', 'sha256'), '00000000-0000-4000-8000-0000000000b2')$$,
  'invite-create (secret key) can invite a coloured, unclaimed placeholder');
select throws_ok($$insert into public.invites (token_hash, profile_id) values (extensions.digest('e', 'sha256'), '00000000-0000-4000-8000-0000000000b2')$$,
  '23505', null, 'one open invite per profile');
reset role;

-- ---------------------------------------------------------------- app_settings (admin)
select tests.login_as('admin');
select lives_ok($$insert into public.app_settings (key, value) values ('search_rate_per_minute', '60')$$, 'admin can add a setting');
select is(tests.affected($$update public.app_settings set value = '"2026-02-02"' where key = 'rotation_epoch'$$), 1,
  'admin can change the rotation epoch');
reset role;
select tests.login_as('moderator');
select throws_ok($$insert into public.app_settings (key, value) values ('mod_setting', '1')$$, '42501', null, 'moderator cannot add a setting');
select is(tests.affected($$update public.app_settings set value = '"2020-01-06"'$$), 0, 'moderator cannot change settings');
reset role;
select tests.login_as('member');
select throws_ok($$insert into public.app_settings (key, value) values ('member_setting', '1')$$, '42501', null, 'member cannot add a setting');
select is(tests.affected($$delete from public.app_settings$$), 0, 'member cannot delete settings');
reset role;

-- ---------------------------------------------------------------- user_settings (own theme)
select tests.login_as('member');
select is(tests.affected($$update public.user_settings set theme = 'letterboxd' where profile_id = tests.profile_id('member')$$), 1,
  'member can change own saved theme');
reset role;
select tests.login_as('moderator');
select lives_ok($$insert into public.user_settings (profile_id, theme) values (tests.profile_id('moderator'), 'superman')$$,
  'moderator can save own theme');
select throws_ok($$insert into public.user_settings (profile_id, theme) values (tests.profile_id('member2'), 'superman')$$,
  '42501', null, 'nobody can save someone else''s theme');
reset role;
select tests.login_as('admin');
select is(tests.affected($$update public.user_settings set theme = 'superman' where profile_id = tests.profile_id('member')$$), 0,
  'admin cannot change someone else''s saved theme');
select throws_ok($$insert into public.user_settings (profile_id, theme) values (tests.profile_id('admin'), 'pink')$$,
  '23514', null, 'only the three themes exist');
reset role;
select tests.login_as('admin');
select lives_ok($$insert into public.user_settings (profile_id, theme, films_view) values (tests.profile_id('admin'), 'letterboxd', 'list')$$,
  'admin can save own theme');
select is(tests.affected($$update public.user_settings set theme = 'batman' where profile_id = tests.profile_id('admin')$$), 1,
  'admin can change own saved theme');
reset role;
select tests.login_as('viewer');
select throws_ok($$insert into public.user_settings (profile_id, theme) values (tests.profile_id('viewer'), 'batman')$$,
  '42501', null, 'viewer cannot save a theme (localStorage only)');
reset role;

-- ---------------------------------------------------------------- logged in, no profile
insert into auth.users (id, instance_id, aud, role, email)
values ('10000000-0000-4000-8000-0000000000ff', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'orphan@example.test');
select tests.login_as_uid('10000000-0000-4000-8000-0000000000ff');
select throws_ok($$insert into public.films (tmdb_id, title, release_year, screened_on, assigned_id)
  values (950001, 'Orphan Film', 2001, '2026-08-01', '00000000-0000-4000-8000-0000000000a3')$$,
  '42501', null, 'a user without a profile cannot add a film');
select throws_ok($$insert into public.attendance (film_id, profile_id) values (8, '00000000-0000-4000-8000-0000000000a3')$$,
  '42501', null, 'a user without a profile cannot mark attendance');
select throws_ok($$insert into public.scores (film_id, profile_id, score) values (8, '00000000-0000-4000-8000-0000000000a3', 5)$$,
  '42501', null, 'a user without a profile cannot score');
select throws_ok($$insert into public.comments (film_id, author_id, body) values (8, '00000000-0000-4000-8000-0000000000a3', 'hi')$$,
  '42501', null, 'a user without a profile cannot comment');
select throws_ok($$insert into public.rotation_passes (week_start, profile_id) values ('2026-08-03', '00000000-0000-4000-8000-0000000000a3')$$,
  '42501', null, 'a user without a profile cannot record a pass');
select throws_ok($$insert into public.rotation_adjustments (profile_id, set_to) values ('00000000-0000-4000-8000-0000000000a3', 5)$$,
  '42501', null, 'a user without a profile cannot adjust the rotation');
select throws_ok($$insert into public.user_settings (profile_id, theme) values ('00000000-0000-4000-8000-0000000000a3', 'batman')$$,
  '42501', null, 'a user without a profile cannot save settings');
select throws_ok($$insert into public.profiles (display_name) values ('Self Made')$$,
  '42501', null, 'a user without a profile cannot create one');
select is(tests.affected($$update public.films set overview = 'x'$$)
        + tests.affected($$update public.scores set score = 1$$)
        + tests.affected($$update public.comments set body = 'x'$$)
        + tests.affected($$update public.profiles set display_name = display_name || '!'$$), 0,
  'a user without a profile cannot update anything');
select is(tests.affected($$delete from public.attendance$$)
        + tests.affected($$delete from public.comments$$)
        + tests.affected($$delete from public.rotation_next$$), 0,
  'a user without a profile cannot delete anything');
reset role;

-- ---------------------------------------------------------------- rate_limits (secret key only)
select tests.login_as('admin');
select throws_ok($$insert into public.rate_limits (bucket, subject, window_start, count) values ('x', 'y', now(), 1)$$,
  '42501', null, 'browsers cannot write rate_limits');
reset role;
select tests.login_service_role();
select lives_ok($$insert into public.rate_limits (bucket, subject, window_start, count) values ('tmdb-search', 'someone', now(), 1)$$,
  'Edge Functions (secret key) can write rate_limits');
reset role;

select * from finish();
rollback;
