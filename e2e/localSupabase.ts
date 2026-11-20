import { execFileSync } from 'node:child_process'
import { parseEnv } from 'node:util'

export interface LocalSupabase {
  apiUrl: string
  publishableKey: string
  secretKey: string
}

/**
 * URL and keys of the LOCAL Supabase stack (`supabase start`), read from
 * `supabase status`. These are the stack's throwaway dev keys; real keys are
 * never used by the tests. Refuses anything that isn't on this machine.
 * Cached in process.env so Playwright workers don't ask again.
 */
export function localSupabase(): LocalSupabase {
  let apiUrl = process.env.E2E_SUPABASE_URL
  let publishableKey = process.env.E2E_SUPABASE_PUBLISHABLE_KEY
  let secretKey = process.env.E2E_SUPABASE_SECRET_KEY

  if (!apiUrl || !publishableKey || !secretKey) {
    let output: string
    try {
      output = execFileSync('npx', ['supabase', 'status', '-o', 'env'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
    } catch {
      throw new Error('The e2e tests need the local Supabase stack: run `npm run db:start` first.')
    }
    const env = parseEnv(output)
    apiUrl = env.API_URL
    publishableKey = env.PUBLISHABLE_KEY
    secretKey = env.SECRET_KEY
    if (!apiUrl || !publishableKey || !secretKey) {
      throw new Error('`supabase status` did not report the API URL and keys.')
    }
  }

  const { hostname } = new URL(apiUrl)
  if (hostname !== '127.0.0.1' && hostname !== 'localhost') {
    throw new Error('The e2e tests only run against a local Supabase stack.')
  }

  process.env.E2E_SUPABASE_URL = apiUrl
  process.env.E2E_SUPABASE_PUBLISHABLE_KEY = publishableKey
  process.env.E2E_SUPABASE_SECRET_KEY = secretKey
  return { apiUrl, publishableKey, secretKey }
}
