-- Films (plan 4.1/4.2): movie metadata and its single screening in one row.
-- No-duplicate rule (plan 4.3) and the easter-egg score lock (plan 4.4).

create table public.films (
  id bigint generated always as identity primary key,
  tmdb_id integer
    constraint films_tmdb_id_positive check (tmdb_id > 0),
  title text not null
    constraint films_title_length check (char_length(btrim(title)) between 1 and 300),
  title_norm text generated always as (app.normalize_title(title)) stored,
  original_title text
    constraint films_original_title_length check (char_length(original_title) <= 300),
  original_title_norm text generated always as (app.normalize_title(original_title)) stored,
  release_year integer
    constraint films_release_year_range check (release_year between 1870 and 2100),
  release_date date,
  poster_path text,
  backdrop_path text,
  overview text,
  runtime_min integer
    constraint films_runtime_positive check (runtime_min > 0),
  genres text[] not null default '{}',
  directors text[] not null default '{}',
  tmdb_fetched_at timestamptz,
  source_url text,
  -- Screening fields
  screened_on date not null,
  kind public.film_kind not null default 'normal',
  assigned_id uuid not null references public.profiles (id) on delete restrict,
  turn_holder_id uuid references public.profiles (id) on delete restrict,
  day_order smallint not null default 1
    constraint films_day_order_positive check (day_order >= 1),
  is_easter_egg boolean not null default false,
  scores_locked boolean not null default false,
  legacy_sheet_row integer unique,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint films_turn_holder_only_democratico check (turn_holder_id is null or kind = 'democratico'),
  -- Decision N1: a manual film (no TMDB match) needs a release year.
  constraint films_manual_needs_year check (tmdb_id is not null or release_year is not null),
  constraint films_locked_only_easter_egg check (not scores_locked or is_easter_egg)
);

comment on table public.films is
  'One row per film, including its one and only screening (no film is ever shown twice).';
comment on column public.films.title_norm is
  'Normalised title for the no-duplicate rule: lower case, no accents, no punctuation, single spaces.';
comment on column public.films.turn_holder_id is
  'Democrático only: the person whose turn it was and who missed it (null for historic rows).';
comment on column public.films.scores_locked is
  'Easter-egg film only. Once true it can never be unset, and the film''s scores can never change.';

-- No-duplicate rule, part 1 and 2 (plan 4.3).
create unique index films_tmdb_id_key on public.films (tmdb_id) where tmdb_id is not null;
create unique index films_manual_title_year_key on public.films (title_norm, coalesce(release_year, 0))
  where tmdb_id is null;

create index films_screened_on_idx on public.films (screened_on desc, day_order);
create index films_assigned_id_idx on public.films (assigned_id);
create index films_turn_holder_id_idx on public.films (turn_holder_id) where turn_holder_id is not null;
create index films_genres_idx on public.films using gin (genres);
create index films_title_norm_year_idx on public.films (title_norm, release_year);
create index films_original_title_norm_year_idx on public.films (original_title_norm, release_year)
  where original_title_norm is not null;

create trigger films_set_updated_at
  before update on public.films
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- No-duplicate rule, part 3 (plan 4.3): a manual film and a TMDB film with the
-- same normalised title (or original title) and year are the same film, in
-- either direction. Two different TMDB films that share a title and year are
-- allowed. Applies to every role, including admin and the secret key.
-- SECURITY DEFINER so it sees every film whatever the caller can read.
-- ---------------------------------------------------------------------------

create function app.films_no_duplicate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  clash record;
  -- Generated columns are not computed yet in a BEFORE trigger, so
  -- normalise here instead of reading new.title_norm.
  new_title_norm text := app.normalize_title(new.title);
  new_original_norm text := app.normalize_title(new.original_title);
begin
  -- Serialise inserts/updates per release year so two concurrent saves of the
  -- same film can't both pass the check.
  perform pg_advisory_xact_lock(hashtext('public.films:dup'), coalesce(new.release_year, 0));

  select f.id, f.title, f.screened_on, f.kind
    into clash
  from public.films f
  where f.id is distinct from new.id
    and f.release_year is not distinct from new.release_year
    and not (f.tmdb_id is not null and new.tmdb_id is not null and f.tmdb_id <> new.tmdb_id)
    and (
      f.tmdb_id = new.tmdb_id
      or f.title_norm = new_title_norm
      or f.original_title_norm = new_title_norm
      or f.title_norm = new_original_norm
      or f.original_title_norm = new_original_norm
    )
  limit 1;

  if found then
    raise exception 'Duplicate film: "%" was already watched on % (%)', clash.title, clash.screened_on, clash.kind
      using errcode = '23505',
            detail = format('film_id=%s', clash.id),
            hint = 'No film may be shown twice.';
  end if;

  return new;
end;
$$;

create trigger films_no_duplicate
  before insert or update of tmdb_id, title, original_title, release_year on public.films
  for each row execute function app.films_no_duplicate();

-- ---------------------------------------------------------------------------
-- Guard (plan 4.4 and protected columns):
--   * scores_locked can never go from true to false, for anyone.
--   * a locked film can't be deleted (its scores are locked), for anyone.
--   * is_easter_egg, scores_locked and legacy_sheet_row are import-only
--     (secret key), so staff can't turn an ordinary film into an easter egg
--     and give it scores above 10.
--   * created_by is set to the caller; created_at is immutable.
-- SECURITY INVOKER on purpose (app.is_privileged()).
-- ---------------------------------------------------------------------------

create function app.films_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.scores_locked then
      raise exception 'This film''s scores are locked; the film cannot be deleted'
        using errcode = '42501';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' then
    if old.scores_locked and not new.scores_locked then
      raise exception 'scores_locked cannot be unset'
        using errcode = '42501';
    end if;
    if new.created_at <> old.created_at then
      raise exception 'created_at cannot be changed'
        using errcode = '42501';
    end if;
  end if;

  if not app.is_privileged() then
    if tg_op = 'INSERT' then
      if new.is_easter_egg or new.scores_locked or new.legacy_sheet_row is not null then
        raise exception 'is_easter_egg, scores_locked and legacy_sheet_row are set by the import only'
          using errcode = '42501';
      end if;
      new.created_by := app.current_profile_id();
      new.created_at := now();
    else
      if new.is_easter_egg <> old.is_easter_egg
        or new.scores_locked <> old.scores_locked
        or new.legacy_sheet_row is distinct from old.legacy_sheet_row
        or new.created_by is distinct from old.created_by then
        raise exception 'is_easter_egg, scores_locked, legacy_sheet_row and created_by cannot be changed here'
          using errcode = '42501';
      end if;
    end if;
  end if;

  return new;
end;
$$;

create trigger films_guard
  before insert or update or delete on public.films
  for each row execute function app.films_guard();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.films enable row level security;

create policy films_select_members on public.films
  for select to authenticated
  using ((select app.current_role()) is not null);

create policy films_insert_staff on public.films
  for insert to authenticated
  with check ((select app.is_staff()));

create policy films_update_staff on public.films
  for update to authenticated
  using ((select app.is_staff()))
  with check ((select app.is_staff()));

create policy films_delete_staff on public.films
  for delete to authenticated
  using ((select app.is_staff()));

revoke all on public.films from anon, authenticated;
grant select, insert, update, delete on public.films to authenticated;

revoke execute on all functions in schema app from public;
grant execute on all functions in schema app to authenticated, service_role;
