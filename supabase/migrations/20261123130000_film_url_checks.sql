-- SECURITY.md S8: staff could store any text in these columns through the API.
-- Harmless while they're only appended to TMDB image URLs, but an XSS if one
-- were ever rendered as a link. Existing rows are validated: if any row
-- doesn't pass, the migration fails and nothing changes.

alter table public.films
  add constraint films_source_url_https
    check (source_url is null or source_url ~ '^https://'),
  add constraint films_poster_path_tmdb
    check (poster_path is null or poster_path ~ '^/[A-Za-z0-9._-]+$'),
  add constraint films_backdrop_path_tmdb
    check (backdrop_path is null or backdrop_path ~ '^/[A-Za-z0-9._-]+$');
