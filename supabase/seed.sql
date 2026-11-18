-- Local development seed. SYNTHETIC DATA ONLY: invented people and films.
-- Never put real club members, sheet rows or notes here (the repo is public).
-- Applied by `supabase start` / `supabase db reset` on the LOCAL stack only;
-- it is never pushed to production.
--
-- Local logins (password for all: film-club-local):
--   orla@example.test    admin
--   tamsin@example.test  moderator
--   kwame@example.test   member
--   yusuf@example.test   member
--   petra@example.test   viewer
-- Viggo and Wren are unclaimed placeholders (no login).
-- The pgTAP tests in supabase/tests rely on these fixed ids.

-- ---------------------------------------------------------------------------
-- Auth users
-- ---------------------------------------------------------------------------

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new
)
select
  '00000000-0000-0000-0000-000000000000',
  u.id,
  'authenticated',
  'authenticated',
  u.email,
  extensions.crypt('film-club-local', extensions.gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  now(),
  now(),
  '', '', '', ''
from (values
  ('10000000-0000-4000-8000-0000000000a1'::uuid, 'orla@example.test'),
  ('10000000-0000-4000-8000-0000000000a2'::uuid, 'tamsin@example.test'),
  ('10000000-0000-4000-8000-0000000000a3'::uuid, 'kwame@example.test'),
  ('10000000-0000-4000-8000-0000000000a4'::uuid, 'yusuf@example.test'),
  ('10000000-0000-4000-8000-0000000000a5'::uuid, 'petra@example.test')
) as u (id, email);

insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id, u.id::text, 'email',
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       now(), now(), now()
from auth.users u
where u.email like '%@example.test';

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------

insert into public.profiles (id, auth_user_id, display_name, sheet_keyword, colour, role, claimed_at, is_system) values
  ('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', 'Orla',   'Orl', '#4a86e8', 'admin',     now(), false),
  ('00000000-0000-4000-8000-0000000000a2', '10000000-0000-4000-8000-0000000000a2', 'Tamsin', 'Tam', '#6aa84f', 'moderator', now(), false),
  ('00000000-0000-4000-8000-0000000000a3', '10000000-0000-4000-8000-0000000000a3', 'Kwame',  'Kw',  '#e06666', 'member',    now(), false),
  ('00000000-0000-4000-8000-0000000000a4', '10000000-0000-4000-8000-0000000000a4', 'Yusuf',  'Yu',  '#8e7cc3', 'member',    now(), false),
  ('00000000-0000-4000-8000-0000000000a5', '10000000-0000-4000-8000-0000000000a5', 'Petra',  null,  '#76a5af', 'viewer',    now(), false),
  ('00000000-0000-4000-8000-0000000000b1', null, 'Viggo',  'Vig', '#f6b26b', 'member', null, false),
  ('00000000-0000-4000-8000-0000000000b2', null, 'Wren',   null,  null,      'member', null, false),
  ('00000000-0000-4000-8000-0000000000c1', null, 'Cinema',        null, '#999999', 'member', null, true),
  ('00000000-0000-4000-8000-0000000000c2', null, 'Sheet archive', null, '#cccccc', 'member', null, true);

-- ---------------------------------------------------------------------------
-- Films (fake titles, fake TMDB ids in the 900000 range)
-- ---------------------------------------------------------------------------

insert into public.films (
  id, tmdb_id, title, original_title, release_year, genres, directors,
  screened_on, kind, assigned_id, turn_holder_id, day_order, is_easter_egg
) overriding system value values
  (1, 900001, 'The Quiet Orchard', null, 2019, '{Drama}', '{"Oona Marlow"}',
     '2026-01-10', 'normal', '00000000-0000-4000-8000-0000000000a3', null, 1, false),
  (2, 900002, 'Neon Harbour', 'Porto de Néon', 2021, '{Thriller,Crime}', '{"Rui Sombra"}',
     '2026-01-17', 'normal', '00000000-0000-4000-8000-0000000000a2', null, 1, false),
  (3, null, 'Paper Moons Over the River', null, 2018, '{}', '{}',
     '2026-01-24', 'cinema', '00000000-0000-4000-8000-0000000000c1', null, 1, false),
  (4, 900003, 'Midnight Marathon', null, 2015, '{Action}', '{"Dana Kell"}',
     '2026-01-31', 'maratona', '00000000-0000-4000-8000-0000000000a1', null, 1, false),
  (5, 900004, 'Midnight Marathon II', null, 2017, '{Action}', '{"Dana Kell"}',
     '2026-01-31', 'maratona', '00000000-0000-4000-8000-0000000000a1', null, 2, false),
  (6, 900005, 'The Long Vote', null, 2020, '{Comedy}', '{"Lea Fontaine"}',
     '2026-02-07', 'democratico', '00000000-0000-4000-8000-0000000000a4',
     '00000000-0000-4000-8000-0000000000a3', 1, false),
  (7, 900099, 'Megashark Rising 2', null, 2010, '{Horror,Comedy}', '{"Ted Gulp"}',
     '2025-06-14', 'democratico', '00000000-0000-4000-8000-0000000000a1', null, 1, true),
  (8, 900006, 'Tomorrow''s Feature', null, 2024, '{Animation}', '{"Mo Arden"}',
     '2026-12-05', 'normal', '00000000-0000-4000-8000-0000000000a4', null, 1, false);

select setval(pg_get_serial_sequence('public.films', 'id'), 100);

-- ---------------------------------------------------------------------------
-- Attendance and scores
-- ---------------------------------------------------------------------------

insert into public.attendance (film_id, profile_id, marked_by)
select f, p::uuid, '00000000-0000-4000-8000-0000000000a1'::uuid
from (values
  (1, '00000000-0000-4000-8000-0000000000a1'), (1, '00000000-0000-4000-8000-0000000000a2'),
  (1, '00000000-0000-4000-8000-0000000000a3'), (1, '00000000-0000-4000-8000-0000000000b1'),
  (2, '00000000-0000-4000-8000-0000000000a2'), (2, '00000000-0000-4000-8000-0000000000a3'),
  (2, '00000000-0000-4000-8000-0000000000a4'),
  (3, '00000000-0000-4000-8000-0000000000a1'), (3, '00000000-0000-4000-8000-0000000000a4'),
  (4, '00000000-0000-4000-8000-0000000000a1'), (5, '00000000-0000-4000-8000-0000000000a1'),
  (6, '00000000-0000-4000-8000-0000000000a1'), (6, '00000000-0000-4000-8000-0000000000a2'),
  (6, '00000000-0000-4000-8000-0000000000a4')
) as a (f, p);

insert into public.scores (film_id, profile_id, score, entered_by)
select f, p::uuid, s, p::uuid
from (values
  (1, '00000000-0000-4000-8000-0000000000a1', 7.50), (1, '00000000-0000-4000-8000-0000000000a2', 8.00),
  (1, '00000000-0000-4000-8000-0000000000a3', 9.25), (1, '00000000-0000-4000-8000-0000000000b1', 6.00),
  (2, '00000000-0000-4000-8000-0000000000a2', 6.75), (2, '00000000-0000-4000-8000-0000000000a3', 5.50),
  (2, '00000000-0000-4000-8000-0000000000a4', 7.00),
  -- scored without being present
  (2, '00000000-0000-4000-8000-0000000000a1', 8.10),
  (3, '00000000-0000-4000-8000-0000000000a1', 9.00), (3, '00000000-0000-4000-8000-0000000000a4', 8.50),
  (6, '00000000-0000-4000-8000-0000000000a2', 4.00), (6, '00000000-0000-4000-8000-0000000000a4', 10.00)
) as s (f, p, s);

-- The easter egg: scores of 11, imported while unlocked, then locked for good.
insert into public.scores (film_id, profile_id, score)
values
  (7, '00000000-0000-4000-8000-0000000000a1', 11),
  (7, '00000000-0000-4000-8000-0000000000a2', 11),
  (7, '00000000-0000-4000-8000-0000000000a3', 11);
update public.films set scores_locked = true where id = 7;

-- ---------------------------------------------------------------------------
-- Comments
-- ---------------------------------------------------------------------------

insert into public.comments (film_id, author_id, body, is_legacy, created_at) values
  (1, '00000000-0000-4000-8000-0000000000c2', 'Legacy note: projector broke halfway, finished on a laptop.', true, '2026-01-10 23:00+00'),
  (1, '00000000-0000-4000-8000-0000000000a3', 'Loved the ending.', false, '2026-01-11 10:00+00'),
  (2, '00000000-0000-4000-8000-0000000000a4', 'Too long, great soundtrack.', false, '2026-01-18 09:30+00'),
  (2, '00000000-0000-4000-8000-0000000000a2', 'The harbour scene!', false, '2026-01-18 11:00+00');

-- ---------------------------------------------------------------------------
-- Rotation inputs and settings
-- ---------------------------------------------------------------------------

insert into public.app_settings (key, value) values
  ('rotation_epoch', '"2026-01-05"');

insert into public.rotation_adjustments (profile_id, set_to, reason, effective_at, created_by) values
  ('00000000-0000-4000-8000-0000000000a1', 2, 'Starting value', '2026-01-05 00:00+00', '00000000-0000-4000-8000-0000000000a1'),
  ('00000000-0000-4000-8000-0000000000a2', 1, 'Starting value', '2026-01-05 00:00+00', '00000000-0000-4000-8000-0000000000a1'),
  ('00000000-0000-4000-8000-0000000000a3', 3, 'Starting value', '2026-01-05 00:00+00', '00000000-0000-4000-8000-0000000000a1'),
  ('00000000-0000-4000-8000-0000000000a4', 0, 'Starting value', '2026-01-05 00:00+00', '00000000-0000-4000-8000-0000000000a1');

insert into public.rotation_passes (week_start, profile_id, created_by) values
  ('2026-02-09', '00000000-0000-4000-8000-0000000000a4', '00000000-0000-4000-8000-0000000000a4');

insert into public.rotation_next (week_start, profile_id, decided_by) values
  ('2026-01-12', '00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000a1');

insert into public.user_settings (profile_id, theme, films_view) values
  ('00000000-0000-4000-8000-0000000000a3', 'batman', 'posters');

-- An open invite for the placeholder Viggo (hash of a throwaway local token).
insert into public.invites (token_hash, profile_id, created_by)
values (extensions.digest('local-dev-invite-viggo', 'sha256'), '00000000-0000-4000-8000-0000000000b1',
        '00000000-0000-4000-8000-0000000000a1');
