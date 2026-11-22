-- Display names (phase 10 review): profiles_display_name_visible refuses
-- control and format characters, whitespace at either end and names without
-- a letter or digit, for every role and the secret key; uniqueness ignores case.
-- A member renames themselves here (their own row, through RLS).
begin;
select plan(19);

select ok(
  exists (select 1 from pg_constraint
          where conrelid = 'public.profiles'::regclass and conname = 'profiles_display_name_visible'),
  'profiles has the display name check');
select is((select count(*)::int from public.profiles), 9, 'every seed name passes it');

select tests.login_as('member');
select lives_ok($$update public.profiles set display_name = 'Kwame K.' where id = tests.profile_id('member')$$,
  'a plain new name is fine');
select lives_ok($$update public.profiles set display_name = 'Zé Ζωή 李 7' where id = tests.profile_id('member')$$,
  'letters and digits of any script are fine');
select lives_ok($$update public.profiles set display_name = 'Kwame 🎬' where id = tests.profile_id('member')$$,
  'symbols are fine next to a letter');

-- Invisible or look-alike names.
select throws_ok($$update public.profiles set display_name = e'Kwa​me' where id = tests.profile_id('member')$$,
  '23514', null, 'a zero-width space is refused');
select throws_ok($$update public.profiles set display_name = e'Kwa‍me' where id = tests.profile_id('member')$$,
  '23514', null, 'a zero-width joiner is refused');
select throws_ok($$update public.profiles set display_name = e'Kwame⁠' where id = tests.profile_id('member')$$,
  '23514', null, 'a word joiner is refused');
select throws_ok($$update public.profiles set display_name = e'﻿Kwame' where id = tests.profile_id('member')$$,
  '23514', null, 'a byte order mark is refused');
select throws_ok($$update public.profiles set display_name = e'Kwame‮' where id = tests.profile_id('member')$$,
  '23514', null, 'a bidi override is refused');
select throws_ok($$update public.profiles set display_name = e'Kwa\tme' where id = tests.profile_id('member')$$,
  '23514', null, 'a tab is refused');
select throws_ok($$update public.profiles set display_name = e'Kwa\nme' where id = tests.profile_id('member')$$,
  '23514', null, 'a newline is refused');
select throws_ok($$update public.profiles set display_name = e'Kwa\u0085me' where id = tests.profile_id('member')$$,
  '23514', null, 'a C1 control is refused');
select throws_ok($$update public.profiles set display_name = e' Kwame' where id = tests.profile_id('member')$$,
  '23514', null, 'a leading no-break space is refused');
select throws_ok($$update public.profiles set display_name = e'Kwame　' where id = tests.profile_id('member')$$,
  '23514', null, 'a trailing ideographic space is refused');
select throws_ok($$update public.profiles set display_name = '...' where id = tests.profile_id('member')$$,
  '23514', null, 'a name without a letter or digit is refused');

-- Still unique ignoring case (and surrounding ASCII spaces, by the index).
select throws_ok($$update public.profiles set display_name = 'ORLA' where id = tests.profile_id('member')$$,
  '23505', null, 'another person''s name in other case is refused');
reset role;

-- The secret key (the import, create-admin) is held to it too.
select tests.login_service_role();
select throws_ok($$insert into public.profiles (display_name) values (e'New​comer')$$,
  '23514', null, 'the secret key cannot add an invisible character either');
select throws_ok($$insert into public.profiles (display_name) values ('newcomer '), ('Newcomer')$$,
  '23514', null, 'nor a trailing space');
reset role;

select * from finish();
rollback;
