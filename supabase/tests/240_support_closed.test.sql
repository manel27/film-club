-- Phase 16c, open/closed suggestions (migration 20261127120000). Seed:
-- suggestion 1 is Kwame's (member), closed by Tamsin (moderator), with her
-- reply; suggestion 2 is Petra's (viewer), open, no replies. Yusuf (member2)
-- is "another member". Only staff close and reopen (set_suggestion_closed);
-- a closed suggestion takes no replies from anyone.
begin;
select plan(36);

create temporary table export on commit drop as select null::json as data;
grant all on export to authenticated;

select is((select row(closed_at, closed_by)::text from public.suggestions where id = 1),
  row('2026-11-23 10:00+00'::timestamptz, tests.profile_id('moderator'))::text, 'the seed closes suggestion 1');

-- ---------------------------------------------------------------- everyone with access sees the state
select tests.login_as('member');
select is((select closed_by from public.suggestions where id = 1), tests.profile_id('moderator'),
  'the author sees who closed it');
reset role;

-- ---------------------------------------------------------------- no replies to a closed suggestion
select tests.login_as('moderator');
select throws_ok($$insert into public.suggestion_replies (suggestion_id, body) values (1, 'One more thing')$$,
  '42501', 'This suggestion is closed', 'a moderator cannot reply to a closed suggestion');
reset role;
select tests.login_as('admin');
select throws_ok($$insert into public.suggestion_replies (suggestion_id, body) values (1, 'One more thing')$$,
  '42501', 'This suggestion is closed', 'nor can the admin');
reset role;
select tests.login_as('member');
select throws_ok($$insert into public.suggestion_replies (suggestion_id, body) values (1, 'But wait')$$,
  '42501', 'This suggestion is closed', 'nor the author');
reset role;
select tests.login_as('member2');
select throws_ok($$insert into public.suggestion_replies (suggestion_id, body) values (1, 'Nosy')$$,
  '42501', 'new row violates row-level security policy for table "suggestion_replies"',
  'another member gets the usual refusal: no hint that it exists or is closed');
reset role;
select throws_ok($$insert into public.suggestion_replies (suggestion_id, author_id, body)
  values (1, tests.profile_id('moderator'), 'Import')$$,
  '42501', 'This suggestion is closed', 'nor the import or the secret key');

-- ---------------------------------------------------------------- who can close and reopen
select tests.login_as('member');
select throws_ok($$select public.set_suggestion_closed(1, false)$$,
  '42501', 'Only moderators and the admin can close or reopen suggestions', 'the author cannot reopen theirs');
reset role;
select tests.login_as('member2');
select throws_ok($$select public.set_suggestion_closed(2, true)$$,
  '42501', 'Only moderators and the admin can close or reopen suggestions', 'another member cannot close one');
reset role;
select tests.login_as('viewer');
select throws_ok($$select public.set_suggestion_closed(2, true)$$,
  '42501', 'Only moderators and the admin can close or reopen suggestions', 'the author viewer cannot close theirs');
reset role;
select tests.login_anon();
select throws_ok($$select public.set_suggestion_closed(2, true)$$, '42501', null, 'anon cannot call it');
reset role;
select is((select array_agg(closed_by::text order by id) from public.suggestions where id in (1, 2)),
  array[tests.profile_id('moderator')::text, null], 'none of that changed anything');

-- No update grant: the function is the only way, even for staff.
select tests.login_as('moderator');
select throws_ok($$update public.suggestions set closed_at = null, closed_by = null where id = 1$$,
  '42501', null, 'staff cannot update the columns directly');
reset role;
select tests.login_as('member');
select throws_ok($$update public.suggestions set closed_at = now(), closed_by = tests.profile_id('member') where id = 1$$,
  '42501', null, 'nor can the author');
select lives_ok($$insert into public.suggestions (title, body, closed_at, closed_by)
  values ('Born closed', 'Body', now(), tests.profile_id('member'))$$, 'a browser insert with closed columns works');
reset role;
select is((select row(closed_at, closed_by)::text from public.suggestions where title = 'Born closed'),
  row(null::timestamptz, null::uuid)::text, 'but the suggestion starts open');
select throws_ok($$update public.suggestions set closed_at = now() where id = 2$$,
  '23514', null, 'closed_at and closed_by are set together');

-- ---------------------------------------------------------------- reopen, reply, close
select tests.login_as('moderator');
select lives_ok($$select public.set_suggestion_closed(1, false)$$, 'a moderator reopens a suggestion');
reset role;
select is((select row(closed_at, closed_by)::text from public.suggestions where id = 1),
  row(null::timestamptz, null::uuid)::text, 'reopening clears both columns');
select tests.login_as('member');
select lives_ok($$insert into public.suggestion_replies (suggestion_id, body) values (1, 'Thanks for reopening')$$,
  'the author can reply again');
reset role;

select tests.login_as('admin');
select lives_ok($$select public.set_suggestion_closed(2, true)$$, 'the admin closes a suggestion');
reset role;
select is((select row(closed_at, closed_by)::text from public.suggestions where id = 2),
  row(now(), tests.profile_id('admin'))::text, 'closed now, by the admin (server-set)');
select tests.login_as('moderator');
select lives_ok($$select public.set_suggestion_closed(2, true)$$, 'closing it again works');
select throws_ok($$select public.set_suggestion_closed(999999, true)$$, 'P0002', 'No such suggestion',
  'an unknown suggestion');
reset role;
select is((select closed_by from public.suggestions where id = 2), tests.profile_id('admin'),
  'and keeps the first close');
select tests.login_as('viewer');
select throws_ok($$insert into public.suggestion_replies (suggestion_id, body) values (2, 'Hello?')$$,
  '42501', 'This suggestion is closed', 'the author viewer cannot reply to their closed suggestion');
select is((select closed_by from public.suggestions where id = 2), tests.profile_id('admin'),
  'and sees who closed it');
reset role;

-- ---------------------------------------------------------------- export
select tests.login_as('admin');
update export set data = public.export_data();
reset role;
select is((select t->>'closed_by' from export, json_array_elements(data->'tables'->'suggestions') t
  where (t->>'id')::int = 2), tests.profile_id('admin')::text, 'export: suggestions carry who closed them');
select ok((select (data->'columns'->'suggestions')::jsonb ?& array['closed_at', 'closed_by'] from export),
  'export: suggestions columns list closed_at and closed_by');

-- ---------------------------------------------------------------- delete rule unchanged
select tests.login_as('viewer');
select is(tests.affected($$delete from public.suggestions where id = 2$$), 1,
  'an author can delete their closed suggestion while nobody else has replied');
reset role;
select tests.login_as('moderator');
select lives_ok($$select public.set_suggestion_closed(1, true)$$, 'a moderator closes suggestion 1 again');
reset role;
select tests.login_as('member');
select throws_ok($$delete from public.suggestions where id = 1$$,
  '42501', 'This suggestion has a reply, so it can no longer be deleted', 'closed or not, a staff reply blocks the author');
reset role;
select tests.login_as('admin');
select is(tests.affected($$delete from public.suggestions where id = 1$$), 1, 'the admin deletes a closed suggestion');
reset role;

-- ---------------------------------------------------------------- grants
select ok(has_function_privilege('authenticated', 'public.set_suggestion_closed(bigint, boolean)', 'execute')
  and not has_function_privilege('anon', 'public.set_suggestion_closed(bigint, boolean)', 'execute'),
  'set_suggestion_closed: logged-in callers only (the staff check is inside)');
select ok((select prosecdef and proconfig @> array['search_path=""'] from pg_proc
  where oid = 'public.set_suggestion_closed(bigint, boolean)'::regprocedure),
  'set_suggestion_closed is SECURITY DEFINER with a fixed search_path');
select ok(not has_table_privilege('authenticated', 'public.suggestions', 'update')
  and not has_any_column_privilege('authenticated', 'public.suggestions', 'update'),
  'browsers have no update grant on suggestions');

select * from finish();
rollback;
