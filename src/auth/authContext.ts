import type { Session } from '@supabase/supabase-js'
import { createContext, useContext } from 'react'
import type { MyProfile } from './backend'

/**
 * - `loading`: session or profile not known yet
 * - `signedOut`: no session
 * - `unlinked`: logged in, but the login isn't linked to a club profile
 * - `error`: logged in, but the profile couldn't be loaded (e.g. offline)
 * - `signedIn`: logged in with a profile
 */
export type AuthStatus = 'loading' | 'signedOut' | 'unlinked' | 'error' | 'signedIn'

export interface AuthState {
  status: AuthStatus
  session: Session | null
  profile: MyProfile | null
  /** Resolves with a friendly error message, or null on success. */
  signIn(email: string, password: string): Promise<string | null>
  signOut(): Promise<void>
  /** Loads the profile again (after an `error`). */
  reloadProfile(): void
}

export const AuthContext = createContext<AuthState | null>(null)

export function useAuth(): AuthState {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>')
  return value
}
