import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { findUserByEmail } from '../scripts/create-admin.mjs'
import { localSupabase } from './localSupabase'

// Synthetic e2e logins, created by global-setup.ts on the LOCAL stack only.
export const E2E_PASSWORD = 'e2e-local-only-password'
export const E2E_ADMIN = { email: 'e2e-admin@example.test', name: 'E2E Admin', colour: '#e69138' }
export const E2E_MEMBER = {
  email: 'e2e-member@example.test',
  name: 'E2E Member',
  colour: '#6aa84f',
}
export const E2E_UNLINKED = { email: 'e2e-unlinked@example.test' }

/** Client with the local stack's secret key (test setup only, never in the browser). */
export function adminClient(): SupabaseClient {
  const { apiUrl, secretKey } = localSupabase()
  return createClient(apiUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

/** A browser-like client (publishable key) for acting as a user from a test. */
export function userClient(): SupabaseClient {
  const { apiUrl, publishableKey } = localSupabase()
  return createClient(apiUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

/** Creates (or resets) a login with E2E_PASSWORD. Returns its id. */
export async function ensureLogin(client: SupabaseClient, email: string): Promise<string> {
  const existing = await findUserByEmail(client, email)
  if (existing) {
    const { error } = await client.auth.admin.updateUserById(existing.id, {
      password: E2E_PASSWORD,
    })
    if (error) throw error
    return existing.id
  }
  const { data, error } = await client.auth.admin.createUser({
    email,
    password: E2E_PASSWORD,
    email_confirm: true,
  })
  if (error) throw error
  return data.user.id
}

/** Creates (or resets) a login linked to a profile with the given role. */
export async function ensureLinkedLogin(
  client: SupabaseClient,
  { email, name, colour, role }: { email: string; name: string; colour: string; role: string },
): Promise<string> {
  const userId = await ensureLogin(client, email)
  const { data: existing, error: readError } = await client
    .from('profiles')
    .select('id')
    .eq('display_name', name)
    .maybeSingle()
  if (readError) throw readError
  const { error } = existing
    ? await client
        .from('profiles')
        .update({ auth_user_id: userId, claimed_at: new Date().toISOString(), role, colour })
        .eq('id', existing.id)
    : await client.from('profiles').insert({
        display_name: name,
        colour,
        role,
        auth_user_id: userId,
        claimed_at: new Date().toISOString(),
      })
  if (error) throw error
  return userId
}

/** Deletes a login (if present) and a profile by name. Throws on failure. */
export async function removeLoginAndProfile(
  client: SupabaseClient,
  email: string,
  name?: string,
): Promise<void> {
  const user = await findUserByEmail(client, email)
  if (user) {
    const { error } = await client.auth.admin.deleteUser(user.id)
    if (error) throw new Error(`cleanup: could not delete login ${email}: ${error.message}`)
  }
  if (name) {
    const { error } = await client.from('profiles').delete().eq('display_name', name)
    if (error) throw new Error(`cleanup: could not delete profile ${name}: ${error.message}`)
  }
}
