import react from '@vitejs/plugin-react'
import { createHash } from 'node:crypto'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { assertBuildEnv } from './src/lib/supabaseEnv.ts'

const sha256 = (s: string) => `'sha256-${createHash('sha256').update(s).digest('base64')}'`
const hashes = (html: string, tag: string) =>
  [...html.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'g'))]
    .filter((m) => m[1].trim()) // external <script src> has no body
    .map((m) => sha256(m[1]))
    .join(' ')

/**
 * Content-Security-Policy as a <meta> (GitHub Pages can't send headers), on
 * production builds only: the dev server's HMR needs inline scripts. Inline
 * <script>/<style> in index.html are allowed by hash, computed here.
 * frame-ancestors is ignored in a <meta>; index.html's frame guard covers it.
 */
function csp(supabaseUrl: string | undefined): Plugin {
  return {
    name: 'film-club-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        // Never ship a build without its CSP (assertBuildEnv also checks production builds).
        if (!supabaseUrl) throw new Error('VITE_SUPABASE_URL is required to build the CSP.')
        const policy = [
          "default-src 'self'",
          `script-src 'self' ${hashes(html, 'script')}`,
          // React `style={…}` props go through CSSOM, which style-src doesn't restrict.
          `style-src 'self' ${hashes(html, 'style')}`,
          "img-src 'self' data: https://image.tmdb.org",
          `connect-src 'self' ${new URL(supabaseUrl).origin}`,
          "base-uri 'none'",
          "form-action 'self'",
          "object-src 'none'",
        ].join('; ')
        return html.replace(
          '<meta charset="UTF-8" />',
          `$&\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`,
        )
      },
    },
  }
}

// Served from https://manel27.github.io/film-club/ (GitHub Pages project site).
export default defineConfig(({ command, mode }) => {
  // Production builds fail fast if the Supabase URL / publishable key are
  // missing or wrong (values come from .env.local locally, vars.* in CI).
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  assertBuildEnv(command, mode, env)

  return {
    base: '/film-club/',
    plugins: [react(), csp(env.VITE_SUPABASE_URL)],
  }
})
