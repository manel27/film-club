-- S8: source_url must be https; poster/backdrop paths must look like TMDB's (/abc123.jpg).
begin;
select plan(10);

select tests.login_as('moderator');
select lives_ok($$update public.films set source_url = 'https://letterboxd.com/film/x/',
  poster_path = '/kqjL17yufvn9OVLyXYpvtyrFfak.jpg', backdrop_path = '/a-b_c.9.png' where id = 2$$,
  'https URL and TMDB-style paths are accepted');
select lives_ok($$update public.films set source_url = null, poster_path = null, backdrop_path = null
  where id = 2$$, 'nulls are accepted');
select throws_ok($$update public.films set source_url = 'javascript:alert(1)' where id = 2$$,
  '23514', null, 'a javascript: URL is refused');
select throws_ok($$update public.films set source_url = 'http://letterboxd.com/film/x/' where id = 2$$,
  '23514', null, 'a plain http URL is refused');
select throws_ok($$update public.films set source_url = ' https://x.test' where id = 2$$,
  '23514', null, 'a URL with leading space is refused');
select throws_ok($$update public.films set poster_path = 'https://evil.test/x.jpg' where id = 2$$,
  '23514', null, 'a full URL as poster path is refused');
select throws_ok($$update public.films set poster_path = '/a/b.jpg' where id = 2$$,
  '23514', null, 'a nested poster path is refused');
select throws_ok($$update public.films set poster_path = '/x.jpg"onerror=alert(1)' where id = 2$$,
  '23514', null, 'quotes in a poster path are refused');
select throws_ok($$update public.films set backdrop_path = 'x.jpg' where id = 2$$,
  '23514', null, 'a backdrop path without the leading slash is refused');
select throws_ok($$update public.films set backdrop_path = '' where id = 2$$,
  '23514', null, 'an empty backdrop path is refused');
reset role;

select * from finish();
rollback;
