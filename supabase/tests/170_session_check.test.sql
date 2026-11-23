-- Security audit S1: a JWT whose session has ended (logout, password reset,
-- revoked) gets nothing, though its signature and expiry are still good.
begin;
select plan(11);

-- A live session: everything as usual.
select tests.login_as('member');
select is(app.current_role(), 'member'::public.profile_role, 'a live session has its role');
select is(app.current_profile_id(), tests.profile_id('member'), 'and its profile');
reset role;

-- The same token after its session is gone (claims kept, session deleted).
select tests.login_as('member');
reset role;
delete from auth.sessions where user_id = tests.auth_user_id('member');
select set_config('role', 'authenticated', true);
select is(app.current_role(), null, 'an ended session has no role');
select is(app.current_profile_id(), null, 'and no profile');
select is(tests.row_count('select id from public.profiles'), 0, 'it reads no profiles');
select is(tests.row_count('select id from public.films'), 0, 'it reads no films');
select is((select count(*)::integer from public.my_profile()), 0, 'my_profile() is empty');
select throws_ok($$insert into public.comments (film_id, author_id, body) values (8, tests.profile_id('member'), 'still here?')$$,
  '42501', null, 'it cannot comment');
reset role;

-- Someone else's live session id doesn't help.
select set_config('request.jwt.claims',
  json_build_object('sub', tests.auth_user_id('member'), 'role', 'authenticated',
                    'session_id', tests.new_session(tests.auth_user_id('member2')))::text, true);
select set_config('role', 'authenticated', true);
select is(app.current_role(), null, 'another user''s session id is not this user''s session');
reset role;

-- No session_id at all, or garbage.
select set_config('request.jwt.claims',
  json_build_object('sub', tests.auth_user_id('admin'), 'role', 'authenticated')::text, true);
select set_config('role', 'authenticated', true);
select is(app.is_admin(), false, 'a token without a session_id is not the admin');
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub', tests.auth_user_id('admin'), 'role', 'authenticated', 'session_id', 'nope')::text, true);
select set_config('role', 'authenticated', true);
select is(app.is_admin(), false, 'a garbage session_id is not the admin (and does not error)');
reset role;

select * from finish();
rollback;
