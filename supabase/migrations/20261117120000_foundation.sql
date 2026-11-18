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

-- Normalised title used by the no-duplicate rule (plan 4.3):
-- lower case, accents removed, apostrophes dropped, other punctuation turned
-- into spaces, whitespace collapsed and trimmed.
--   'Amélie'            -> 'amelie'
--   'Schindler''s List' -> 'schindlers list'
--   'Spider-Man: Homecoming' -> 'spider man homecoming'
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
        lower(app.immutable_unaccent(value)),
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
-- grants to `anon` (not logged in), and no TRUNCATE (which ignores RLS) for
-- `authenticated`. Each migration grants exactly what it needs.
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke execute on functions from anon, public;
alter default privileges for role postgres in schema public
  revoke truncate, references, trigger, maintain on tables from authenticated;
