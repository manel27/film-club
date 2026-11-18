-- Structure: every table has RLS (deny by default), no anon grants, no
-- TRUNCATE for browsers, helpers are hardened, role helpers resolve roles.
begin;
select plan(48);

select tables_are(
  'public',
  array['profiles', 'films', 'attendance', 'scores', 'comments', 'invites',
        'rotation_adjustments', 'rotation_passes', 'rotation_next',
        'app_settings', 'user_settings', 'rate_limits'],
  'public has exactly the plan 4.2 tables'
);

select is(
  (select count(*)::int from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and not c.relrowsecurity),
  0, 'RLS is enabled on every public table');

select is(
  (select count(*)::int from information_schema.role_table_grants
   where table_schema = 'public' and grantee = 'anon'),
  0, 'anon (not logged in) has no privilege on any public table or view');

select is(
  (select count(*)::int from information_schema.role_table_grants
   where table_schema = 'public' and grantee in ('anon', 'authenticated')
     and privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')),
  0, 'browsers never get TRUNCATE (which ignores RLS), REFERENCES or TRIGGER');

select is(
  (select count(*)::int from information_schema.role_table_grants
   where table_schema = 'public' and grantee = 'service_role' and privilege_type = 'TRUNCATE'),
  0, 'the secret key (service_role) has no TRUNCATE on any public table');

select ok(
  (select bool_and(has_table_privilege('service_role', c.oid, 'truncate') = false)
   from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'),
  'has_table_privilege agrees: service_role cannot truncate any public table');

select ok(
  exists (select 1 from pg_trigger t where t.tgrelid = 'public.films'::regclass and t.tgname = 'films_block_truncate')
  and exists (select 1 from pg_trigger t where t.tgrelid = 'public.scores'::regclass and t.tgname = 'scores_block_truncate'),
  'films and scores have TRUNCATE guard triggers');

-- auth_user_id is hidden from every browser role (column grants)
select ok(not has_column_privilege('authenticated', 'public.profiles', 'auth_user_id', 'select'),
  'browsers cannot read profiles.auth_user_id');
select ok(not has_column_privilege('authenticated', 'public.profiles', 'auth_user_id', 'update')
  and not has_column_privilege('authenticated', 'public.profiles', 'auth_user_id', 'insert'),
  'browsers cannot write profiles.auth_user_id');
select ok(has_column_privilege('authenticated', 'public.profiles', 'display_name', 'select'),
  'browsers can read the other profile columns');
select hasnt_column('public', 'profile_directory', 'auth_user_id', 'profile_directory has no auth_user_id');

-- New functions get no implicit EXECUTE for PUBLIC (default privileges)
create function app.zz_default_privilege_probe() returns integer language sql as $f$ select 1 $f$;
create function public.zz_default_privilege_probe() returns integer language sql as $f$ select 1 $f$;
select ok(not has_function_privilege('anon', 'app.zz_default_privilege_probe()', 'execute')
  and not has_function_privilege('authenticated', 'app.zz_default_privilege_probe()', 'execute'),
  'a new app function is not executable by anyone until granted');
select ok(not has_function_privilege('anon', 'public.zz_default_privilege_probe()', 'execute'),
  'a new public function is not executable by anon');
drop function app.zz_default_privilege_probe();
drop function public.zz_default_privilege_probe();

select is(
  (select count(*)::int from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'rate_limits' and grantee = 'authenticated'),
  0, 'rate_limits is secret-key only (no grants to authenticated)');

select is(
  (select count(*)::int from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'invites' and grantee = 'authenticated'
     and privilege_type in ('INSERT', 'DELETE')),
  0, 'invites cannot be created or deleted from a browser (Edge Functions only)');

select is(
  (select count(*)::int from pg_proc p
   where p.pronamespace = 'public'::regnamespace and has_function_privilege('anon', p.oid, 'execute')),
  0, 'anon cannot execute any public function');

select ok(not has_schema_privilege('anon', 'app', 'usage'), 'anon has no access to the app helper schema');

select is(
  (select count(*)::int from pg_proc p
   where p.pronamespace = 'app'::regnamespace
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')),
  0, 'every app helper pins its search_path');

select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public' and roles <> '{authenticated}'),
  0, 'every policy applies to logged-in users only');

select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and permissive <> 'PERMISSIVE'),
  0, 'no restrictive policies (rules are expressed positively)');

select is(
  (select count(*)::int from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname <> 'rate_limits'
     and not exists (select 1 from pg_policies p
                     where p.schemaname = 'public' and p.tablename = c.relname and p.cmd = 'SELECT')),
  0, 'every table except rate_limits has a select policy');

select ok(
  (select c.reloptions @> array['security_invoker=true'] from pg_class c where c.oid = 'public.film_stats'::regclass),
  'film_stats runs with the caller''s rights (RLS applies)');
select ok(
  (select c.reloptions @> array['security_invoker=true'] from pg_class c where c.oid = 'public.profile_directory'::regclass),
  'profile_directory runs with the caller''s rights (RLS applies)');

select is(
  (select p.prosecdef from pg_proc p where p.oid = 'public.film_duplicate_check(text, integer, integer, text)'::regprocedure),
  false, 'film_duplicate_check runs with the caller''s rights (RLS applies)');

-- Title normalisation (plan 4.3)
select is(app.normalize_title('Amélie'), 'amelie', 'normalize_title removes accents');
select is(app.normalize_title('Spider-Man: Homecoming'), 'spider man homecoming', 'normalize_title removes punctuation');
select is(app.normalize_title('  Schindler''s   LIST '), 'schindlers list', 'normalize_title drops apostrophes, lowercases, collapses spaces');
select is(app.normalize_title(U&'Ze\200Bro'), 'zero', 'normalize_title strips a zero-width space');
select is(app.normalize_title(U&'Ze\200Cro Da\200Dy'), 'zero day', 'normalize_title strips zero-width (non-)joiners');
select is(app.normalize_title(U&'Super\00ADman'), 'superman', 'normalize_title strips a soft hyphen');
select is(app.normalize_title(U&'\FEFFAmelie'), 'amelie', 'normalize_title strips a BOM');
select is(app.normalize_title(U&'Word\2060Joiner'), 'wordjoiner', 'normalize_title strips a word joiner');
select is(app.normalize_title(U&'\202ERTL\202C Title'), 'rtl title', 'normalize_title strips bidi controls');
select is(app.normalize_title('Straße Æon'), 'strasse aeon', 'normalize_title expands ligatures (unaccent)');

-- Role helpers
select is(app.current_role(), null, 'no role without a session');

select tests.login_as('admin');
select is(app.current_role(), 'admin'::public.profile_role, 'admin role resolved');
select ok(app.is_staff() and app.is_admin() and app.can_write(), 'admin is staff, admin, can write');
reset role;

select tests.login_as('moderator');
select ok(app.is_staff() and not app.is_admin() and app.can_write(), 'moderator is staff, not admin, can write');
reset role;

select tests.login_as('member');
select ok(not app.is_staff() and not app.is_admin() and app.can_write(), 'member is not staff, can write');
select is(app.current_profile_id(), tests.profile_id('member'), 'current_profile_id maps the auth user to the profile');
reset role;

select tests.login_as('viewer');
select ok(not app.is_staff() and not app.is_admin() and not app.can_write(), 'viewer cannot write');
reset role;

-- A logged-in auth user without a profile has no role at all.
insert into auth.users (id, instance_id, aud, role, email)
values ('10000000-0000-4000-8000-0000000000ff', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'orphan@example.test');
select tests.login_as_uid('10000000-0000-4000-8000-0000000000ff');
select is(app.current_role(), null, 'auth user without a profile has no role');
select ok(not app.can_write(), 'auth user without a profile cannot write');
reset role;

select tests.login_service_role();
select is(app.current_role(), null, 'the secret key has no club role (it bypasses RLS, not triggers)');
select ok(app.is_privileged(), 'the secret key counts as privileged for import-only columns');
reset role;

select tests.login_as('admin');
select ok(not app.is_privileged(), 'a browser admin is not privileged');
reset role;

select has_function('app', 'current_role', 'app.current_role() exists');
select has_function('app', 'current_profile_id', 'app.current_profile_id() exists');

select * from finish();
rollback;
