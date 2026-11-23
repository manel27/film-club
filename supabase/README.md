# Database (Supabase)

Everything here runs against a **local** Supabase stack in Docker. Nothing in
this folder touches the hosted project; production gets the migrations later,
after review and approval.

> [!CAUTION]
> **Edge Functions must write with the caller's JWT, never the secret key.**
> Create the Supabase client inside the function with the user's
> `Authorization` header, so RLS and the guard triggers see the real caller.
> The secret key bypasses RLS and counts as "privileged" in the triggers
> (import-only columns, scores above 10 on an unlocked easter egg). The only
> code allowed to use it is the one-off **import** and **invite-claim** /
> **invite-create** / **admin-reset-link** (which must re-check the caller's
> role themselves), and each of those is reviewed explicitly.

> [!WARNING]
> **Never run `supabase db push --include-seed` (or any seed) against
> production.** `seed.sql` and `test_helpers.sql` are local-only: they create
> synthetic logins with a known password and a `tests` schema.

> [!NOTE]
> The hosted project must run **Postgres 17** (as `config.toml`
> `db.major_version = 17`). The migrations revoke the `MAINTAIN` privilege,
> which only exists from Postgres 17.

| Path                | What it is                                                               |
| ------------------- | ------------------------------------------------------------------------ |
| `migrations/`       | Schema, triggers, RLS policies, views. Applied in filename order.         |
| `seed.sql`          | **Synthetic** local data (invented people and films). Never real data.    |
| `test_helpers.sql`  | pgTAP helpers (`tests` schema). Loaded after the seed, local stack only.  |
| `tests/*.test.sql`  | pgTAP tests, one file per area of the permission matrix.                 |
| `config.toml`       | Local stack configuration.                                               |

## Run

Requirements: Docker, plus `npm ci` (the Supabase CLI is a dev dependency).

```bash
npm run db:start   # start the local stack; applies migrations + seed on first start
npm run db:stop    # stop it (data is kept for the next start)
```

`db:start` prints local URLs and keys. They are throwaway demo values for your
machine only; still, don't paste them anywhere.

Seed logins (password `film-club-local` for all): `orla@example.test` (admin),
`tamsin@example.test` (moderator), `kwame@example.test` and
`yusuf@example.test` (members), `petra@example.test` (viewer). Viggo and Wren are
unclaimed placeholders.

## Test

```bash
npm run db:test    # pgTAP: supabase test db
```

Each test file runs in a transaction and rolls back, so tests don't change the
database. They rely on the fixed seed ids, so reset first if you've been
editing data by hand.

To lint the plpgsql functions: `npx supabase db lint -s public,app --level warning`.

## Reset

```bash
npm run db:reset   # drop the local database, re-apply all migrations, re-seed
```

## Change the schema

1. Add a new file `migrations/<UTC timestamp>_<what>.sql` (never edit a
   migration that has reached production).
2. `npm run db:reset`, then `npm run db:test`.
3. Regenerate the TypeScript types: `npm run db:types` (writes
   `src/lib/database.types.ts`; CI fails if it is stale).
4. Add pgTAP tests for any new table or policy: one assertion per role
   (admin, moderator, member, viewer, not logged in), allowed and denied.

## Edge Functions

`functions/` holds the film functions (plan 2.2). Each one verifies the
caller's JWT, re-reads their role from the database (`my_profile()`) and writes
with the caller's JWT, so RLS and the triggers apply. None uses the secret key.
The invite and reset link functions (plan 7, `_shared/links.ts`) are the
exception: they use the secret key through service-role-only RPCs
(`invite_issue`, `invite_peek`, `invite_redeem`, `invite_rate_hit`).

| Function           | Who                           | What                                                                 |
| ------------------ | ----------------------------- | -------------------------------------------------------------------- |
| `tmdb-search`      | logged-in, not viewers        | TMDB search (60 a minute per person, `tmdb_search_hit()`); marks films already watched |
| `film-save`        | moderators, admins            | adds or edits a film, from TMDB or without it (title + year)          |
| `film-relink-tmdb` | moderators, admins            | links a film to a TMDB id (or refreshes it) and replaces its details  |
| `invite-create`    | admins                        | a new invite link (14 days) for an unclaimed person; revokes their open one |
| `admin-reset-link` | admins                        | a new password reset link (24 hours) for a person with a login        |
| `invite-preview`   | public (the link's token)     | name, colour and films watched of an open invite                      |
| `invite-claim`     | public (the link's token)     | creates the login (email + password) and links it to the person       |
| `reset-claim`      | public (the link's token)     | sets the new password; returns the email so the page can sign in      |

Links are single use and revocable (admins revoke them from the browser: RLS
allows only that). Only the token's SHA-256 hash is stored. The public ones
count only failed attempts (10 an hour per IP, 100 an hour from everyone),
and say the same thing for every bad link. Setting a password from a reset
link ends the person's sessions on every device (decision I3).
A link's origin is the admin page's own (the site, or localhost locally), so
no configuration is needed.

**Orphaned login.** If `invite-claim` dies between creating the login and
linking it, the invite stays open and the email is taken by a login with no
profile: delete that user in the dashboard (Authentication → Users) and the
invitee can claim again.

**Local secrets.** `supabase start` reads `functions/.env` (git-ignored). Copy
`functions/.env.example` and fill in:

```bash
TMDB_TOKEN=<your TMDB API Read Access Token>   # never commit it, never paste it anywhere
TMDB_BASE_URL=                                   # empty = api.themoviedb.org
```

For the e2e tests use a placeholder token and
`TMDB_BASE_URL=http://host.docker.internal:54399` (the fake TMDB the e2e setup
starts; the setup refuses to run otherwise), then restart the stack.

**Tests.** `npm run functions:test` runs the handlers in-process against the
local stack with TMDB replaced by a stub (Deno 2 needed; `npm run
functions:check` checks format and types).

**Production** (not done by any agent): `supabase secrets set TMDB_TOKEN=…`,
then `supabase functions deploy tmdb-search film-save film-relink-tmdb invite-create
admin-reset-link invite-preview invite-claim reset-claim`.
`config.toml` turns the gateway's legacy JWT check off for them
(`verify_jwt = false`) because they verify the JWT themselves.

## Rules baked into the schema

- **RLS on every table, deny by default.** Not-logged-in visitors (`anon`) have
  no grants at all. Logged-in users without a profile see nothing.
- Role helpers live in the private `app` schema (not exposed by the API):
  `app.current_profile_id()`, `app.current_role()`, `app.is_staff()`,
  `app.is_admin()`, `app.can_write()`. They return nothing unless the JWT's
  session still exists in `auth.sessions` (security audit S1), so a token of
  a logged-out or reset session gets nothing even before it expires. Tokens
  last 10 minutes (`jwt_expiry = 600`; set the same on the hosted project).
- **No duplicate films**, for everyone including the secret key: unique TMDB id,
  unique normalised title + year for manual films, and a trigger for manual vs
  TMDB cross-matches (titles and original titles).
- **`profiles.auth_user_id` is never visible to browsers** (column grants), so
  `select *` on `profiles` is refused: read people from the
  **`profile_directory`** view (same columns minus `auth_user_id`), or name
  the columns. The logged-in user's own profile comes from the
  **`my_profile()`** RPC (one `profile_directory` row, or none when the login
  isn't linked to a profile). Updates must not use `returning *` (supabase-js: pass explicit
  columns to `.select()`).
- **TRUNCATE** is revoked from browsers and the secret key, and blocked for
  everyone on `films`/`scores` while any film's scores are locked.
- New functions are not executable by anyone until a migration grants them
  (default privileges).
- **Title normalisation** (duplicate rule) is documented step by step, with a
  JavaScript mirror for the UI, above `app.normalize_title()` in
  `migrations/20261117120000_foundation.sql`.
- **Scores** are 0–10 with at most two decimals: a third decimal is refused
  (not rounded). The only exception is the easter-egg
  film's imported scores, which are locked forever once `scores_locked` is set:
  nobody (admin, secret key, postgres) can change, add or delete them, unlock
  the film or delete it.
- Import-only columns (`is_easter_egg`, `scores_locked`, `legacy_sheet_row`,
  `auth_user_id`, `is_system`, legacy comments) can only be written with the
  secret key, never from a browser.
