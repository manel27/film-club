-- Sweep: a viewer can alter NOTHING (decision 15) and a visitor who is not
-- logged in gets NOTHING, on every table. Every write is attempted against
-- every table; the database must be byte-for-byte unchanged afterwards.
begin;
select plan(87);

create temporary table writes (tbl text, ins text, upd text, del text) on commit drop;
insert into writes values
  ('profiles',
   $$insert into public.profiles (display_name) values ('Sneaky')$$,
   $$update public.profiles set display_name = display_name || '!'$$,
   $$delete from public.profiles$$),
  ('films',
   $$insert into public.films (tmdb_id, title, release_year, screened_on, assigned_id) values (940001, 'Sneaky', 2000, '2026-01-01', '00000000-0000-4000-8000-0000000000a5')$$,
   $$update public.films set title = title || '!'$$,
   $$delete from public.films$$),
  ('attendance',
   $$insert into public.attendance (film_id, profile_id) values (8, '00000000-0000-4000-8000-0000000000a5')$$,
   $$update public.attendance set marked_at = now()$$,
   $$delete from public.attendance$$),
  ('scores',
   $$insert into public.scores (film_id, profile_id, score) values (8, '00000000-0000-4000-8000-0000000000a5', 5)$$,
   $$update public.scores set score = 0$$,
   $$delete from public.scores$$),
  ('comments',
   $$insert into public.comments (film_id, author_id, body) values (1, '00000000-0000-4000-8000-0000000000a5', 'sneaky')$$,
   $$update public.comments set body = 'sneaky'$$,
   $$delete from public.comments$$),
  ('invites',
   $$insert into public.invites (token_hash, profile_id) values (extensions.digest('s', 'sha256'), '00000000-0000-4000-8000-0000000000b2')$$,
   $$update public.invites set revoked_at = now()$$,
   $$delete from public.invites$$),
  ('rotation_adjustments',
   $$insert into public.rotation_adjustments (profile_id, set_to) values ('00000000-0000-4000-8000-0000000000a5', 99)$$,
   $$update public.rotation_adjustments set set_to = 99$$,
   $$delete from public.rotation_adjustments$$),
  ('rotation_passes',
   $$insert into public.rotation_passes (week_start, profile_id) values ('2026-04-06', '00000000-0000-4000-8000-0000000000a5')$$,
   $$update public.rotation_passes set week_start = '2026-04-13'$$,
   $$delete from public.rotation_passes$$),
  ('rotation_next',
   $$insert into public.rotation_next (week_start, profile_id) values ('2026-04-06', '00000000-0000-4000-8000-0000000000a5')$$,
   $$update public.rotation_next set profile_id = '00000000-0000-4000-8000-0000000000a5'$$,
   $$delete from public.rotation_next$$),
  ('app_settings',
   $$insert into public.app_settings (key, value) values ('sneaky', '1')$$,
   $$update public.app_settings set value = '1'$$,
   $$delete from public.app_settings$$),
  ('user_settings',
   $$insert into public.user_settings (profile_id, theme) values ('00000000-0000-4000-8000-0000000000a5', 'batman')$$,
   $$update public.user_settings set theme = 'superman'$$,
   $$delete from public.user_settings$$),
  ('rate_limits',
   $$insert into public.rate_limits (bucket, subject, window_start) values ('x', 'y', now())$$,
   $$update public.rate_limits set count = 0$$,
   $$delete from public.rate_limits$$);
grant select on writes to anon, authenticated;

-- A viewer-owned row in every per-person table, so "own row" paths are tried too.
insert into public.attendance (film_id, profile_id) values (1, tests.profile_id('viewer'));
insert into public.scores (film_id, profile_id, score) values (1, tests.profile_id('viewer'), 5);
insert into public.comments (film_id, author_id, body) values (1, tests.profile_id('viewer'), 'viewer note');
insert into public.rotation_passes (week_start, profile_id) values ('2026-03-02', tests.profile_id('viewer'));
insert into public.user_settings (profile_id, theme) values (tests.profile_id('viewer'), 'batman');

-- Snapshot of all data
create temporary table before_snapshot on commit drop as
select 'profiles' t, md5(string_agg(x::text, ',' order by x::text)) h from public.profiles x
union all select 'films', md5(string_agg(x::text, ',' order by x::text)) from public.films x
union all select 'attendance', md5(string_agg(x::text, ',' order by x::text)) from public.attendance x
union all select 'scores', md5(string_agg(x::text, ',' order by x::text)) from public.scores x
union all select 'comments', md5(string_agg(x::text, ',' order by x::text)) from public.comments x
union all select 'invites', md5(string_agg(x::text, ',' order by x::text)) from public.invites x
union all select 'rotation_adjustments', md5(string_agg(x::text, ',' order by x::text)) from public.rotation_adjustments x
union all select 'rotation_passes', md5(string_agg(x::text, ',' order by x::text)) from public.rotation_passes x
union all select 'rotation_next', md5(string_agg(x::text, ',' order by x::text)) from public.rotation_next x
union all select 'app_settings', md5(string_agg(x::text, ',' order by x::text)) from public.app_settings x
union all select 'user_settings', md5(string_agg(x::text, ',' order by x::text)) from public.user_settings x
union all select 'rate_limits', md5(coalesce(string_agg(x::text, ',' order by x::text), '')) from public.rate_limits x;

-- ---------------------------------------------------------------- viewer
select tests.login_as('viewer');

-- Inserts are refused outright (RLS or missing grant).
select throws_ok(ins, '42501', null, format('viewer cannot insert into %s', tbl)) from writes order by tbl;

-- Updates and deletes either touch 0 rows or are refused; never succeed.
select is(tests.attempt(upd), 0, format('viewer cannot update %s', tbl)) from writes order by tbl;
select is(tests.attempt(del), 0, format('viewer cannot delete from %s', tbl)) from writes order by tbl;
reset role;

-- ---------------------------------------------------------------- anon
select tests.login_anon();
select throws_ok(format('select * from public.%I', tbl), '42501', null, format('anon cannot read %s', tbl)) from writes order by tbl;
select throws_ok(ins, '42501', null, format('anon cannot insert into %s', tbl)) from writes order by tbl;
select throws_ok(upd, '42501', null, format('anon cannot update %s', tbl)) from writes order by tbl;
select throws_ok(del, '42501', null, format('anon cannot delete from %s', tbl)) from writes order by tbl;
select throws_ok('select * from public.film_stats', '42501', null, 'anon cannot read film_stats');
select throws_ok('select app.current_role()', '42501', null, 'anon cannot call the app helpers');
reset role;

-- ---------------------------------------------------------------- nothing changed
select is(
  (select count(*)::int from before_snapshot b
   where b.h is distinct from (case b.t
     when 'profiles' then (select md5(string_agg(x::text, ',' order by x::text)) from public.profiles x)
     when 'films' then (select md5(string_agg(x::text, ',' order by x::text)) from public.films x)
     when 'attendance' then (select md5(string_agg(x::text, ',' order by x::text)) from public.attendance x)
     when 'scores' then (select md5(string_agg(x::text, ',' order by x::text)) from public.scores x)
     when 'comments' then (select md5(string_agg(x::text, ',' order by x::text)) from public.comments x)
     when 'invites' then (select md5(string_agg(x::text, ',' order by x::text)) from public.invites x)
     when 'rotation_adjustments' then (select md5(string_agg(x::text, ',' order by x::text)) from public.rotation_adjustments x)
     when 'rotation_passes' then (select md5(string_agg(x::text, ',' order by x::text)) from public.rotation_passes x)
     when 'rotation_next' then (select md5(string_agg(x::text, ',' order by x::text)) from public.rotation_next x)
     when 'app_settings' then (select md5(string_agg(x::text, ',' order by x::text)) from public.app_settings x)
     when 'user_settings' then (select md5(string_agg(x::text, ',' order by x::text)) from public.user_settings x)
     when 'rate_limits' then (select md5(coalesce(string_agg(x::text, ',' order by x::text), '')) from public.rate_limits x)
   end)),
  0, 'after every viewer and anon attempt, every table is unchanged');

select * from finish();
rollback;
