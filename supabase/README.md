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

## Rules baked into the schema

- **RLS on every table, deny by default.** Not-logged-in visitors (`anon`) have
  no grants at all. Logged-in users without a profile see nothing.
- Role helpers live in the private `app` schema (not exposed by the API):
  `app.current_profile_id()`, `app.current_role()`, `app.is_staff()`,
  `app.is_admin()`, `app.can_write()`.
- **No duplicate films**, for everyone including the secret key: unique TMDB id,
  unique normalised title + year for manual films, and a trigger for manual vs
  TMDB cross-matches (titles and original titles).
- **`profiles.auth_user_id` is never visible to browsers** (column grants), so
  `select *` on `profiles` is refused: read people from the
  **`profile_directory`** view (same columns minus `auth_user_id`), or name
  the columns. Updates must not use `returning *` (supabase-js: pass explicit
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
