-- Helpers for the pgTAP tests in supabase/tests. Loaded after seed.sql on the
-- LOCAL stack only (config.toml [db.seed]); never part of a migration, so it
-- never reaches production.

create extension if not exists pgtap with schema extensions;

create schema if not exists tests;
grant usage on schema tests to anon, authenticated, service_role;

-- Fixed seed identities (see seed.sql).
create or replace function tests.profile_id(who text)
returns uuid
language sql
immutable
as $$
  select case who
    when 'admin'       then '00000000-0000-4000-8000-0000000000a1'
    when 'moderator'   then '00000000-0000-4000-8000-0000000000a2'
    when 'member'      then '00000000-0000-4000-8000-0000000000a3'
    when 'member2'     then '00000000-0000-4000-8000-0000000000a4'
    when 'viewer'      then '00000000-0000-4000-8000-0000000000a5'
    when 'placeholder' then '00000000-0000-4000-8000-0000000000b1'
    when 'placeholder_no_colour' then '00000000-0000-4000-8000-0000000000b2'
    when 'cinema'      then '00000000-0000-4000-8000-0000000000c1'
    when 'archive'     then '00000000-0000-4000-8000-0000000000c2'
  end::uuid;
$$;

create or replace function tests.auth_user_id(who text)
returns uuid
language sql
immutable
as $$
  select case who
    when 'admin'     then '10000000-0000-4000-8000-0000000000a1'
    when 'moderator' then '10000000-0000-4000-8000-0000000000a2'
    when 'member'    then '10000000-0000-4000-8000-0000000000a3'
    when 'member2'   then '10000000-0000-4000-8000-0000000000a4'
    when 'viewer'    then '10000000-0000-4000-8000-0000000000a5'
  end::uuid;
$$;

-- Act as a logged-in browser user (role `authenticated` + JWT claims), as
-- PostgREST does. Transaction-local. Go back to postgres with `reset role;`.
create or replace function tests.login_as_uid(uid uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated', 'aud', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create or replace function tests.login_as(who text)
returns void
language plpgsql
as $$
begin
  if tests.auth_user_id(who) is null then
    raise exception 'tests.login_as: unknown user %', who;
  end if;
  perform tests.login_as_uid(tests.auth_user_id(who));
end;
$$;

-- Act as a visitor who is not logged in (publishable key, no session).
create or replace function tests.login_anon()
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('role', 'anon', true);
end;
$$;

-- Act as the Supabase secret key (service_role: bypasses RLS, not triggers).
create or replace function tests.login_service_role()
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('role', 'service_role', true);
end;
$$;

-- Runs a statement with the caller's rights and returns the number of rows
-- it affected. RLS silently filters UPDATE/DELETE, so "denied" = 0 rows.
create or replace function tests.affected(stmt text)
returns integer
language plpgsql
as $$
declare
  n integer;
begin
  execute stmt;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Like tests.affected, but a "permission denied" counts as 0 rows: for
-- sweeps where either outcome means "nothing changed".
create or replace function tests.attempt(stmt text)
returns integer
language plpgsql
as $$
begin
  return tests.affected(stmt);
exception when insufficient_privilege then
  return 0;
end;
$$;

-- Number of rows a query returns, with the caller's rights.
create or replace function tests.row_count(query text)
returns integer
language plpgsql
as $$
declare
  n integer;
begin
  execute format('select count(*) from (%s) q', query) into n;
  return n;
end;
$$;

grant execute on all functions in schema tests to anon, authenticated, service_role;
