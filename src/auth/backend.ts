import type { AuthChangeEvent, Session, SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../lib/database.types'

export type MyProfile = Database['public']['Functions']['my_profile']['Returns'][number]

/**
 * - `valid`: the server knows the user and the session
 * - `invalid`: the user was deleted or the session was revoked (e.g. a
 *   global sign-out elsewhere): sign out locally
 * - `unknown`: couldn't ask (offline, server error): keep the session
 */
export type SessionCheck = 'valid' | 'invalid' | 'unknown'

/**
 * The few auth operations the app needs. The real implementation wraps
 * supabase-js; tests pass a fake, so nothing here needs a network.
 */
export interface AuthBackend {
  /** Subscribes to session changes (fires once with the current session). Returns an unsubscribe function. */
  onSessionChange(callback: (session: Session | null, event: AuthChangeEvent) => void): () => void
  /** Resolves with the error (or null on success); never throws. */
  signIn(email: string, password: string): Promise<{ error: unknown }>
  /** Ends the session on this device. Resolves with the error (or null); never throws. */
  signOut(): Promise<{ error: unknown }>
  /** Asks the server whether the stored session is still good. Never throws. */
  validateSession(): Promise<SessionCheck>
  /** The caller's own profile, or null when the login isn't linked to one. Throws on failure. */
  fetchMyProfile(): Promise<MyProfile | null>
}

// Auth error codes meaning "this session is over" (GoTrue error codes).
const SESSION_GONE_CODES = new Set([
  'user_not_found',
  'session_not_found',
  'session_expired',
  'refresh_token_not_found',
  'refresh_token_already_used',
  'bad_jwt',
])

/** Classifies an error from `auth.getUser()`. Exported for tests. */
export function classifySessionError(error: unknown): SessionCheck {
  if (!error) return 'valid'
  const { name, status, code } = error as { name?: unknown; status?: unknown; code?: unknown }
  if (typeof code === 'string' && SESSION_GONE_CODES.has(code)) return 'invalid'
  if (name === 'AuthSessionMissingError') return 'invalid'
  if (status === 401 || status === 403) return 'invalid'
  return 'unknown'
}

export function supabaseAuthBackend(client: SupabaseClient<Database>): AuthBackend {
  return {
    onSessionChange(callback) {
      // Keep this callback synchronous: supabase-js warns against awaiting
      // other Supabase calls inside it (the profile is loaded elsewhere).
      const { data } = client.auth.onAuthStateChange((event, session) => callback(session, event))
      return () => data.subscription.unsubscribe()
    },
    async signIn(email, password) {
      try {
        const { error } = await client.auth.signInWithPassword({ email, password })
        return { error }
      } catch (error) {
        return { error }
      }
    },
    async signOut() {
      // Local scope: logging out here doesn't end the user's other devices.
      // supabase-js removes the local session before calling the server, so
      // an error here means only that the server couldn't be told.
      try {
        const { error } = await client.auth.signOut({ scope: 'local' })
        return { error }
      } catch (error) {
        return { error }
      }
    },
    async validateSession() {
      try {
        // getUser() asks the server (getSession() would only read storage).
        const { error } = await client.auth.getUser()
        return classifySessionError(error)
      } catch {
        return 'unknown'
      }
    },
    async fetchMyProfile() {
      const { data, error } = await client.rpc('my_profile').maybeSingle()
      if (error) throw error
      return data
    },
  }
}
