import { defineConfig, devices } from '@playwright/test'
import { localSupabase } from './e2e/localSupabase'

// Not Vite's default preview port, so a stray `vite preview` of some other
// build is never mistaken for this one.
const PORT = 4317

// End-to-end tests run against the LOCAL Supabase stack (`npm run db:start`)
// and a production build of the app pointed at it, served by `vite preview`
// under the GitHub Pages base path. The build goes to dist-e2e/ so it never
// mixes with the real build in dist/. global-setup.ts seeds synthetic logins
// with the local stack's dev secret key; global-teardown.ts removes them.
const supabase = localSupabase()

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  use: {
    baseURL: `http://localhost:${PORT}/film-club/`,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: /(add|delete)-film|rotation|profiles|invites|stats|admin-people/,
    },
    // Add and delete films (stats adds a past screening), write rotation data, rename and add people, which other tests count or show: run after them.
    {
      name: 'chromium-writes',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /(add|delete)-film|rotation|profiles|invites|stats/,
      dependencies: ['chromium'],
    },
    // Edits people and checks the export's counts against the database: last, on its own.
    {
      name: 'chromium-admin',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /admin-people/,
      dependencies: ['chromium-writes'],
    },
  ],
  webServer: {
    command:
      `npx vite build --outDir dist-e2e --emptyOutDir --logLevel warn && ` +
      `npx vite preview --outDir dist-e2e --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/film-club/`,
    // Always serve this build: never reuse whatever listens on the port.
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      VITE_SUPABASE_URL: supabase.apiUrl,
      VITE_SUPABASE_PUBLISHABLE_KEY: supabase.publishableKey,
    },
  },
})
