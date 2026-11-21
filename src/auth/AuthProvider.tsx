import type { Session } from '@supabase/supabase-js'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  AuthContext,
  SIGN_OUT_INCOMPLETE_MESSAGE,
  type AuthNotice,
  type AuthState,
  type AuthStatus,
} from './authContext'
import type { AuthBackend, MyProfile } from './backend'
import { applyTheme, currentTheme, isTheme, type Theme } from '../theme'
import { loginErrorMessage } from './errors'

interface ProfileResult {
  userId: string
  attempt: number
  kind: 'found' | 'none' | 'error'
  profile: MyProfile | null
}

const NO_NOTICE: AuthNotice = { kind: 'none' }

/**
 * Holds the session (kept up to date through onAuthStateChange) and the
 * caller's own profile (from the my_profile() RPC, loaded once per user).
 *
 * The stored session is checked with the server on start-up and whenever the
 * tab regains focus or becomes visible: if the user was deleted or the
 * session revoked (e.g. "log out everywhere"), it is signed out locally.
 */
export function AuthProvider({ backend, children }: { backend: AuthBackend; children: ReactNode }) {
  const [sessionState, setSessionState] = useState<{ ready: boolean; session: Session | null }>({
    ready: false,
    session: null,
  })
  const [profileResult, setProfileResult] = useState<ProfileResult | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [notice, setNotice] = useState<AuthNotice>(NO_NOTICE)

  useEffect(
    () =>
      backend.onSessionChange((session) => {
        setSessionState({ ready: true, session })
        // Forget the previous user's profile at once: no stale name or role
        // if someone else (or the same person) logs in next.
        if (!session) setProfileResult(null)
      }),
    [backend],
  )

  const userId = sessionState.session?.user.id ?? null

  const endSession = useCallback(() => {
    setNotice({ kind: 'sessionEnded' })
    void backend.signOut()
  }, [backend])

  // Check the session with the server, then load the profile. Keyed on the
  // user id, not the session: token refreshes don't refetch.
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    void (async () => {
      const check = await backend.validateSession()
      if (cancelled) return
      if (check === 'invalid') {
        endSession()
        return
      }
      try {
        const profile = await backend.fetchMyProfile()
        if (!cancelled) {
          setProfileResult({ userId, attempt, kind: profile ? 'found' : 'none', profile })
        }
      } catch {
        if (!cancelled) setProfileResult({ userId, attempt, kind: 'error', profile: null })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [backend, userId, attempt, endSession])

  // Re-check when the tab comes back (focus / visibility).
  const checking = useRef(false)
  useEffect(() => {
    if (!userId) return
    let active = true
    const recheck = async () => {
      if (checking.current || document.visibilityState === 'hidden') return
      checking.current = true
      try {
        const check = await backend.validateSession()
        if (active && check === 'invalid') endSession()
      } finally {
        checking.current = false
      }
    }
    window.addEventListener('focus', recheck)
    document.addEventListener('visibilitychange', recheck)
    return () => {
      active = false
      window.removeEventListener('focus', recheck)
      document.removeEventListener('visibilitychange', recheck)
    }
  }, [backend, userId, endSession])

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
      if (error) return loginErrorMessage(error)
      setNotice(NO_NOTICE)
      return null
    },
    [backend],
  )

  const signOut = useCallback(async () => {
    setNotice(NO_NOTICE)
    const { error } = await backend.signOut()
    if (!error) return null
    setNotice({ kind: 'signOutIncomplete' })
    return SIGN_OUT_INCOMPLETE_MESSAGE
  }, [backend])

  const reloadProfile = useCallback(() => setAttempt((n) => n + 1), [])

  // Themes: saved per person in user_settings (private to them, D5). Viewers
  // can't write, so theirs stays in localStorage only, like the login page's.
  const profile = status === 'signedIn' ? (current?.profile ?? null) : null
  const settingsId = profile && profile.role !== 'viewer' ? profile.id : null
  const [theme, setThemeState] = useState(currentTheme)
  // A switch made while the saved theme is still loading wins over it.
  const chose = useRef(false)

  useEffect(() => {
    if (!settingsId) return
    chose.current = false
    let cancelled = false
    void backend.fetchTheme(settingsId).then((saved) => {
      if (cancelled || chose.current || !isTheme(saved)) return
      applyTheme(saved)
      setThemeState(saved)
    })
    return () => {
      cancelled = true
    }
  }, [backend, settingsId])

  const setTheme = useCallback(
    (next: Theme) => {
      chose.current = true
      applyTheme(next)
      setThemeState(next)
      if (settingsId) {
        void backend.saveTheme(settingsId, next).then(({ error }) => {
          if (error) console.warn('Theme not saved', error)
        })
      }
    },
    [backend, settingsId],
  )

  const value = useMemo<AuthState>(
    () => ({
      status,
      session: userId ? sessionState.session : null,
      profile,
      notice,
      signIn,
      signOut,
      reloadProfile,
      theme,
      setTheme,
    }),
    [
      status,
      userId,
      sessionState.session,
      profile,
      notice,
      signIn,
      signOut,
      reloadProfile,
      theme,
      setTheme,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
