-- Comments (plan 4.2, 5; decisions 16 + N3): anyone but viewers can post;
-- authors edit and delete their own; only the admin edits/deletes any.
-- Moderators have no extra comment rights.

create table public.comments (
  id bigint generated always as identity primary key,
  film_id bigint not null references public.films (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete restrict,
  body text not null
    constraint comments_body_length check (char_length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  is_legacy boolean not null default false
);

comment on table public.comments is 'Film comments. Legacy rows are sheet notes, authored by the "Sheet archive" profile.';

create index comments_film_id_created_at_idx on public.comments (film_id, created_at);
create index comments_author_id_idx on public.comments (author_id);

-- SECURITY INVOKER on purpose (app.is_privileged()).
create function app.comments_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if app.is_privileged() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.is_legacy then
      raise exception 'Legacy comments are created by the import only'
        using errcode = '42501';
    end if;
    new.created_at := now();
    new.edited_at := null;
    return new;
  end if;

  if new.film_id <> old.film_id
    or new.author_id <> old.author_id
    or new.created_at <> old.created_at
    or new.is_legacy <> old.is_legacy then
    raise exception 'Only the comment text can be edited'
      using errcode = '42501';
  end if;
  if new.body is distinct from old.body then
    new.edited_at := now();
  else
    new.edited_at := old.edited_at;
  end if;
  return new;
end;
$$;

create trigger comments_guard
  before insert or update on public.comments
  for each row execute function app.comments_guard();

alter table public.comments enable row level security;

create policy comments_select_members on public.comments
  for select to authenticated
  using ((select app.current_role()) is not null);

create policy comments_insert_own on public.comments
  for insert to authenticated
  with check (author_id = (select app.current_profile_id()) and (select app.can_write()));

create policy comments_update_own on public.comments
  for update to authenticated
  using (author_id = (select app.current_profile_id()) and (select app.can_write()))
  with check (author_id = (select app.current_profile_id()) and (select app.can_write()));

create policy comments_update_admin on public.comments
  for update to authenticated
  using ((select app.is_admin()))
  with check ((select app.is_admin()));

create policy comments_delete_own on public.comments
  for delete to authenticated
  using (author_id = (select app.current_profile_id()) and (select app.can_write()));

create policy comments_delete_admin on public.comments
  for delete to authenticated
  using ((select app.is_admin()));

revoke all on public.comments from anon, authenticated;
grant select, insert, update, delete on public.comments to authenticated;

revoke execute on all functions in schema app from public;
grant execute on all functions in schema app to authenticated, service_role;
