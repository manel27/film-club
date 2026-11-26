-- Phase 16b: why a Democrático was chosen. Additive only: one nullable column.
--
-- films.democratico_reason: an optional one-line reason, written by staff
-- through film-save (which strips invisible characters, collapses whitespace
-- and trims). Null for every other kind and for imported films ("Unknown
-- reason"). Grants and RLS are the table's: everyone logged in reads it, staff
-- write it. export_data() selects every films column, so the export and its
-- 'columns' list include it without a change.

alter table public.films
  add column democratico_reason text,
  -- At most 200 characters, with at least one that isn't whitespace or an
  -- invisible format character (soft hyphen, zero-width spaces and joiners,
  -- BOM), so staff writing the table directly can't store a blank reason either.
  add constraint films_democratico_reason check (
    democratico_reason is null
    or (kind = 'democratico'
      and char_length(democratico_reason) <= 200
      and democratico_reason ~ '[^[:space:]­​-‏⁠-⁤﻿]')
  );

comment on column public.films.democratico_reason is
  'Why the group voted for this Democrático (1-200 characters); null for other kinds or when unknown.';
