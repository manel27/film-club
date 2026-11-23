-- Invite and reset links (phase 11, plan 7; decisions I1, I2): the kind
-- column and its guards, and the Edge Function RPCs (secret key only).
begin;
select plan(58);

-- ---------------------------------------------------------------- RPCs: secret key only
select tests.login_as('admin');
select throws_ok($$select public.invite_issue(tests.profile_id('placeholder'), 'invite', extensions.digest('t', 'sha256'), null)$$,
  '42501', null, 'admin cannot issue links directly (invite-create only)');
select throws_ok($$select * from public.invite_peek(extensions.digest('local-dev-invite-viggo', 'sha256'), 'invite')$$,
  '42501', null, 'admin cannot peek at links');
select throws_ok($$select * from public.invite_redeem(extensions.digest('local-dev-invite-viggo', 'sha256'), 'invite', null)$$,
  '42501', null, 'admin cannot redeem links');
select throws_ok($$select public.invite_rate_fail('1.2.3.4')$$, '42501', null, 'admin cannot touch the link rate limit');
reset role;
select tests.login_as('moderator');
select throws_ok($$select public.invite_issue(tests.profile_id('placeholder'), 'invite', extensions.digest('t', 'sha256'), null)$$,
  '42501', null, 'moderator cannot issue links');
reset role;
select tests.login_as('member');
select throws_ok($$select * from public.invite_redeem(extensions.digest('local-dev-invite-viggo', 'sha256'), 'invite', null)$$,
  '42501', null, 'member cannot redeem links');
reset role;
select tests.login_as('viewer');
select throws_ok($$select * from public.invite_peek(extensions.digest('local-dev-invite-viggo', 'sha256'), 'invite')$$,
  '42501', null, 'viewer cannot peek at links');
reset role;
select tests.login_anon();
select throws_ok($$select * from public.invite_peek(extensions.digest('local-dev-invite-viggo', 'sha256'), 'invite')$$,
  '42501', null, 'anon cannot peek at links (invite-preview only)');
select throws_ok($$select * from public.invite_redeem(extensions.digest('local-dev-invite-viggo', 'sha256'), 'invite', null)$$,
  '42501', null, 'anon cannot redeem links (invite-claim only)');
select throws_ok($$select public.invite_rate_fail('1.2.3.4')$$, '42501', null, 'anon cannot touch the link rate limit');
select throws_ok($$select public.invite_rate_ok('1.2.3.4')$$, '42501', null, 'anon cannot read the link rate limit');
select throws_ok($$select kind from public.invites$$, '42501', null, 'anon cannot read invites');
reset role;

-- ---------------------------------------------------------------- browsers still only revoke
select tests.login_as('admin');
select throws_ok($$update public.invites set kind = 'reset'$$, '42501', 'Invites can only be revoked here',
  'admin cannot turn an invite into a reset link');
reset role;
select tests.login_as('member');
select is(tests.row_count('select * from public.invites'), 0, 'member cannot read links');
reset role;

-- ---------------------------------------------------------------- guards
select tests.login_service_role();
select throws_ok($$insert into public.invites (token_hash, profile_id, kind, expires_at)
  values (extensions.digest('r1', 'sha256'), tests.profile_id('placeholder_no_colour'), 'reset', now() + interval '1 hour')$$,
  '23514', 'Reset links are only for people who have a login', 'no reset link for an unclaimed person');
select throws_ok($$insert into public.invites (token_hash, profile_id, kind, expires_at)
  values (extensions.digest('r2', 'sha256'), tests.profile_id('cinema'), 'reset', now() + interval '1 hour')$$,
  '23514', 'System profiles cannot be invited', 'no reset link for a system profile');
select throws_ok($$insert into public.invites (token_hash, profile_id, kind, expires_at)
  values (extensions.digest('r3', 'sha256'), tests.profile_id('member'), 'reset', now() + interval '25 hours')$$,
  '23514', null, 'a reset link lives at most 24 hours');
select throws_ok($$insert into public.invites (token_hash, profile_id, expires_at)
  values (extensions.digest('r4', 'sha256'), tests.profile_id('placeholder_no_colour'), now() + interval '15 days')$$,
  '23514', null, 'an invite lives at most 14 days');
select throws_ok($$insert into public.invites (token_hash, profile_id, kind) values (extensions.digest('r5', 'sha256'), tests.profile_id('member'), 'other')$$,
  '23514', null, 'only invite and reset links exist');
reset role;

-- ---------------------------------------------------------------- invite_issue
select tests.login_service_role();
select ok((select e between now() + interval '14 days' - interval '1 minute' and now() + interval '14 days' from (select public.invite_issue(tests.profile_id('placeholder'), 'invite', extensions.digest('new-viggo', 'sha256'), tests.profile_id('admin')) as e) issued),
  'an invite expires in 14 days');
reset role;
select ok((select revoked_at is not null from public.invites where token_hash = extensions.digest('local-dev-invite-viggo', 'sha256')),
  'issuing a new invite revokes the open one (regenerate)');
select is((select count(*)::integer from public.invites where profile_id = tests.profile_id('placeholder') and revoked_at is null), 1,
  'one open invite for the person');
select tests.login_service_role();
select ok((select e between now() + interval '24 hours' - interval '1 minute' and now() + interval '24 hours' from (select public.invite_issue(tests.profile_id('member'), 'reset', extensions.digest('reset-kwame', 'sha256'), tests.profile_id('admin')) as e) issued),
  'a reset link expires in 24 hours');
select throws_ok($$select public.invite_issue(tests.profile_id('member'), 'invite', extensions.digest('t2', 'sha256'), null)$$,
  '23514', 'This profile has already been claimed', 'no invite for a claimed person');
select throws_ok($$select public.invite_issue(tests.profile_id('placeholder_no_colour'), 'invite', extensions.digest('t3', 'sha256'), null)$$,
  '23514', 'Set the person''s colour before creating an invite', 'no invite before the person has a colour');

-- ---------------------------------------------------------------- invite_peek
select is((select row(display_name, colour, watched)::text from public.invite_peek(extensions.digest('new-viggo', 'sha256'), 'invite')),
  row('Viggo', '#f6b26b', 1)::text, 'an open invite shows the name, colour and films watched');
select is((select count(*)::integer from public.invite_peek(extensions.digest('local-dev-invite-viggo', 'sha256'), 'invite')), 0,
  'a revoked invite shows nothing');
select is((select count(*)::integer from public.invite_peek(extensions.digest('new-viggo', 'sha256'), 'reset')), 0,
  'an invite is not a reset link');
select is((select count(*)::integer from public.invite_peek(extensions.digest('nothing', 'sha256'), 'invite')), 0,
  'an unknown token shows nothing');
reset role;
update public.invites set created_at = now() - interval '2 days', expires_at = now() - interval '1 day'
  where token_hash = extensions.digest('reset-kwame', 'sha256');
select tests.login_service_role();
select is((select count(*)::integer from public.invite_peek(extensions.digest('reset-kwame', 'sha256'), 'reset')), 0,
  'an expired link shows nothing');
select is((select count(*)::integer from public.invite_redeem(extensions.digest('reset-kwame', 'sha256'), 'reset')), 0,
  'an expired link cannot be used');
select ok(public.invite_issue(tests.profile_id('member'), 'reset', extensions.digest('reset-kwame-2', 'sha256'), null) is not null,
  'an expired link is revoked when a new one is issued');

-- ---------------------------------------------------------------- invite_redeem
reset role;
insert into auth.users (id, instance_id, aud, role, email)
values ('10000000-0000-4000-8000-0000000000b1', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'viggo@example.test');
select tests.login_service_role();
select is((select auth_user_id from public.invite_redeem(extensions.digest('new-viggo', 'sha256'), 'invite', '10000000-0000-4000-8000-0000000000b1')),
  '10000000-0000-4000-8000-0000000000b1'::uuid, 'claiming an invite links the profile to the new login');
select ok((select is_claimed and claimed_at is not null from public.profiles where id = tests.profile_id('placeholder')),
  'the person is now claimed');
select ok((select used_at is not null from public.invites where token_hash = extensions.digest('new-viggo', 'sha256')),
  'the invite is used');
select is((select count(*)::integer from public.invite_redeem(extensions.digest('new-viggo', 'sha256'), 'invite', '10000000-0000-4000-8000-0000000000b1')), 0,
  'an invite cannot be used twice');
select is((select auth_user_id from public.invite_redeem(extensions.digest('reset-kwame-2', 'sha256'), 'reset')),
  tests.auth_user_id('member'), 'a reset link gives the person''s login');
select is((select count(*)::integer from public.invite_redeem(extensions.digest('reset-kwame-2', 'sha256'), 'reset')), 0,
  'a reset link cannot be used twice');

-- An invite whose person got a login some other way: refused, nothing changes.
reset role;
update public.profiles set colour = '#abcdef' where id = tests.profile_id('placeholder_no_colour');
select tests.login_service_role();
select ok(public.invite_issue(tests.profile_id('placeholder_no_colour'), 'invite', extensions.digest('wren', 'sha256'), null) is not null,
  'Wren gets an invite once she has a colour');
reset role;
insert into auth.users (id, instance_id, aud, role, email)
values ('10000000-0000-4000-8000-0000000000b2', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'wren@example.test');
update public.profiles set auth_user_id = '10000000-0000-4000-8000-0000000000b2' where id = tests.profile_id('placeholder_no_colour');
select tests.login_service_role();
select throws_ok($$select * from public.invite_redeem(extensions.digest('wren', 'sha256'), 'invite', '10000000-0000-4000-8000-0000000000b1')$$,
  '23514', null, 'an invite for someone already claimed is refused');
select ok((select used_at is null from public.invites where token_hash = extensions.digest('wren', 'sha256')),
  'and the invite is left as it was');

-- ---------------------------------------------------------------- created_at
reset role;
select throws_ok($$update public.invites set created_at = now() + interval '1 year', expires_at = now() + interval '1 year 1 hour'
  where token_hash = extensions.digest('wren', 'sha256')$$,
  '23514', 'An invite cannot be created in the future', 'a future created_at cannot stretch a link''s life, even for postgres');

-- ---------------------------------------------------------------- rate limit (failures only)
insert into public.rate_limits (bucket, subject, window_start, count) values
  ('invite-link', 'ip:203.0.113.1', date_trunc('hour', now()) - interval '1 hour', 50),
  ('invite-link', '*', date_trunc('hour', now()) - interval '2 hours', 500),
  ('tmdb-search', 'someone', date_trunc('hour', now()) - interval '1 hour', 1);
select tests.login_service_role();
select ok(public.invite_rate_ok('198.51.100.7'), 'a new address is allowed');
select is((select count(*)::integer from (select public.invite_rate_fail('198.51.100.7') from generate_series(1, 9)) x), 9, '9 failures recorded');
select ok(public.invite_rate_ok('198.51.100.7'), '9 failures: still allowed');
select lives_ok($$select public.invite_rate_fail('198.51.100.7')$$, 'a 10th failure');
select ok(not public.invite_rate_ok('198.51.100.7'), '10 failures an hour per IP: refused');
select ok(public.invite_rate_ok('198.51.100.8'), 'another address is still allowed');
reset role;
select is((select count(*)::integer from public.rate_limits where bucket = 'invite-link' and window_start < date_trunc('hour', now())), 0,
  'old windows are deleted for every subject');
select is((select count(*)::integer from public.rate_limits where bucket = 'tmdb-search'), 1, 'other buckets are left alone');
select tests.login_service_role();
select is((select count(*)::integer from (select public.invite_rate_fail('spoofed-' || n) from generate_series(1, 90) n) x), 90, '90 more failures from spoofed addresses');
select ok(not public.invite_rate_ok('198.51.100.9'), '100 failures an hour from everyone: everyone is refused');
select lives_ok($$select public.invite_rate_fail(repeat('z', 500))$$, 'a huge address is accepted');
reset role;
select is((select max(char_length(subject)) from public.rate_limits where bucket = 'invite-link'), 64, 'subjects are clipped to 64 characters');
select tests.login_service_role();
select ok(public.invite_rate_ok('198.51.100.9', 'abc'), 'an open link is not held back by the overall cap');
select is((select count(*)::integer from (select public.invite_rate_fail('198.51.100.' || n, 'abc') from generate_series(1, 10) n) x), 10,
  '10 failed claims on one link, from different addresses');
select ok(not public.invite_rate_ok('198.51.100.200', 'abc') and public.invite_rate_ok('198.51.100.200', 'def'),
  'that link is refused for an hour; other links are not');
reset role;
select tests.login_service_role();
select lives_ok($$select public.invite_rate_fail('*')$$, 'an address of * never clashes with the overall count');
reset role;

select * from finish();
rollback;
