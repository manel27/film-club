-- Security audit S1 (docs, 2026-11-23): an access token outlived its session.
--
-- PostgREST only checks a JWT's signature and expiry, so after a password
-- reset (decision I3: every other session ends) an already-issued access
-- token kept reading and writing until it expired. The two role helpers that
-- every RLS policy and guard goes through now also require the token's
-- session to still exist in auth.sessions; a logged-out, reset or revoked
-- session gets nothing, like a visitor. jwt_expiry is also down to 10 minutes
-- (config.toml; the hosted project is set by the owner).
--
-- Still STABLE and SECURITY DEFINER with a fixed search_path; policies call
-- them as (select app.fn()), so Postgres runs them once per statement (an
-- InitPlan), not once per row. The session lookup is by primary key.

create function app.session_is_live()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from auth.sessions s
    where s.id = case
        when auth.jwt() ->> 'session_id' ~ '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$'
          then (auth.jwt() ->> 'session_id')::uuid
      end
      and s.user_id = auth.uid()
  );
$$;

create or replace function app.current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from public.profiles p
  where p.auth_user_id = auth.uid()
    and auth.uid() is not null
    and app.session_is_live();
$$;

create or replace function app.current_role()
returns public.profile_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
  from public.profiles p
  where p.auth_user_id = auth.uid()
    and auth.uid() is not null
    and app.session_is_live();
$$;

revoke execute on function app.session_is_live() from public;
grant execute on function app.session_is_live() to authenticated, service_role;
