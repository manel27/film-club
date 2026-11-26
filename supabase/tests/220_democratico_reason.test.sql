-- Phase 16b (migration 20261126120000): films.democratico_reason, why a
-- Democrático was chosen. Film 6 is the seed's Democrático, film 2 a normal film.
begin;
select plan(14);

select has_column('public', 'films', 'democratico_reason', 'films has democratico_reason');

select tests.login_as('moderator');
select lives_ok($$update public.films set democratico_reason = 'Nobody could agree on anything else' where id = 6$$,
  'staff can set a Democrático''s reason');
select lives_ok($$update public.films set democratico_reason = repeat('a', 200) where id = 6$$,
  '200 characters are accepted');
select throws_ok($$update public.films set democratico_reason = repeat('a', 201) where id = 6$$,
  '23514', null, '201 characters are refused');
select throws_ok($$update public.films set democratico_reason = E' \t\n ' where id = 6$$,
  '23514', null, 'a whitespace-only reason is refused');
select throws_ok($$update public.films set democratico_reason = E'​‍﻿' where id = 6$$,
  '23514', null, 'a reason of invisible characters only is refused');
select throws_ok($$update public.films set democratico_reason = 'Because' where id = 2$$,
  '23514', null, 'a non-Democrático with a reason is refused');
select throws_ok($$update public.films set kind = 'normal', turn_holder_id = null where id = 6$$,
  '23514', null, 'a Democrático with a reason cannot become another kind and keep it');
select lives_ok($$update public.films set kind = 'normal', turn_holder_id = null, democratico_reason = null where id = 6$$,
  'it can once the reason is cleared');
select lives_ok($$update public.films set kind = 'democratico', democratico_reason = 'Back again' where id = 6$$,
  'and get one again as a Democrático');
reset role;

select tests.login_as('member');
update public.films set democratico_reason = 'Member was here' where id = 6;
select is((select democratico_reason from public.films where id = 6), 'Back again',
  'a member cannot change it (and can read it)');
reset role;

select tests.login_as('viewer');
select is((select democratico_reason from public.films where id = 6), 'Back again',
  'a viewer can read it');
reset role;

-- ---------------------------------------------------------------- export
create temporary table export on commit drop as select null::json as data;
grant all on export to authenticated;
select tests.login_as('admin');
update export set data = public.export_data();
reset role;

select ok((select data->'columns'->'films' from export)::jsonb ? 'democratico_reason',
  'export: films columns list democratico_reason');
select is((select t->>'democratico_reason' from export, json_array_elements(data->'tables'->'films') t
  where (t->>'id')::int = 6), 'Back again', 'export: films rows carry the reason');

select * from finish();
rollback;
