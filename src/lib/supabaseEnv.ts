export interface SupabaseEnv {
  url: string
  publishableKey: string
}

/**
 * Reads the Supabase settings from the Vite environment and fails loudly if
 * any are missing. Only the project URL and the publishable key belong here:
 * both are public by design. Secret keys must never reach the browser.
 */
export function readSupabaseEnv(env: {
  VITE_SUPABASE_URL?: string
  VITE_SUPABASE_PUBLISHABLE_KEY?: string
}): SupabaseEnv {
  const url = env.VITE_SUPABASE_URL?.trim()
  const publishableKey = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
  const missing = [
    !url && 'VITE_SUPABASE_URL',
    !publishableKey && 'VITE_SUPABASE_PUBLISHABLE_KEY',
  ].filter(Boolean)

  if (missing.length > 0) {
    throw new Error(
      `Missing Supabase configuration: ${missing.join(', ')}. ` +
        'Copy .env.example to .env.local and fill in the project URL and publishable key ' +
        '(in CI they come from the GitHub Actions variables of the same name).',
    )
  }
  if (publishableKey!.startsWith('sb_secret_')) {
    throw new Error(
      'VITE_SUPABASE_PUBLISHABLE_KEY contains a secret key. Use the publishable key instead.',
    )
  }
  return { url: url!, publishableKey: publishableKey! }
}
