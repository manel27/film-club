-- public.my_profile(): the caller's own profile, used by the front end's auth
-- context. Each role gets exactly its own row (no auth_user_id); a login with
-- no linked profile gets no row; visitors who are not logged in can't call it.
begin;
select plan(17);

select has_function('public', 'my_profile', '{}'::name[], 'my_profile() exists');
select ok(
  not (select p.prosecdef from pg_proc p where p.oid = 'public.my_profile()'::regprocedure),
  'my_profile() runs with the caller''s rights (SECURITY INVOKER)');
select ok(
  (select p.proconfig @> array['search_path=""'] from pg_proc p where p.oid = 'public.my_profile()'::regprocedure),
  'my_profile() pins an empty search_path');
select ok(not has_function_privilege('anon', 'public.my_profile()', 'execute'), 'anon cannot execute my_profile()');
select ok(has_function_privilege('authenticated', 'public.my_profile()', 'execute'), 'logged-in users can execute my_profile()');
select ok(
  not exists (
    select 1 from pg_attribute a
    where a.attrelid = 'public.profile_directory'::regclass and a.attname = 'auth_user_id' and not a.attisdropped),
  'the returned row type has no auth_user_id');

-- Each role sees exactly its own profile, with its role.
select tests.login_as('admin');
select results_eq($$select id, role::text from public.my_profile()$$,
  $$values (tests.profile_id('admin'), 'admin')$$, 'admin gets their own profile');
reset role;
select tests.login_as('moderator');
select results_eq($$select id, role::text from public.my_profile()$$,
  $$values (tests.profile_id('moderator'), 'moderator')$$, 'moderator gets their own profile');
reset role;
select tests.login_as('member');
select results_eq($$select id, role::text from public.my_profile()$$,
  $$values (tests.profile_id('member'), 'member')$$, 'member gets their own profile');
reset role;
select tests.login_as('viewer');
select results_eq($$select id, role::text from public.my_profile()$$,
  $$values (tests.profile_id('viewer'), 'viewer')$$, 'viewer gets their own profile');
select results_eq($$select display_name, colour::text, is_claimed from public.my_profile()$$,
  $$values ('Petra'::text, '#76a5af'::text, true)$$, 'the row carries name, colour and claimed flag');
reset role;

-- A login with no linked profile (e.g. created by the bootstrap script before
-- linking, or an orphaned auth user) gets nothing.
select tests.login_as_uid('20000000-0000-4000-8000-0000000000ff');
select is((select count(*)::int from public.my_profile()), 0, 'an unlinked login gets no profile');
reset role;

-- Linking a placeholder makes it show up for that login (as the bootstrap
-- script and invite-claim do with the secret key).
insert into auth.users (id, aud, role, email) values
  ('20000000-0000-4000-8000-0000000000fe', 'authenticated', 'authenticated', 'link-me@example.test');
update public.profiles set auth_user_id = '20000000-0000-4000-8000-0000000000fe', claimed_at = now()
where id = tests.profile_id('placeholder');
select tests.login_as_uid('20000000-0000-4000-8000-0000000000fe');
select results_eq($$select id, display_name from public.my_profile()$$,
  $$values (tests.profile_id('placeholder'), 'Viggo'::text)$$, 'a newly linked login gets the placeholder profile');
reset role;

-- Not logged in: no access at all.
select tests.login_anon();
select throws_ok($$select * from public.my_profile()$$, '42501', null, 'anon is refused');
reset role;

-- The secret key (service_role) has no current profile.
select tests.login_service_role();
select is((select count(*)::int from public.my_profile()), 0, 'the secret key has no profile of its own');
reset role;

-- Calling it never returns more than one row, even for staff.
select tests.login_as('admin');
select is((select count(*)::int from public.my_profile()), 1, 'admin gets exactly one row');
reset role;
select tests.login_as('member');
select is((select count(*)::int from public.my_profile()), 1, 'member gets exactly one row');
reset role;

select * from finish();
rollback;
