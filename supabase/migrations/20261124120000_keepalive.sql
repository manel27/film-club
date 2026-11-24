-- Phase 13 (plan 2.4): the free plan pauses a project after a week without
-- activity. .github/workflows/keepalive.yml calls keepalive() every 3 days
-- with the public publishable key.
--
-- It reads one row of app_settings (real database activity) but always
-- returns true, so it tells an anonymous caller nothing. count(*) >= 0
-- rather than `exists(...) or true`, which the planner would fold away
-- without touching the table. SECURITY DEFINER because anon can't read
-- app_settings.

create function public.keepalive()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select count(*) >= 0 from (select from public.app_settings limit 1) t;
$$;

comment on function public.keepalive() is
  'Keep-alive ping for the scheduled GitHub Action: one trivial read, always returns true (no data).';

revoke execute on function public.keepalive() from public;
grant execute on function public.keepalive() to anon, authenticated;
