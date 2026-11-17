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

| Command             | What it does                        |
| ------------------- | ----------------------------------- |
| `npm run dev`       | Start the dev server                |
| `npm run lint`      | ESLint                              |
| `npm run typecheck` | TypeScript type check               |
| `npm test`          | Unit tests (Vitest)                 |
| `npm run build`     | Production build into `dist/`       |
| `npm run e2e`       | End-to-end smoke tests (Playwright) |

For end-to-end tests, install the browser once with
`npx playwright install --with-deps chromium` (the `--with-deps` part needs sudo
on Linux/WSL).

Supabase configuration lives in `supabase/` (`npx supabase ...`; the CLI is a dev
dependency).

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
