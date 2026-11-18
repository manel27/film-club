-- Matrix rows "Post a comment" (A ✔ Mo ✔ Me ✔ V ✘ — ✘), "Edit / delete own
-- comment" (A ✔ Mo ✔ Me ✔ V ✘ — ✘) and "Edit / delete any comment"
-- (A ✔ Mo ✘ Me ✘ V ✘ — ✘). Decisions 16 + N3.
begin;
select plan(33);

-- A viewer comment to try to change (import path).
insert into public.comments (film_id, author_id, body) values (1, tests.profile_id('viewer'), 'viewer note');

-- ---------------------------------------------------------------- post
select tests.login_as('admin');
select lives_ok($$insert into public.comments (film_id, author_id, body) values (1, tests.profile_id('admin'), 'admin says hi')$$,
  'admin can post a comment');
reset role;
select tests.login_as('moderator');
select lives_ok($$insert into public.comments (film_id, author_id, body) values (1, tests.profile_id('moderator'), 'moderator says hi')$$,
  'moderator can post a comment');
reset role;
select tests.login_as('member');
select lives_ok($$insert into public.comments (film_id, author_id, body) values (1, tests.profile_id('member'), 'member says hi')$$,
  'member can post a comment');
select throws_ok($$insert into public.comments (film_id, author_id, body) values (1, tests.profile_id('member2'), 'impersonation')$$,
  '42501', null, 'member cannot post as someone else');
select throws_ok($$insert into public.comments (film_id, author_id, body, is_legacy) values (1, tests.profile_id('member'), 'fake legacy', true)$$,
  '42501', null, 'member cannot post a legacy comment');
select throws_ok($$insert into public.comments (film_id, author_id, body) values (1, tests.profile_id('member'), '   ')$$,
  '23514', null, 'an empty comment is rejected');
select throws_ok(format($f$insert into public.comments (film_id, author_id, body) values (1, %L, %L)$f$,
    tests.profile_id('member'), repeat('a', 4001)),
  '23514', null, 'a comment over 4000 characters is rejected');
reset role;
select tests.login_as('admin');
select throws_ok($$insert into public.comments (film_id, author_id, body) values (1, tests.profile_id('member'), 'admin as member')$$,
  '42501', null, 'even the admin cannot post as someone else');
reset role;
select tests.login_as('viewer');
select throws_ok($$insert into public.comments (film_id, author_id, body) values (1, tests.profile_id('viewer'), 'viewer says hi')$$,
  '42501', null, 'viewer cannot post a comment');
reset role;
select tests.login_anon();
select throws_ok($$insert into public.comments (film_id, author_id, body) values (1, '00000000-0000-4000-8000-0000000000a3', 'anon')$$,
  '42501', null, 'anon cannot post a comment');
reset role;

-- ---------------------------------------------------------------- edit own
select tests.login_as('admin');
select is(tests.affected($$update public.comments set body = 'admin edited' where author_id = tests.profile_id('admin')$$), 1,
  'admin can edit own comment');
reset role;
select tests.login_as('moderator');
select is(tests.affected($$update public.comments set body = 'moderator edited' where author_id = tests.profile_id('moderator') and body = 'moderator says hi'$$), 1,
  'moderator can edit own comment');
reset role;
select tests.login_as('member');
select is(tests.affected($$update public.comments set body = 'member edited' where author_id = tests.profile_id('member') and body = 'member says hi'$$), 1,
  'member can edit own comment');
select throws_ok($$update public.comments set film_id = 2 where author_id = tests.profile_id('member')$$,
  '42501', 'Only the comment text can be edited', 'an author can only change the text');
reset role;
select isnt((select edited_at from public.comments where body = 'member edited'), null, 'edited_at is set when the text changes');
select tests.login_as('viewer');
select is(tests.affected($$update public.comments set body = 'viewer edited' where author_id = tests.profile_id('viewer')$$), 0,
  'viewer cannot edit own comment');
reset role;
select tests.login_anon();
select throws_ok($$update public.comments set body = 'anon edited'$$, '42501', null, 'anon cannot edit comments');
reset role;

-- ---------------------------------------------------------------- edit others'
select tests.login_as('moderator');
select is(tests.affected($$update public.comments set body = 'moderated' where author_id = tests.profile_id('member')$$), 0,
  'moderator cannot edit someone else''s comment');
reset role;
select tests.login_as('member');
select is(tests.affected($$update public.comments set body = 'hijacked' where author_id = tests.profile_id('member2')$$), 0,
  'member cannot edit someone else''s comment');
reset role;
select tests.login_as('viewer');
select is(tests.affected($$update public.comments set body = 'hijacked' where author_id = tests.profile_id('member2')$$), 0,
  'viewer cannot edit someone else''s comment');
reset role;
select tests.login_as('admin');
select is(tests.affected($$update public.comments set body = 'tidied by admin' where author_id = tests.profile_id('member2')$$), 1,
  'admin can edit any comment');
select is(tests.affected($$update public.comments set body = 'legacy tidied' where is_legacy$$), 1,
  'admin can edit a legacy comment');
select throws_ok($$update public.comments set author_id = tests.profile_id('admin') where author_id = tests.profile_id('member2')$$,
  '42501', 'Only the comment text can be edited', 'admin cannot reassign authorship');
reset role;

-- ---------------------------------------------------------------- delete own
select tests.login_as('viewer');
select is(tests.affected($$delete from public.comments where author_id = tests.profile_id('viewer')$$), 0,
  'viewer cannot delete own comment');
reset role;
select tests.login_as('member');
select is(tests.affected($$delete from public.comments where author_id = tests.profile_id('member') and body = 'member edited'$$), 1,
  'member can delete own comment');
reset role;
select tests.login_as('moderator');
select is(tests.affected($$delete from public.comments where author_id = tests.profile_id('moderator') and body = 'moderator edited'$$), 1,
  'moderator can delete own comment');
reset role;
select tests.login_as('admin');
select is(tests.affected($$delete from public.comments where author_id = tests.profile_id('admin') and body = 'admin edited'$$), 1,
  'admin can delete own comment');
reset role;

-- ---------------------------------------------------------------- delete others'
select tests.login_as('moderator');
select is(tests.affected($$delete from public.comments where author_id = tests.profile_id('member')$$), 0,
  'moderator cannot delete someone else''s comment');
reset role;
select tests.login_as('member');
select is(tests.affected($$delete from public.comments where author_id = tests.profile_id('member2')$$), 0,
  'member cannot delete someone else''s comment');
reset role;
select tests.login_as('viewer');
select is(tests.affected($$delete from public.comments where author_id = tests.profile_id('member2')$$), 0,
  'viewer cannot delete someone else''s comment');
reset role;
select tests.login_anon();
select throws_ok($$delete from public.comments$$, '42501', null, 'anon cannot delete comments');
reset role;
select tests.login_as('admin');
select is(tests.affected($$delete from public.comments where author_id = tests.profile_id('member2')$$), 1,
  'admin can delete any comment');
select is(tests.affected($$delete from public.comments where is_legacy$$), 1,
  'admin can delete a legacy comment');
reset role;

select * from finish();
rollback;
