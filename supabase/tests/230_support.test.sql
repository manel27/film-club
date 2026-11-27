-- Phase 16c (migration 20261127120000): the suggestion box. Seed: suggestion 1
-- is Kwame's (member) with a reply from Tamsin (moderator) and one of his own;
-- suggestion 2 is Petra's (viewer) with none. Yusuf (member2) is "another
-- member"; there is no second viewer login, so a member stands in for the
-- other viewer's rights (the same policies: only author or staff).
begin;
select plan(75);

-- ---------------------------------------------------------------- who sees what
select tests.login_as('admin');
select is(tests.row_count('select 1 from public.suggestions'), 2, 'admin sees every suggestion');
select is(tests.row_count('select 1 from public.suggestion_replies'), 2, 'admin sees every reply');
reset role;
select tests.login_as('moderator');
select is(tests.row_count('select 1 from public.suggestions'), 2, 'moderator sees every suggestion');
select is(tests.row_count('select 1 from public.suggestion_replies'), 2, 'moderator sees every reply');
reset role;
select tests.login_as('member');
select is(array(select id from public.suggestions), array[1::bigint], 'an author member sees only their own');
select is(tests.row_count('select 1 from public.suggestion_replies'), 2, 'and every reply in their thread');
reset role;
select tests.login_as('member2');
select is(tests.row_count('select 1 from public.suggestions'), 0, 'another member sees no suggestions');
select is(tests.row_count('select 1 from public.suggestion_replies'), 0, 'and no replies');
select is((select count(*)::int from public.suggestions), 0, 'not even a count');
reset role;
select tests.login_as('viewer');
select is(array(select id from public.suggestions), array[2::bigint], 'an author viewer sees only their own');
select is(tests.row_count('select 1 from public.suggestion_replies where suggestion_id = 1'), 0,
  'a viewer sees no replies in someone else''s thread');
reset role;
select tests.login_anon();
select throws_ok($$select count(*) from public.suggestions$$, '42501', null, 'anon cannot read suggestions');
select throws_ok($$select count(*) from public.suggestion_replies$$, '42501', null, 'anon cannot read replies');
reset role;
-- A token whose session is gone (logged out elsewhere): nothing, like a visitor.
select set_config('request.jwt.claims', json_build_object('sub', tests.auth_user_id('admin'), 'role', 'authenticated',
  'session_id', '00000000-0000-4000-8000-000000000000')::text, true);
set local role authenticated;
select is(tests.row_count('select 1 from public.suggestions'), 0, 'a dead session sees nothing');
select throws_ok($$insert into public.suggestions (title, body) values ('Ghost', 'Ghost')$$,
  '42501', null, 'and cannot write');
reset role;

-- ---------------------------------------------------------------- write a suggestion
select tests.login_as('admin');
select lives_ok($$insert into public.suggestions (title, body) values ('Admin idea', 'Body')$$, 'admin can write one');
reset role;
select tests.login_as('moderator');
select lives_ok($$insert into public.suggestions (title, body) values ('Moderator idea', 'Body')$$, 'moderator can write one');
reset role;
select tests.login_as('member');
select lives_ok($$insert into public.suggestions (title, body, created_at) values ('Member idea', 'Body', '2000-01-01')$$,
  'a member can write one');
select throws_ok($$insert into public.suggestions (author_id, title, body) values (tests.profile_id('member2'), 'Spoof', 'Body')$$,
  '42501', null, 'a member cannot write as someone else');
select throws_ok($$insert into public.suggestions (author_id, title, body) values (tests.profile_id('cinema'), 'Spoof', 'Body')$$,
  '42501', null, 'or as a system profile');
reset role;
select tests.login_as('viewer');
select lives_ok($$insert into public.suggestions (title, body) values ('Viewer idea', 'Body')$$,
  'a viewer can write one (exception to decision 15)');
select throws_ok($$insert into public.suggestions (author_id, title, body) values (tests.profile_id('member'), 'Spoof', 'Body')$$,
  '42501', null, 'a viewer cannot write as someone else');
reset role;
select tests.login_as('admin');
select throws_ok($$insert into public.suggestions (author_id, title, body) values (tests.profile_id('member'), 'Spoof', 'Body')$$,
  '42501', null, 'not even the admin can write as someone else');
reset role;
select tests.login_anon();
select throws_ok($$insert into public.suggestions (title, body) values ('Anon', 'Body')$$, '42501', null, 'anon cannot write one');
reset role;

select is((select array_agg(author_id order by title) from public.suggestions where title like '% idea'),
  array[tests.profile_id('admin'), tests.profile_id('member'), tests.profile_id('moderator'), tests.profile_id('viewer')],
  'the author is always the writer (server-set)');
select isnt((select created_at from public.suggestions where title = 'Member idea'), '2000-01-01'::timestamptz,
  'browsers cannot backdate');

-- System profiles never author, even for the import or the secret key.
select throws_ok($$insert into public.suggestions (author_id, title, body) values (tests.profile_id('archive'), 'Old', 'Body')$$,
  '42501', 'System profiles cannot write suggestions or replies', 'the import cannot make a system profile an author');
select throws_ok($$insert into public.suggestion_replies (suggestion_id, author_id, body) values (1, tests.profile_id('cinema'), 'Hi')$$,
  '42501', 'System profiles cannot write suggestions or replies', 'or a reply author');

-- ---------------------------------------------------------------- lengths and visible text
select tests.login_as('member');
select lives_ok(format($f$insert into public.suggestions (title, body) values (%L, %L)$f$, repeat('t', 100), repeat('b', 2000)),
  '100-character title and 2000-character text are accepted');
select throws_ok(format($f$insert into public.suggestions (title, body) values (%L, 'Body')$f$, repeat('t', 101)),
  '23514', null, 'a 101-character title is refused');
select throws_ok(format($f$insert into public.suggestions (title, body) values ('Title', %L)$f$, repeat('b', 2001)),
  '23514', null, '2001 characters of text are refused');
select throws_ok($$insert into public.suggestions (title, body) values ('', 'Body')$$, '23514', null, 'an empty title is refused');
select throws_ok($$insert into public.suggestions (title, body) values (E' \t ', 'Body')$$, '23514', null, 'a whitespace-only title is refused');
select throws_ok($$insert into public.suggestions (title, body) values ('Title', E'\u200b\u200d\ufeff')$$,
  '23514', null, 'invisible-only text is refused');
select throws_ok($$insert into public.suggestions (title, body) values ('Title', E'\u00a0')$$,
  '23514', null, 'no-break-space-only text is refused');
select throws_ok($$insert into public.suggestions (title, body) values (' Title ', 'Body')$$, '23514', null, 'an untrimmed title is refused');
select throws_ok($$insert into public.suggestions (title, body) values ('Title', E'line\nbreak')$$,
  '23514', null, 'a control character is refused');
select lives_ok($$insert into public.suggestions (title, body) values (E'\U0001F468\u200d\U0001F469 ok', E'می\u200cخواهم')$$,
  'emoji sequences and ZWNJ words are accepted');
reset role;

-- ---------------------------------------------------------------- replies
select tests.login_as('moderator');
select lives_ok($$insert into public.suggestion_replies (suggestion_id, body) values (2, 'Moderator reply')$$,
  'a moderator can reply to any suggestion');
select throws_ok($$insert into public.suggestion_replies (suggestion_id, body) values (999999, 'Lost')$$,
  '23503', null, 'a reply to an unknown suggestion is refused');
reset role;
select tests.login_as('admin');
select lives_ok($$insert into public.suggestion_replies (suggestion_id, body) values (2, 'Admin reply')$$,
  'the admin can reply to any suggestion');
reset role;
select tests.login_as('viewer');
select lives_ok($$insert into public.suggestion_replies (suggestion_id, body) values (2, 'Viewer reply')$$,
  'an author viewer can reply in their own thread');
select throws_ok($$insert into public.suggestion_replies (suggestion_id, body) values (1, 'Nosy')$$,
  '42501', null, 'a viewer cannot reply in someone else''s thread');
select is(tests.row_count('select 1 from public.suggestion_replies where suggestion_id = 2'), 3,
  'the author viewer sees every reply in their thread');
reset role;
select tests.login_as('member');
select lives_ok($$insert into public.suggestion_replies (suggestion_id, body) values (1, 'Member reply')$$,
  'an author member can reply in their own thread');
select throws_ok($$insert into public.suggestion_replies (suggestion_id, author_id, body) values (1, tests.profile_id('moderator'), 'Spoof')$$,
  '42501', null, 'a reply cannot be written as someone else');
select throws_ok($$insert into public.suggestion_replies (suggestion_id, body) values (2, 'Nosy')$$,
  '42501', null, 'a member cannot reply in someone else''s thread');
select throws_ok(format($f$insert into public.suggestion_replies (suggestion_id, body) values (1, %L)$f$, repeat('r', 2001)),
  '23514', null, 'a reply over 2000 characters is refused');
select throws_ok($$insert into public.suggestion_replies (suggestion_id, body) values (1, '  ')$$,
  '23514', null, 'a blank reply is refused');
select throws_ok($$update public.suggestion_replies set body = 'Edited' where author_id = tests.profile_id('member')$$,
  '42501', null, 'replies cannot be edited');
select throws_ok($$update public.suggestions set title = 'Edited' where id = 1$$, '42501', null, 'suggestions cannot be edited');
select throws_ok($$delete from public.suggestion_replies where author_id = tests.profile_id('member')$$,
  '42501', null, 'replies cannot be deleted on their own');
reset role;
select tests.login_as('member2');
select throws_ok($$insert into public.suggestion_replies (suggestion_id, body) values (1, 'Nosy')$$,
  '42501', null, 'another member cannot reply');
reset role;
select tests.login_anon();
select throws_ok($$insert into public.suggestion_replies (suggestion_id, body) values (1, 'Anon')$$,
  '42501', null, 'anon cannot reply');
reset role;
select is((select array_agg(author_id order by id) from public.suggestion_replies where body like '% reply'),
  array[tests.profile_id('moderator'), tests.profile_id('admin'), tests.profile_id('viewer'), tests.profile_id('member')],
  'reply authors are server-set');

-- ---------------------------------------------------------------- delete
select tests.login_as('member');
select throws_ok($$delete from public.suggestions where id = 1$$,
  '42501', 'This suggestion has a reply, so it can no longer be deleted', 'an author cannot delete once staff replied');
-- Their own replies don't count.
insert into public.suggestion_replies (suggestion_id, author_id, body)
  select id, tests.profile_id('member'), 'Talking to myself' from public.suggestions where title = 'Member idea';
select is(tests.affected($$delete from public.suggestions where title = 'Member idea'$$), 1,
  'an author can delete theirs while only they have replied');
reset role;
select tests.login_as('viewer');
select throws_ok($$delete from public.suggestions where id = 2$$,
  '42501', 'This suggestion has a reply, so it can no longer be deleted', 'an author viewer cannot delete once staff replied');
select is(tests.affected($$delete from public.suggestions where title = 'Viewer idea'$$), 1,
  'an author viewer can delete theirs before any reply');
reset role;
-- A moderator's own suggestion: the admin's reply blocks them too.
select tests.login_as('admin');
insert into public.suggestion_replies (suggestion_id, body)
  select id, 'Noted' from public.suggestions where title = 'Moderator idea';
reset role;
select tests.login_as('moderator');
select throws_ok($$delete from public.suggestions where title = 'Moderator idea'$$,
  '42501', null, 'a moderator author cannot delete theirs once the admin replied');
select is(tests.affected($$delete from public.suggestions where id = 2$$), 0,
  'a moderator cannot delete someone else''s suggestion');
reset role;
select tests.login_as('member2');
select is(tests.affected($$delete from public.suggestions$$), 0, 'another member deletes nothing');
reset role;
select tests.login_anon();
select throws_ok($$delete from public.suggestions$$, '42501', null, 'anon cannot delete');
reset role;
select tests.login_as('admin');
select is(tests.affected($$delete from public.suggestions where id = 1$$), 1, 'the admin can delete any suggestion, replies or not');
reset role;
select is((select count(*)::int from public.suggestion_replies where suggestion_id = 1), 0,
  'its replies go with it (cascade)');
select is((select confdeltype from pg_constraint where conname = 'suggestion_replies_suggestion_id_fkey'), 'c',
  'suggestion_replies.suggestion_id is on delete cascade');

-- ---------------------------------------------------------------- grants
select ok(not has_table_privilege('anon', 'public.suggestions', 'select')
  and not has_table_privilege('anon', 'public.suggestion_replies', 'select'), 'anon has no grant');
select ok(not has_table_privilege('authenticated', 'public.suggestions', 'update')
  and not has_table_privilege('authenticated', 'public.suggestion_replies', 'update')
  and not has_table_privilege('authenticated', 'public.suggestion_replies', 'delete'),
  'browsers cannot edit, or delete replies directly');
select policies_are('public', 'suggestions',
  array['suggestions_select_own_or_staff', 'suggestions_insert_own', 'suggestions_delete_own', 'suggestions_delete_admin']);
select policies_are('public', 'suggestion_replies',
  array['suggestion_replies_select_own_or_staff', 'suggestion_replies_insert_own_or_staff']);

-- ---------------------------------------------------------------- export
create temporary table export on commit drop as select null::json as data;
grant all on export to authenticated;
select tests.login_as('admin');
update export set data = public.export_data();
reset role;
select is((select (data->'row_counts'->>'suggestions')::int from export),
  (select count(*)::int from public.suggestions), 'export: every suggestion');
select is((select (data->'row_counts'->>'suggestion_replies')::int from export),
  (select count(*)::int from public.suggestion_replies), 'export: every reply');
select is((select array(select json_array_elements_text(data->'columns'->'suggestions')) from export),
  array['id', 'author_id', 'title', 'body', 'created_at'], 'export: suggestions columns');
select is((select array(select json_array_elements_text(data->'columns'->'suggestion_replies')) from export),
  array['id', 'suggestion_id', 'author_id', 'body', 'created_at'], 'export: suggestion_replies columns');
select is((select array(select json_object_keys(data->'tables'->'suggestions'->0)) from export),
  array['id', 'author_id', 'title', 'body', 'created_at'], 'export: suggestion rows match the columns');

select * from finish();
rollback;
