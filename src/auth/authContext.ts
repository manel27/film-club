import type { Session } from '@supabase/supabase-js'
import { createContext, useContext } from 'react'
import type { Theme } from '../theme'
import type { MyProfile } from './backend'

/**
 * - `loading`: session or profile not known yet
 * - `signedOut`: no session
 * - `unlinked`: logged in, but the login isn't linked to a club profile
 * - `error`: logged in, but the profile couldn't be loaded (e.g. offline)
 * - `signedIn`: logged in with a profile
 */
export type AuthStatus = 'loading' | 'signedOut' | 'unlinked' | 'error' | 'signedIn'

/** Shown on the login page after a logout or a forced sign-out. */
export type AuthNotice = { kind: 'sessionEnded' } | { kind: 'signOutIncomplete' } | { kind: 'none' }

export interface AuthState {
  status: AuthStatus
  session: Session | null
  profile: MyProfile | null
  notice: AuthNotice
  /** Resolves with a friendly error message, or null on success. */
  signIn(email: string, password: string): Promise<string | null>
  /** Resolves with a friendly error message if the server couldn't be told, or null. */
  signOut(): Promise<string | null>
  /** Loads the profile again (after an `error`). */
  reloadProfile(): void
  /** Fetches the profile again in place (no loading screen), e.g. after a rename. Never throws. */
  refreshProfile(): Promise<void>
  /** The theme on screen. */
  theme: Theme
  /** Applies a theme; saved to user_settings too, except for viewers (localStorage only). */
  setTheme(theme: Theme): void
}

export const SIGN_OUT_INCOMPLETE_MESSAGE =
  "You're logged out on this device, but the server couldn't be reached to end the session."

export const SESSION_ENDED_MESSAGE = 'Your session has ended. Please log in again.'

export const AuthContext = createContext<AuthState | null>(null)

export function useAuth(): AuthState {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>')
  return value
}
