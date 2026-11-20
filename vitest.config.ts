import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config.ts'

export default defineConfig((configEnv) =>
  mergeConfig(
    viteConfig(configEnv),
    defineConfig({
      test: {
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
