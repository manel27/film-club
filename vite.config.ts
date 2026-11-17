import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { assertBuildEnv } from './src/lib/supabaseEnv.ts'

// Served from https://manel27.github.io/film-club/ (GitHub Pages project site).
export default defineConfig(({ command, mode }) => {
  // Production builds fail fast if the Supabase URL / publishable key are
  // missing or wrong (values come from .env.local locally, vars.* in CI).
  assertBuildEnv(command, mode, loadEnv(mode, process.cwd(), 'VITE_'))

  return {
    base: '/film-club/',
    plugins: [react()],
  }
})
