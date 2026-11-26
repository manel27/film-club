-- Phase 16b: why a Democrático was chosen. Additive only: one nullable column.
--
-- films.democratico_reason: an optional one-line reason, written by staff
-- through film-save (which strips invisible characters, turns whitespace and
-- control characters into single spaces and trims). Null for every other kind
-- and for imported films ("Unknown reason"). Grants and RLS are the table's:
-- everyone logged in reads it, staff write it. export_data() selects every
-- films column, so the export and its 'columns' list include it without a change.

alter table public.films
  add column democratico_reason text,
  -- Also holds for staff writing the table directly, not only through film-save:
  add constraint films_democratico_reason check (
    democratico_reason is null
    or (kind = 'democratico'
      and char_length(democratico_reason) <= 200
      -- No control characters (film-save makes them spaces; U+0000 can't be stored).
      and democratico_reason !~ '[\u0001-\u001f\u007f-\u009f]'
      -- Trimmed: no Unicode whitespace at either end.
      and democratico_reason !~ '^[[:space:]\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]'
      and democratico_reason !~ '[[:space:]\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]$'
      -- Something visible: not only whitespace and invisible format characters
      -- (the set profiles_display_name_visible refuses; ZWJ/ZWNJ and tags are kept
      -- inside emoji and words, but alone they show nothing).
      and democratico_reason ~ '[^[:space:]\u00a0\u1680\u2000-\u200f\u2028-\u202f\u205f-\u2064\u2066-\u206f\u3000\u00ad\u061c\u180e\ufeff\U000e0000-\U000e007f]')
  );

comment on column public.films.democratico_reason is
  'Why the group voted for this Democrático (1-200 characters); null for other kinds or when unknown.';
