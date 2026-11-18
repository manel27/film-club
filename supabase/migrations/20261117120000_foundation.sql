-- Foundation: private helper schema, extensions, enums and generic helpers.
--
-- The `app` schema is NOT exposed by the Data API (config.toml only exposes
-- `public` and `graphql_public`), so helpers here can't be called directly by
-- browsers. RLS policies and triggers call them.

create schema if not exists app;
comment on schema app is 'Private helpers used by RLS policies and triggers. Not exposed by the Data API.';

revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;

create extension if not exists unaccent with schema extensions;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type public.profile_role as enum ('admin', 'moderator', 'member', 'viewer');
comment on type public.profile_role is
  'admin: everything; moderator: films, others'' attendance/scores, rotation; member: own rows; viewer: read-only.';

create type public.film_kind as enum ('normal', 'democratico', 'cinema', 'maratona');
comment on type public.film_kind is
  'normal: chosen by the turn-holder; democratico: group vote; cinema: watched at the cinema; maratona: extra session.';

-- ---------------------------------------------------------------------------
-- Generic helpers
-- ---------------------------------------------------------------------------

-- True when the statement is NOT running on behalf of a browser user
-- (i.e. the Supabase secret key / service_role, or a direct postgres session
-- such as migrations and the one-off import). Guard triggers use this to keep
-- some columns import-only. It must be called from SECURITY INVOKER code:
-- inside a SECURITY DEFINER function current_user is the function owner.
create function app.is_privileged()
returns boolean
language sql
stable
set search_path = ''
as $$
  select current_user not in ('anon', 'authenticated');
$$;

-- Immutable wrapper around unaccent so it can be used in generated columns
-- and indexes (unaccent() itself is only STABLE because its dictionary is
-- looked up by name; pinning the dictionary makes it safe to mark IMMUTABLE).
create function app.immutable_unaccent(value text)
returns text
language sql
immutable
parallel safe
strict
set search_path = ''
as $$
  select extensions.unaccent('extensions.unaccent'::regdictionary, value);
$$;

-- Normalised title used by the no-duplicate rule (plan 4.3). The exact rule,
-- in order:
--   1. remove Unicode format characters (general category Cf: zero-width
--      space/joiners U+200B–U+200F, soft hyphen U+00AD, BOM U+FEFF, word
--      joiner U+2060–U+2064, bidi controls U+202A–U+202E / U+2066–U+206F,
--      and the rest of Cf listed below);
--   2. unaccent (Postgres `unaccent` rules: removes diacritics and also
--      expands ligatures, e.g. ß -> ss, æ -> ae, ø -> o);
--   3. lower case;
--   4. delete apostrophes and backticks: ' ’ ` ´
--   5. replace every run of non-alphanumeric characters (letters and digits of
--      any script count as alphanumeric) with one space;
--   6. trim.
--   'Amélie' -> 'amelie'; 'Schindler''s List' -> 'schindlers list';
--   'Spider-Man: Homecoming' -> 'spider man homecoming'; 'Ze<U+200B>ro' -> 'zero'
-- UI mirror (JavaScript; close but not identical for rare ligatures, so the
-- database check film_duplicate_check() stays authoritative):
--   s.replace(/\p{Cf}/gu, '').normalize('NFKD').replace(/\p{M}/gu, '')
--    .replace(/ß/g, 'ss').replace(/æ/gi, 'ae').replace(/œ/gi, 'oe').replace(/[øØ]/g, 'o')
--    .toLowerCase().replace(/['’`´]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
-- Postgres regexes have no \p{...}, so step 1 lists the Cf code points.
create function app.normalize_title(value text)
returns text
language sql
immutable
parallel safe
strict
set search_path = ''
as $$
  select btrim(
    regexp_replace(
      regexp_replace(
        lower(app.immutable_unaccent(
          regexp_replace(
            value,
            U&'[\00AD\0600-\0605\061C\06DD\070F\0890-\0891\08E2\180E\200B-\200F\202A-\202E\2060-\2064\2066-\206F\FEFF\FFF9-\FFFB\+0110BD\+0110CD\+013430-\+01343F\+01BCA0-\+01BCA3\+01D173-\+01D17A\+0E0001\+0E0020-\+0E007F]',
            '', 'g'))),
        '[''’`´]', '', 'g'),
      '[^[:alnum:]]+', ' ', 'g'));
$$;

create function app.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on all functions in schema app from public;
grant execute on all functions in schema app to authenticated, service_role;

-- Deny by default for objects created later by migrations: no automatic
-- grants to `anon` (not logged in), and no TRUNCATE (which ignores RLS and
-- row triggers) for `authenticated` or the secret key (`service_role`).
-- Each migration grants exactly what it needs.
-- Note: `maintain` is a Postgres 17 privilege; the hosted project must be on
-- Postgres 17 (config.toml: db.major_version = 17).
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke execute on functions from anon, public;
alter default privileges for role postgres in schema public
  revoke truncate, references, trigger, maintain on tables from authenticated, service_role;
-- New functions must not be executable by everyone. The per-schema form is
-- kept for intent, but Postgres only lets per-schema defaults ADD to the
-- global ones, so the global revoke below is what actually removes PUBLIC's
-- built-in EXECUTE (verified in tests/001). Migrations grant explicitly.
alter default privileges for role postgres in schema app revoke execute on functions from public;
alter default privileges for role postgres revoke execute on functions from public;
