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
/** Logins from supabase/seed.sql (local stack only). */
const SEED_PASSWORD = 'film-club-local'
export const SEED_VIEWER = { email: 'petra@example.test', password: SEED_PASSWORD }
export const SEED_ADMIN = { email: 'orla@example.test', password: SEED_PASSWORD }
export const SEED_MODERATOR = { email: 'tamsin@example.test', password: SEED_PASSWORD }
export const SEED_MEMBER = { email: 'kwame@example.test', password: SEED_PASSWORD }
export const SEED_MEMBER2 = { email: 'yusuf@example.test', password: SEED_PASSWORD }

/**
 * A Saturday (YYYY-MM-DD) about a year from today in Lisbon, plus `weeks`: always
 * in the future, and inside the two years ahead that the film form and film-save
 * accept. Films added through the app use it; rows inserted directly use 2099.
 */
export function saturdayNextYear(weeks = 0): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon' }).format(new Date())
  const noon = Date.parse(`${today}T12:00:00Z`)
  const toSaturday = (6 - new Date(noon).getUTCDay() + 7) % 7
  return new Date(noon + (toSaturday + 7 * (52 + weeks)) * 86_400_000).toISOString().slice(0, 10)
}

/** A date as the app shows it in tables and facts: 2027/12/18. */
export const slashed = (date: string) => date.replaceAll('-', '/')

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
