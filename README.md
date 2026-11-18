# Film Club

A small, private web platform for a weekly film club: films watched, who chose
them, who was there, scores and comments. It replaces a shared spreadsheet.

- Front end: Vite + React + TypeScript, served by GitHub Pages at
  <https://manel27.github.io/film-club/>.
- Back end: Supabase (Postgres with Row Level Security, Auth, Edge Functions).
- Access is invite-only. All club data lives in Supabase behind login and RLS;
  this repository contains code only, no data and no secrets.

## Running locally

Requirements: Node.js 26 (see `.nvmrc`; `nvm use` picks it up) and npm. The minimum
supported version is 22.22 (`engines` in `package.json`).

```bash
npm ci
cp .env.example .env.local   # then fill in the Supabase URL and publishable key
npm run dev                  # http://localhost:5173/film-club/
```

Useful scripts:

| Command             | What it does                   |
| ------------------- | ------------------------------ |
| `npm run dev`       | Start the dev server           |
| `npm run lint`      | ESLint                         |
| `npm run typecheck` | TypeScript type check          |
| `npm test`          | Unit tests (Vitest)            |
| `npm run build`     | Production build into `dist/`  |
| `npm run e2e`       | End-to-end tests (Playwright)  |
| `npm run db:start`  | Start the local Supabase stack |
| `npm run db:test`   | Database tests (pgTAP)         |
| `npm run db:reset`  | Rebuild the local database     |
| `npm run db:types`  | Regenerate `database.types.ts` |

For end-to-end tests, install the browser once with
`npx playwright install --with-deps chromium` (the `--with-deps` part needs sudo
on Linux/WSL). They run against the **local** Supabase stack, so start it first
(`npm run db:start`). Playwright reads the stack's URL and throwaway dev keys
from `supabase status`, builds the app into `dist-e2e/` pointed at it, creates
synthetic test logins (`*@example.test`) and removes them afterwards. It refuses
to run against anything that isn't on your machine.

Supabase configuration, migrations and database tests live in `supabase/`
(`npx supabase ...`; the CLI is a dev dependency). See `supabase/README.md`.

## Logging in

Login is email + password. There is no sign-up: accounts come from invites (a
later phase) or, for the first admin, from the bootstrap script below. Every
page except `#/login` needs a session; a login that isn't linked to a club
profile sees "Your account isn't linked yet".

## Admin bootstrap

`scripts/create-admin.mjs` creates Manel's login and makes it the admin. It
creates (or finds) the auth user with the email already confirmed, then links
it to the existing **Manel** placeholder profile (from the history import) and
sets the role to admin. If there is no Manel profile yet, it creates one.

1. Put the project URL and **secret** key in an env file that git ignores, for
   example `admin.env.local` (any `*.local` file is ignored) or a file outside
   the repository:

   ```ini
   SUPABASE_URL=http://127.0.0.1:54321      # local: "API URL" from `npx supabase status`
   SUPABASE_SECRET_KEY=...                   # local: "Secret key" from `npx supabase status`
   ```

   The script refuses an env file inside the repository that git would
   commit, and never prints the key.

2. Run it and type the password at the hidden prompt (twice):

   ```bash
   node scripts/create-admin.mjs --env admin.env.local --email you@example.com
   ```

   Options: `--name` (profile to link, default `Manel`), `--colour '#rrggbb'`
   (only used if the profile has to be created), `--reset-password` (set a new
   password on an existing login). There is no password option on purpose: it
   would end up in your shell history.

Running it again changes nothing. It refuses, without changing anything, if the
profile is already claimed by a different login, if the email is already
linked to another profile, or if the name is a system profile (Cinema, Sheet
archive). If linking fails after it created a new login, it deletes that login
again.

- **Local first.** On the local stack, run `npm run db:reset` afterwards before
  `npm run db:test`: the pgTAP tests expect the seed exactly as it is.
- **Production is an owner gate** (plan phase 4d): only after Manel approves.
  For a non-local URL the script asks you to type the host name to confirm.
  Use the hosted project's secret key from the Supabase dashboard (API keys),
  keep the env file outside the repository and delete it afterwards.

## Secret scanning

Commits are scanned by [gitleaks](https://github.com/gitleaks/gitleaks) both
locally and in CI. Enable the local pre-commit hook once per clone:

```bash
git config core.hooksPath .githooks
```

Only the Supabase project URL and the **publishable** key are used by the
front end; both are public by design. Never commit `.env.local` or any secret
key.

## Deployment

Every push to `main` builds the site and deploys it to GitHub Pages through
GitHub Actions (`.github/workflows/deploy.yml`).
