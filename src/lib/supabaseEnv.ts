export interface SupabaseEnv {
  url: string
  publishableKey: string
}

export interface RawSupabaseEnv {
  VITE_SUPABASE_URL?: string
  VITE_SUPABASE_PUBLISHABLE_KEY?: string
}

const PUBLISHABLE_PREFIX = 'sb_publishable_'

/**
 * Reads the Supabase settings from the Vite environment and fails loudly if
 * any are missing or wrong. Only the project URL and the publishable key
 * belong here: both are public by design. Secret keys (`sb_secret_…`) and
 * legacy JWT keys must never reach the browser.
 *
 * Error messages name the variable but never echo its value.
 */
export function readSupabaseEnv(env: RawSupabaseEnv): SupabaseEnv {
  const url = env.VITE_SUPABASE_URL?.trim() ?? ''
  const publishableKey = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? ''

  const missing: string[] = []
  if (!url) missing.push('VITE_SUPABASE_URL')
  if (!publishableKey) missing.push('VITE_SUPABASE_PUBLISHABLE_KEY')
  if (missing.length > 0) {
    throw new Error(
      `Missing Supabase configuration: ${missing.join(', ')}. ` +
        'Copy .env.example to .env.local and fill in the project URL and publishable key ' +
        '(in CI they come from the GitHub Actions variables of the same name).',
    )
  }

  if (!isHttpUrl(url)) {
    throw new Error('VITE_SUPABASE_URL is not a valid http(s) URL.')
  }

  if (!publishableKey.startsWith(PUBLISHABLE_PREFIX)) {
    throw new Error(
      `VITE_SUPABASE_PUBLISHABLE_KEY must be a publishable key (starting with "${PUBLISHABLE_PREFIX}"). ` +
        'Secret keys and legacy JWT keys are not allowed in the front end.',
    )
  }

  return { url, publishableKey }
}

/**
 * Build-time guard used by vite.config.ts: production builds fail fast when
 * the Supabase variables are missing or wrong. Other modes are not checked.
 */
export function assertBuildEnv(command: string, mode: string, env: RawSupabaseEnv): void {
  if (command === 'build' && mode === 'production') {
    readSupabaseEnv(env)
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value)
    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}
