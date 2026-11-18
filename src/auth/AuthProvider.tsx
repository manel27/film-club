import type { Session } from '@supabase/supabase-js'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { AuthContext, type AuthState, type AuthStatus } from './authContext'
import type { AuthBackend, MyProfile } from './backend'
import { loginErrorMessage } from './errors'

interface ProfileResult {
  userId: string
  attempt: number
  kind: 'found' | 'none' | 'error'
  profile: MyProfile | null
}

/**
 * Holds the session (kept up to date through onAuthStateChange) and the
 * caller's own profile (from the my_profile() RPC, loaded once per user).
 */
export function AuthProvider({ backend, children }: { backend: AuthBackend; children: ReactNode }) {
  const [sessionState, setSessionState] = useState<{ ready: boolean; session: Session | null }>({
    ready: false,
    session: null,
  })
  const [profileResult, setProfileResult] = useState<ProfileResult | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(
    () => backend.onSessionChange((session) => setSessionState({ ready: true, session })),
    [backend],
  )

  const userId = sessionState.session?.user.id ?? null

  // Keyed on the user id, not the session: token refreshes don't refetch.
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    backend.fetchMyProfile().then(
      (profile) => {
        if (!cancelled) {
          setProfileResult({ userId, attempt, kind: profile ? 'found' : 'none', profile })
        }
      },
      () => {
        if (!cancelled) setProfileResult({ userId, attempt, kind: 'error', profile: null })
      },
    )
    return () => {
      cancelled = true
    }
  }, [backend, userId, attempt])

  const current =
    profileResult && profileResult.userId === userId && profileResult.attempt === attempt
      ? profileResult
      : null

  let status: AuthStatus
  if (!sessionState.ready) status = 'loading'
  else if (!userId) status = 'signedOut'
  else if (!current) status = 'loading'
  else if (current.kind === 'found') status = 'signedIn'
  else if (current.kind === 'none') status = 'unlinked'
  else status = 'error'

  const signIn = useCallback(
    async (email: string, password: string) => {
      const { error } = await backend.signIn(email.trim(), password)
      return error ? loginErrorMessage(error) : null
    },
    [backend],
  )

  const signOut = useCallback(() => backend.signOut(), [backend])
  const reloadProfile = useCallback(() => setAttempt((n) => n + 1), [])

  const value = useMemo<AuthState>(
    () => ({
      status,
      session: userId ? sessionState.session : null,
      profile: status === 'signedIn' ? (current?.profile ?? null) : null,
      signIn,
      signOut,
      reloadProfile,
    }),
    [status, userId, sessionState.session, current, signIn, signOut, reloadProfile],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
