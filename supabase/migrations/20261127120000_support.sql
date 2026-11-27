-- Phase 16c: Support and suggestion box (decisions F2, US9-US12). Additive
-- only: two new tables, one helper, two guards; export_data() redefined.
--
-- * Everyone logged in writes suggestions, viewers too: an explicit exception
--   to decision 15, so the policies use app.current_profile_id(), never
--   app.can_write().
-- * A suggestion and its replies are seen only by its author, the moderators
--   and the admin. Anon has no grant at all.
-- * Staff reply to any suggestion; the author replies in their own thread.
-- * The author deletes their own suggestion only while nobody else (that is,
--   staff) has replied; the admin deletes any. Replies go with it (cascade).
--   Nobody edits a suggestion or a reply (no update grant).

-- One line of visible text, as the browser's normaliser leaves it: the same
-- rules as films_democratico_reason (migration 20261126120000), with a length.
create function app.is_tidy_text(value text, max_length integer)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select char_length(value) <= max_length
    -- No control characters (the browser makes them spaces; U+0000 can't be stored).
    and value !~ '[\u0001-\u001f\u007f-\u009f]'
    -- Trimmed: no Unicode whitespace at either end.
    and value !~ '^[[:space:]\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]'
    and value !~ '[[:space:]\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]$'
    -- Something visible: not only whitespace and invisible format characters.
    and value ~ '[^[:space:]\u00a0\u1680\u2000-\u200f\u2028-\u202f\u205f-\u2064\u2066-\u206f\u3000\u00ad\u061c\u180e\ufeff\U000e0000-\U000e007f]';
$$;

create table public.suggestions (
  id bigint generated always as identity primary key,
  -- The writer, always: the default fills it in and the insert policy refuses anyone else.
  author_id uuid not null default app.current_profile_id()
    references public.profiles (id) on delete restrict,
  title text not null constraint suggestions_title check (app.is_tidy_text(title, 100)),
  body text not null constraint suggestions_body check (app.is_tidy_text(body, 2000)),
  created_at timestamptz not null default now()
);

comment on table public.suggestions is
  'Support page suggestions. Seen only by their author, the moderators and the admin.';

create table public.suggestion_replies (
  id bigint generated always as identity primary key,
  suggestion_id bigint not null references public.suggestions (id) on delete cascade,
  author_id uuid not null default app.current_profile_id()
    references public.profiles (id) on delete restrict,
  body text not null constraint suggestion_replies_body check (app.is_tidy_text(body, 2000)),
  created_at timestamptz not null default now()
);

comment on table public.suggestion_replies is
  'Replies to a suggestion, by staff or its author. Seen by whoever sees the suggestion.';

create index suggestions_created_at_idx on public.suggestions (created_at);
create index suggestions_author_id_created_at_idx on public.suggestions (author_id, created_at);
create index suggestion_replies_suggestion_id_created_at_idx
  on public.suggestion_replies (suggestion_id, created_at);
create index suggestion_replies_author_id_idx on public.suggestion_replies (author_id);

-- Both tables: system profiles never write (they have no login, but the import
-- and the secret key could still try), and browsers can't backdate.
-- SECURITY INVOKER on purpose (app.is_privileged()).
create function app.support_insert_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.profiles p where p.id = new.author_id and p.is_system) then
    raise exception 'System profiles cannot write suggestions or replies' using errcode = '42501';
  end if;
  if not app.is_privileged() then
    new.created_at := now();
  end if;
  return new;
end;
$$;

create trigger suggestions_insert_guard
  before insert on public.suggestions
  for each row execute function app.support_insert_guard();

create trigger suggestion_replies_insert_guard
  before insert on public.suggestion_replies
  for each row execute function app.support_insert_guard();

-- The author can't delete once staff have replied. A BEFORE ROW DELETE trigger
-- runs after Postgres has locked the row, and that lock waits for any reply
-- still being inserted (its foreign key check holds FOR KEY SHARE on the
-- suggestion). This statement then reads with a fresh snapshot, so a reply
-- committed meanwhile is seen and the delete refused. The other way round, a
-- reply arriving after the delete took the lock fails its foreign key check:
-- no orphan, and no delete after a reply.
-- SECURITY INVOKER on purpose (app.is_privileged()); the author can read the replies.
create function app.suggestions_delete_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if app.is_privileged() or app.is_admin() then
    return old;
  end if;
  if exists (select 1 from public.suggestion_replies r
      where r.suggestion_id = old.id and r.author_id <> old.author_id) then
    raise exception 'This suggestion has a reply, so it can no longer be deleted'
      using errcode = '42501';
  end if;
  return old;
end;
$$;

create trigger suggestions_delete_guard
  before delete on public.suggestions
  for each row execute function app.suggestions_delete_guard();

alter table public.suggestions enable row level security;
alter table public.suggestion_replies enable row level security;

create policy suggestions_select_own_or_staff on public.suggestions
  for select to authenticated
  using (author_id = (select app.current_profile_id()) or (select app.is_staff()));

-- Viewers too (not app.can_write()).
create policy suggestions_insert_own on public.suggestions
  for insert to authenticated
  with check (author_id = (select app.current_profile_id()));

create policy suggestions_delete_own on public.suggestions
  for delete to authenticated
  using (author_id = (select app.current_profile_id()));

create policy suggestions_delete_admin on public.suggestions
  for delete to authenticated
  using ((select app.is_admin()));

create policy suggestion_replies_select_own_or_staff on public.suggestion_replies
  for select to authenticated
  using ((select app.is_staff()) or exists (
    select 1 from public.suggestions s
    where s.id = suggestion_id and s.author_id = (select app.current_profile_id())));

create policy suggestion_replies_insert_own_or_staff on public.suggestion_replies
  for insert to authenticated
  with check (author_id = (select app.current_profile_id()) and ((select app.is_staff()) or exists (
    select 1 from public.suggestions s
    where s.id = suggestion_id and s.author_id = (select app.current_profile_id()))));

revoke all on public.suggestions, public.suggestion_replies from anon, authenticated;
grant select, insert, delete on public.suggestions to authenticated;
grant select, insert on public.suggestion_replies to authenticated;

revoke execute on all functions in schema app from public;
grant execute on all functions in schema app to authenticated, service_role;

-- Same as migration 20261124180000, plus suggestions and suggestion_replies.
create or replace function public.export_data()
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  tables json;
  version text;
begin
  if not app.is_admin() then
    raise exception 'Only the admin can export the data' using errcode = '42501';
  end if;
  tables := json_build_object(
    'profiles', (select coalesce(json_agg(t order by t.created_at, t.id), '[]') from (
      select id, display_name, sheet_keyword, colour, role, is_claimed, claimed_at, is_system,
             created_at, updated_at, login_removed_at
      from public.profiles) t),
    'films', (select coalesce(json_agg(t order by t.id), '[]') from public.films t),
    'attendance', (select coalesce(json_agg(t order by t.film_id, t.profile_id), '[]') from public.attendance t),
    'scores', (select coalesce(json_agg(t order by t.film_id, t.profile_id), '[]') from public.scores t),
    'comments', (select coalesce(json_agg(t order by t.id), '[]') from public.comments t),
    'rotation_adjustments', (select coalesce(json_agg(t order by t.effective_at, t.id), '[]') from public.rotation_adjustments t),
    'rotation_passes', (select coalesce(json_agg(t order by t.week_start, t.profile_id), '[]') from public.rotation_passes t),
    'rotation_next', (select coalesce(json_agg(t order by t.week_start), '[]') from public.rotation_next t),
    'app_settings', (select coalesce(json_agg(t order by t.key), '[]') from public.app_settings t),
    'user_settings', (select coalesce(json_agg(t order by t.profile_id), '[]') from public.user_settings t),
    'suggestions', (select coalesce(json_agg(t order by t.id), '[]') from public.suggestions t),
    'suggestion_replies', (select coalesce(json_agg(t order by t.id), '[]') from public.suggestion_replies t)
  );
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    execute 'select max(version) from supabase_migrations.schema_migrations' into version;
  end if;
  return json_build_object(
    'format', 'film-club-export',
    'exported_at', now(),
    'schema_version', version,
    'row_counts', (select json_object_agg(k, json_array_length(v)) from json_each(tables) e (k, v)),
    -- Each table's columns in row order (attnum, as json_agg writes them);
    -- profiles is the select above, not the whole table (no auth_user_id).
    'columns', (select json_object_agg(k, case when k = 'profiles'
        then json_build_array('id', 'display_name', 'sheet_keyword', 'colour', 'role', 'is_claimed',
          'claimed_at', 'is_system', 'created_at', 'updated_at', 'login_removed_at')
        else (select json_agg(a.attname order by a.attnum) from pg_catalog.pg_attribute a
          where a.attrelid = format('public.%I', k)::regclass and a.attnum > 0 and not a.attisdropped)
        end) from json_object_keys(tables) k),
    'tables', tables
  );
end;
$$;
