import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config.ts'

export default defineConfig((configEnv) =>
  mergeConfig(
    viteConfig(configEnv),
    defineConfig({
      test: {
        // Only used by `npm run test:coverage` (CI); `npm test` stays uninstrumented.
        coverage: {
          provider: 'v8',
          include: ['src/**'],
          exclude: [
            'src/lib/database.types.ts',
            'src/**/*.test.{ts,tsx}',
            'src/test/**',
            'src/main.tsx',
          ],
          reporter: ['text-summary', 'json-summary', 'html'],
          thresholds: { lines: 85, branches: 80, functions: 78, statements: 84 },
        },
        projects: [
          {
            extends: true,
            test: {
              name: 'app',
              environment: 'jsdom',
              include: ['src/**/*.test.{ts,tsx}'],
              setupFiles: ['./src/test/setup.ts'],
            },
          },
          {
            // Node scripts (e.g. the admin bootstrap) run in plain Node.
            extends: true,
            test: {
              name: 'scripts',
              environment: 'node',
              include: ['scripts/**/*.test.mjs'],
            },
          },
        ],
      },
    }),
  ),
)
