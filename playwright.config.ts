import { defineConfig, devices } from '@playwright/test'

const PORT = 4173

// Runs against the production build served by `vite preview` under the
// GitHub Pages base path. Build first (`npm run e2e` does this).
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}/film-club/`,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/film-club/`,
    reuseExistingServer: !process.env.CI,
  },
})
