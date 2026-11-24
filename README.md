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
supported version is 22.22 (`engines` in `package.json`). If `nvm` can't be
loaded in your shell, put its Node on `PATH` directly instead:
`export PATH="$HOME/.nvm/versions/node/v26.13.1/bin:$PATH"` (use the version you installed).

```bash
npm ci
cp .env.example .env.local   # then fill in the Supabase URL and publishable key
npm run dev                  # http://localhost:5173/film-club/
```

Useful scripts:

| Command                 | What it does                            |
| ----------------------- | --------------------------------------- |
| `npm run dev`           | Start the dev server                    |
| `npm run lint`          | ESLint                                  |
| `npm run typecheck`     | TypeScript type check                   |
| `npm test`              | Unit tests (Vitest)                     |
| `npm run build`         | Production build into `dist/`           |
| `npm run e2e`           | End-to-end tests (Playwright)           |
| `npm run db:start`      | Start the local Supabase stack          |
| `npm run db:test`       | Database tests (pgTAP)                  |
| `npm run db:reset`      | Rebuild the local database              |
| `npm run db:types`      | Regenerate `database.types.ts`          |
| `npm run functions:env` | Write `supabase/functions/.env` for e2e |

For end-to-end tests, install the browser once with
`npx playwright install --with-deps chromium` (the `--with-deps` part needs sudo
on Linux/WSL). They run against the **local** Supabase stack: first run
`npm run functions:env` (writes the git-ignored `supabase/functions/.env` that
points the Edge Functions at the e2e fake TMDB, with a placeholder token; CI runs
the same script), then start the stack (`npm run db:start`). Playwright reads the stack's URL and throwaway dev keys
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
sets the role to admin. If there is no Manel profile yet (the import hasn't
run), pass `--create-profile` and it creates one; without that flag it stops.

1. Put the project URL and **secret** key in an env file that git ignores, for
   example `admin.env.local` (any `*.local` file is ignored) or a file outside
   the repository:

   ```ini
   SUPABASE_URL=http://127.0.0.1:54321      # local: "API URL" from `npx supabase status`
   SUPABASE_SECRET_KEY=...                   # local: "Secret key" from `npx supabase status`
   ```

   The script never prints the key. It resolves symlinks and refuses an env
   file inside any git working tree (including a worktree) unless git confirms
   that the file is ignored there; if git can't check, it refuses. Plain
   `http://` is only accepted for a local stack.

2. Run it and type the password at the hidden prompt (twice):

   ```bash
   node scripts/create-admin.mjs --env admin.env.local --email you@example.com
   ```

   Options: `--name` (profile to link, default `Manel`; matched exactly,
   ignoring case and surrounding spaces, no wildcards), `--create-profile`
   (create the profile if there is none with that name), `--colour '#rrggbb'`
   (only with `--create-profile`), `--reset-password` (set a new password on an
   existing login). There is no password option on purpose: it would end up in
   your shell history. It must run in an interactive terminal (piped input is
   refused).

Running it again changes nothing. It refuses, without changing anything, if the
profile is already claimed by a different login, if the email is already
linked to another profile, or if the name is a system profile (Cinema, Sheet
archive), or if more than one profile has that name. If linking fails after it
created a new login, it deletes that login again (and tells you to delete it by
hand in the dashboard if even that fails).

- **Local first.** On the local stack, run `npm run db:reset` afterwards before
  `npm run db:test`: the pgTAP tests expect the seed exactly as it is.
- **Production is an owner gate** (plan phase 4d): only after Manel approves.
  For a non-local URL the script asks you to type the host name to confirm.
  Use the hosted project's secret key from the Supabase dashboard (API keys),
  keep the env file outside the repository and delete it afterwards.

## Running the club (admin guide)

Everything below is on the **Admin** page (only admins see it) unless it says
otherwise.

- **Invite someone.** Add them with **Add person** (name, colour, role), or
  find them in the list if they are already there from the history. Press
  **Create invite**, then **Copy link** and send it to them privately: it is
  shown only once. They open it, choose an email and password, and are in. A
  person needs a colour before they can be invited.
- **Reset a password.** For someone who already has a login, press **Create
  reset link** and send it the same way. They choose a new password; the old
  one and their open sessions stop working. **Revoke** kills a link you sent
  by mistake; **Regenerate** replaces it.
- **Remove a login.** **Remove login** deletes their email and password, so
  they can't log in any more. Everything else stays: their name, colour,
  films, attendance, scores and comments. You can invite them again later.
- **Change roles and colours.** **Edit** next to a person. You can't change
  your own role, and the club always keeps at least one admin.
- **Export the data every month.** **Export all data** downloads one zip (a
  complete JSON file plus a CSV per table, no emails or passwords). Keep it
  somewhere private and safe, such as your own cloud drive, and keep the old
  ones. It is a record to rebuild from, not a backup button: there is no
  one-click restore from it. If there has been no export for 30 days, admins
  see a reminder at the top of every page until they export again.

### Keeping the database awake

The free Supabase plan pauses a project after a period of inactivity (roughly
a week). The **Keep-alive** workflow (`.github/workflows/keepalive.yml`) makes
one harmless read every 3 days so that doesn't happen.

- **See it:** the repository's **Actions** tab → **Keep-alive**.
- **Run it by hand:** Actions → Keep-alive → **Run workflow**.
- **A failure email from GitHub** means the ping didn't get through (Supabase
  down, project paused, or the URL or key changed). Run it by hand once; if it
  fails again, check the project in the Supabase dashboard.
- **If Supabase pauses the project anyway:** open the Supabase dashboard,
  choose the project and press **Restore**. It takes a few minutes and the
  data is intact. This one-click restore only works for a limited time (the
  dashboard shows how many days are left); after that you can only download a
  backup file and restore it into a new project. Another reason for the
  monthly export.
- **Important:** in a public repository, GitHub automatically switches off
  scheduled workflows when there has been no repository activity for 60 days.
  The keep-alive's own runs probably don't count as activity. Pushing a commit
  before day 60 resets that clock, but once the workflow is switched off a
  commit does **not** switch it back on: go to Actions → Keep-alive and press
  **Enable workflow**. If the repository is quiet, set yourself a reminder
  every 6 weeks or so to check the Actions tab (or push a small change).

### Deploying

Merging to `main` deploys the site to GitHub Pages automatically. Database
changes (`supabase/migrations/`) and Edge Functions are **not** deployed
automatically: they are pushed by hand, and only with the owner's OK.

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
