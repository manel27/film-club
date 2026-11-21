-- Phase 8 rules: titles that normalise to '' are refused, comments made only
-- of whitespace (including newlines, tabs, carriage returns) are refused, and
-- day_order is assigned on add (day_order null) and when a film changes day.
begin;
select plan(14);

-- ---------------------------------------------------------------- titles
select is((select count(*)::int from public.films where title_norm = ''), 0,
  'no existing film has an empty normalised title');
select throws_ok($$insert into public.films (title, release_year, screened_on, assigned_id)
  values ('!!! ...', 2001, '2026-03-07', tests.profile_id('admin'))$$,
  '23514', null, 'a punctuation-only title is refused');
select throws_ok($$insert into public.films (title, release_year, screened_on, assigned_id)
  values (U&'\200B\200B', 2001, '2026-03-07', tests.profile_id('admin'))$$,
  '23514', null, 'a zero-width-space title is refused');
select throws_ok($$insert into public.films (title, release_year, screened_on, assigned_id)
  values (U&'\+01F3AC', 2001, '2026-03-07', tests.profile_id('admin'))$$,
  '23514', null, 'an emoji-only title is refused');
select tests.login_as('moderator');
select throws_ok($$update public.films set title = '???' where id = 2$$,
  '23514', null, 'a title cannot be changed to one that normalises to nothing');
reset role;

-- ---------------------------------------------------------------- comments
select tests.login_as('member');
select throws_ok($$insert into public.comments (film_id, author_id, body)
  values (1, tests.profile_id('member'), E'\n\n')$$, '23514', null, 'newlines only are refused');
select throws_ok($$insert into public.comments (film_id, author_id, body)
  values (1, tests.profile_id('member'), E' \t\r\n ')$$, '23514', null, 'tabs, CR and spaces only are refused');
select lives_ok($$insert into public.comments (film_id, author_id, body)
  values (1, tests.profile_id('member'), E'\n ok \n')$$, 'text with surrounding newlines is allowed');
reset role;

-- ---------------------------------------------------------------- day_order
select is((select count(*)::int from (select 1 from public.films group by screened_on, day_order having count(*) > 1) t),
  0, 'no two films share a day and day_order');

select tests.login_as('moderator');
-- 2026-01-31 has the two marathon films (day_order 1 and 2).
insert into public.films (title, release_year, screened_on, assigned_id, day_order)
  values ('Third Of The Night', 2001, '2026-01-31', tests.profile_id('admin'), null);
select is((select day_order from public.films where title = 'Third Of The Night'), 3::smallint,
  'added with day_order null: after the day''s other films');
insert into public.films (title, release_year, screened_on, assigned_id, day_order)
  values ('Alone On Its Day', 2002, '2026-03-21', tests.profile_id('admin'), null);
select is((select day_order from public.films where title = 'Alone On Its Day'), 1::smallint,
  'first film of its day: 1');

update public.films set screened_on = '2026-01-31' where id = 8;
select is((select day_order from public.films where id = 8), 4::smallint,
  'moved to another day: after that day''s films');
update public.films set kind = 'cinema', assigned_id = tests.profile_id('cinema') where id = 8;
select is((select day_order from public.films where id = 8), 4::smallint,
  'other edits keep day_order');
update public.films set screened_on = '2026-03-21', day_order = 7 where id = 8;
select is((select day_order from public.films where id = 8), 7::smallint,
  'an explicit day_order with the move is kept');
reset role;

select * from finish();
rollback;
