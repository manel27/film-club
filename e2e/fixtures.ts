import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { localSupabase } from './localSupabase'

// Synthetic e2e logins, created by global-setup.ts on the LOCAL stack only.
export const E2E_PASSWORD = 'e2e-local-only-password'
export const E2E_ADMIN = { email: 'e2e-admin@example.test', name: 'E2E Admin', colour: '#e69138' }
export const E2E_UNLINKED = { email: 'e2e-unlinked@example.test' }

/** Client with the local stack's secret key (test setup only, never in the browser). */
export function adminClient(): SupabaseClient {
  const { apiUrl, secretKey } = localSupabase()
  return createClient(apiUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}
