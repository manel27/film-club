import type { AuthChangeEvent, Session, SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../lib/database.types'

export type MyProfile = Database['public']['Functions']['my_profile']['Returns'][number]

/**
 * The few auth operations the app needs. The real implementation wraps
 * supabase-js; tests pass a fake, so nothing here needs a network.
 */
export interface AuthBackend {
  /** Subscribes to session changes (fires once with the current session). Returns an unsubscribe function. */
  onSessionChange(callback: (session: Session | null, event: AuthChangeEvent) => void): () => void
  /** Resolves with the error (or null on success); never throws. */
  signIn(email: string, password: string): Promise<{ error: unknown }>
  signOut(): Promise<void>
  /** The caller's own profile, or null when the login isn't linked to one. Throws on failure. */
  fetchMyProfile(): Promise<MyProfile | null>
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
      // Even if the server can't be reached, the local session is cleared.
      await client.auth.signOut({ scope: 'local' })
    },
    async fetchMyProfile() {
      const { data, error } = await client.rpc('my_profile').maybeSingle()
      if (error) throw error
      return data
    },
  }
}
