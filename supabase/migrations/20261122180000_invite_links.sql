-- Invite and reset links (phase 11, plan 7; decisions I1, I2).
--
-- One table for both: `kind` = 'invite' (an unclaimed person sets up their
-- login, 14 days) or 'reset' (a claimed person sets a new password, 24 hours,
-- decision I2). Both are single use, revocable, and only the SHA-256 hash of
-- the token is stored. The one-open-link-per-profile index still holds: a
-- profile is either unclaimed (invites) or claimed (resets), never both.
--
-- The RPCs below are for the Edge Functions only (secret key): nobody else
-- can execute them, and browsers still can't read invites unless admin.

alter table public.invites
  add column kind text not null default 'invite'
    constraint invites_kind check (kind in ('invite', 'reset')),
  add constraint invites_lifetime check (
    expires_at <= created_at
      + case kind when 'reset' then interval '24 hours' else interval '14 days' end
  );

comment on column public.invites.kind is
  'invite: an unclaimed person sets up their login (14 days). reset: a claimed person sets a new password (24 hours).';

create or replace function app.invites_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target record;
begin
  -- A future created_at would stretch invites_lifetime: refused for everyone.
  if new.created_at > now() then
    raise exception 'An invite cannot be created in the future' using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    select p.is_system, p.is_claimed, p.colour into target
    from public.profiles p where p.id = new.profile_id;
    if target.is_system then
      raise exception 'System profiles cannot be invited' using errcode = '23514';
    end if;
    if new.kind = 'reset' then
      if not target.is_claimed then
        raise exception 'Reset links are only for people who have a login' using errcode = '23514';
      end if;
      return new;
    end if;
    if target.is_claimed then
      raise exception 'This profile has already been claimed' using errcode = '23514';
    end if;
    if target.colour is null then
      raise exception 'Set the person''s colour before creating an invite' using errcode = '23514';
    end if;
    return new;
  end if;

  -- UPDATE from a browser (admin): only revoking is allowed.
  if not app.is_privileged() then
    if new.id <> old.id
      or new.token_hash <> old.token_hash
      or new.profile_id <> old.profile_id
      or new.kind <> old.kind
      or new.created_by is distinct from old.created_by
      or new.created_at <> old.created_at
      or new.expires_at <> old.expires_at
      or new.used_at is distinct from old.used_at
      or (old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at)
      or new.revoked_at is null then
      raise exception 'Invites can only be revoked here'
        using errcode = '42501';
    end if;
    -- The revocation time is the server's, not the browser's.
    new.revoked_at := now();
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- invite-create / admin-reset-link: revoke the profile's open link (expired
-- or not) and issue a new one, in one transaction. The profile row lock makes
-- two clicks queue up instead of clashing on the one-open-link index. The
-- functions check that the caller is an admin before calling this.
-- ---------------------------------------------------------------------------

create function public.invite_issue(p_profile_id uuid, p_kind text, p_token_hash bytea, p_created_by uuid)
returns timestamptz
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  expires timestamptz;
begin
  perform 1 from public.profiles where id = p_profile_id for update;
  if not found then
    raise exception 'No such person' using errcode = '23503';
  end if;
  update public.invites set revoked_at = now()
  where profile_id = p_profile_id and used_at is null and revoked_at is null;
  insert into public.invites (token_hash, profile_id, created_by, kind, expires_at)
  values (p_token_hash, p_profile_id, p_created_by, p_kind,
          now() + case p_kind when 'reset' then interval '24 hours' else interval '14 days' end)
  returning expires_at into expires;
  return expires;
end;
$$;

-- ---------------------------------------------------------------------------
-- invite-preview / invite-claim / reset-claim: the person behind an open
-- link (not used, not revoked, not expired; an invite's profile still
-- unclaimed, a reset's still claimed). No row for anything else.
-- `watched` leaves out the easter egg and future screenings (decisions P3, P4).
-- ---------------------------------------------------------------------------

create function public.invite_peek(p_token_hash bytea, p_kind text)
returns table (display_name text, colour text, watched integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select p.display_name, p.colour::text,
    (select count(*)::integer
     from public.attendance a join public.films f on f.id = a.film_id
     where a.profile_id = p.id and not f.is_easter_egg
       and f.screened_on <= (now() at time zone 'Europe/Lisbon')::date)
  from public.invites i
  join public.profiles p on p.id = i.profile_id
  where i.token_hash = p_token_hash
    and i.kind = p_kind
    and i.used_at is null and i.revoked_at is null and i.expires_at > now()
    and not p.is_system
    and p.is_claimed = (p_kind = 'reset');
$$;

-- Marks an open link used; for an invite, also links the profile to the new
-- login. All or nothing: the row locks mean two claims of one link can't both
-- win (the second finds it used and gets no row). Locks the profile before the
-- invite, in the same order as invite_issue, so the two never deadlock.
-- Returns the link's id and the profile's login, or no row when the link
-- isn't open; raises 23514 when the person can no longer take it.
create function public.invite_redeem(p_token_hash bytea, p_kind text, p_auth_user_id uuid default null)
returns table (invite_id uuid, auth_user_id uuid)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  link record;
  login uuid;
begin
  perform 1 from public.profiles p
  where p.id = (select i.profile_id from public.invites i where i.token_hash = p_token_hash)
  for update;

  update public.invites i set used_at = now()
  where i.token_hash = p_token_hash
    and i.kind = p_kind
    and i.used_at is null and i.revoked_at is null and i.expires_at > now()
  returning i.id, i.profile_id into link;
  if not found then
    return;
  end if;

  if p_kind = 'invite' then
    update public.profiles p set auth_user_id = p_auth_user_id, claimed_at = now()
    where p.id = link.profile_id and p.auth_user_id is null and not p.is_system
    returning p.auth_user_id into login;
  else
    select p.auth_user_id into login from public.profiles p where p.id = link.profile_id;
  end if;
  if login is null then
    raise exception 'This link''s person cannot be claimed' using errcode = '23514';
  end if;
  return query select link.id, login;
end;
$$;

-- Rate limit for the public link endpoints (plan 7.5): only FAILED attempts
-- (bad links, refused claims) count, so a person reloading their invite never
-- locks themselves out. 10 failures an hour per IP, and 100 an hour from
-- everyone together (subject '*'), so a spoofed IP header can't buy unlimited
-- guesses. Per-IP subjects are 'ip:<address>', clipped to 64 characters.
-- An open link skips those caps (audit S3) and has its own instead: 10 failed
-- claims an hour per token ('token:<hash>'), which only its holder can fill.
-- invite_rate_ok asks (with p_token: for that open link); invite_rate_fail
-- records one failure.

create function public.invite_rate_ok(p_ip text, p_token text default null)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select case when p_token is null then
      coalesce(sum(r.count) filter (where r.subject = left('ip:' || p_ip, 64)), 0) < 10
      and coalesce(sum(r.count) filter (where r.subject = '*'), 0) < 100
    else coalesce(sum(r.count) filter (where r.subject = left('token:' || p_token, 64)), 0) < 10
    end
  from public.rate_limits r
  where r.bucket = 'invite-link' and r.window_start = date_trunc('hour', now());
$$;

create function public.invite_rate_fail(p_ip text, p_token text default null)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  win timestamptz := date_trunc('hour', now());
begin
  -- Old windows are never read again (every subject, so the table stays small).
  delete from public.rate_limits where bucket = 'invite-link' and window_start < win;

  insert into public.rate_limits as r (bucket, subject, window_start, count)
  select 'invite-link', subject, win, 1
  from unnest(array[left('ip:' || p_ip, 64), '*', left('token:' || p_token, 64)]) subject
  where subject is not null
  on conflict (bucket, subject, window_start) do update set count = r.count + 1;
end;
$$;

revoke execute on function public.invite_issue(uuid, text, bytea, uuid) from public, anon, authenticated;
revoke execute on function public.invite_peek(bytea, text) from public, anon, authenticated;
revoke execute on function public.invite_redeem(bytea, text, uuid) from public, anon, authenticated;
revoke execute on function public.invite_rate_ok(text, text) from public, anon, authenticated;
revoke execute on function public.invite_rate_fail(text, text) from public, anon, authenticated;
grant execute on function public.invite_issue(uuid, text, bytea, uuid) to service_role;
grant execute on function public.invite_peek(bytea, text) to service_role;
grant execute on function public.invite_redeem(bytea, text, uuid) to service_role;
grant execute on function public.invite_rate_ok(text, text) to service_role;
grant execute on function public.invite_rate_fail(text, text) to service_role;
