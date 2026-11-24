-- Phase 13 keep-alive: anyone (anon included) can call keepalive(); it
-- returns true whatever the data, so it exposes nothing.
begin;
select plan(6);

select tests.login_anon();
select is(public.keepalive(), true, 'anon can call keepalive() and gets true');
reset role;

select tests.login_as('member');
select is(public.keepalive(), true, 'a member gets true too');
reset role;

-- No data in, no data out: the same answer with app_settings empty.
delete from public.app_settings;
select tests.login_anon();
select is(public.keepalive(), true, 'still true with no settings at all');
reset role;

select is(pg_get_function_result('public.keepalive()'::regprocedure), 'boolean',
  'it returns a single boolean, no rows or columns');
select ok(not has_function_privilege('public', 'public.keepalive()', 'execute'),
  'PUBLIC has no execute grant (only anon and authenticated)');
select ok(
  (select prosecdef and proconfig = array['search_path=""'] from pg_proc
   where oid = 'public.keepalive()'::regprocedure),
  'it is security definer with an empty search_path');

select * from finish();
rollback;
