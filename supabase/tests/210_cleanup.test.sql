-- Phase 15 cleanup (migration 20261124180000): profiles.login_removed_at tells
-- "login removed" from "never invited"; export_data() lists every table's
-- columns, so an empty table's CSV still gets a header.
begin;
select plan(13);

-- ---------------------------------------------------------------- login_removed_at
select ok(has_column_privilege('authenticated', 'public.profiles', 'login_removed_at', 'select'),
  'browsers can read login_removed_at');
select ok(not has_column_privilege('authenticated', 'public.profiles', 'login_removed_at', 'update')
  and not has_column_privilege('authenticated', 'public.profiles', 'login_removed_at', 'insert'),
  'browsers cannot write login_removed_at');
select is((select count(*)::int from public.profiles where login_removed_at is not null), 0,
  'nobody starts with a removed login');

select tests.login_as('admin');
select throws_ok($$update public.profiles set login_removed_at = now() where id = tests.profile_id('member2')$$,
  '42501', null, 'not even an admin can set it from a browser');
reset role;

select tests.login_service_role();
select public.profile_remove_login(tests.profile_id('member'), tests.profile_id('admin'));
reset role;
select is((select login_removed_at from public.profiles where id = tests.profile_id('member')), now(),
  'removing the login stamps login_removed_at');
select tests.login_as('admin');
select is((select login_removed_at from public.profile_directory where id = tests.profile_id('member')), now(),
  'profile_directory shows it');
reset role;

update public.profiles set display_name = display_name where id = tests.profile_id('member');
select is((select login_removed_at from public.profiles where id = tests.profile_id('member')), now(),
  'other edits keep it');

-- Linked again (what invite_redeem does): cleared.
update public.profiles set auth_user_id = tests.auth_user_id('member'), claimed_at = now()
  where id = tests.profile_id('member');
select is((select login_removed_at from public.profiles where id = tests.profile_id('member')), null,
  'linking a login again clears it');

-- An auth user deleted directly (on delete set null) also counts as removed.
delete from auth.users where id = tests.auth_user_id('member2');
select is((select login_removed_at from public.profiles where id = tests.profile_id('member2')), now(),
  'a deleted auth user stamps it too');

-- ---------------------------------------------------------------- export columns
delete from public.comments;
create temporary table export on commit drop as select null::json as data;
grant all on export to authenticated;
select tests.login_as('admin');
update export set data = public.export_data();
reset role;

select is((select (select array_agg(k order by k) from json_object_keys(data->'columns') k) from export),
  (select array_agg(k order by k) from export, json_object_keys(data->'tables') k),
  'export: columns for every table');
select is((select array(select json_array_elements_text(data->'columns'->'comments')) from export),
  array['id', 'film_id', 'author_id', 'body', 'created_at', 'edited_at', 'is_legacy'],
  'export: an empty table still has its columns');
select is((select array(select json_array_elements_text(data->'columns'->'films')) from export),
  (select array(select json_object_keys(data->'tables'->'films'->0)) from export),
  'export: films columns match its rows, in order');
select is((select array(select json_array_elements_text(data->'columns'->'profiles')) from export),
  (select array(select json_object_keys(data->'tables'->'profiles'->0)) from export),
  'export: profiles columns match its rows (no auth_user_id)');

select * from finish();
rollback;
