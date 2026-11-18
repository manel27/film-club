import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import { vi } from 'vitest'
import type { AuthBackend, MyProfile } from '../auth/backend'

export const TEST_EMAIL = 'quinn@example.test'
export const TEST_PASSWORD = 'right-password'

export function fakeSession(userId = 'user-1', email = TEST_EMAIL): Session {
  return { access_token: `token-${Math.random()}`, user: { id: userId, email } } as Session
}

export function fakeProfile(overrides: Partial<MyProfile> = {}): MyProfile {
  return {
    id: 'profile-1',
    display_name: 'Quinn',
    colour: '#4a86e8',
    role: 'member',
    sheet_keyword: null,
    is_claimed: true,
    claimed_at: '2026-11-18T00:00:00Z',
    is_system: false,
    created_at: '2026-11-18T00:00:00Z',
    updated_at: '2026-11-18T00:00:00Z',
    ...overrides,
  }
}

interface Options {
  /** Session already stored in the browser when the app starts. */
  session?: Session | null
  /** What my_profile() returns: a profile, null (unlinked) or an Error (failure). */
  profile?: MyProfile | null | Error
  /** Error returned by signIn for the right credentials (e.g. a network error). */
  signInError?: unknown
}

/**
 * In-memory stand-in for supabase-js auth. Accepts TEST_EMAIL / TEST_PASSWORD;
 * anything else fails like Supabase does ("invalid_credentials").
 */
export function createFakeAuthBackend(options: Options = {}) {
  let session = options.session ?? null
  let listener: ((session: Session | null, event: AuthChangeEvent) => void) | undefined
  const state = { profile: options.profile === undefined ? fakeProfile() : options.profile }

  const emit = (event: AuthChangeEvent) => listener?.(session, event)

  const backend = {
    onSessionChange: vi.fn((callback: (s: Session | null, e: AuthChangeEvent) => void) => {
      listener = callback
      // supabase-js reports the stored session asynchronously.
      queueMicrotask(() => emit('INITIAL_SESSION'))
      return () => {
        listener = undefined
      }
    }),
    signIn: vi.fn(async (email: string, password: string) => {
      if (email !== TEST_EMAIL || password !== TEST_PASSWORD) {
        return { error: { name: 'AuthApiError', status: 400, code: 'invalid_credentials' } }
      }
      if (options.signInError) return { error: options.signInError }
      session = fakeSession()
      emit('SIGNED_IN')
      return { error: null }
    }),
    signOut: vi.fn(async () => {
      session = null
      emit('SIGNED_OUT')
    }),
    fetchMyProfile: vi.fn(async () => {
      if (state.profile instanceof Error) throw state.profile
      return state.profile
    }),
  } satisfies AuthBackend

  return {
    backend,
    state,
    /** Simulates a token refresh: same user, new session object. */
    refreshToken() {
      if (session) session = { ...session, access_token: `token-${Math.random()}` }
      emit('TOKEN_REFRESHED')
    },
  }
}
