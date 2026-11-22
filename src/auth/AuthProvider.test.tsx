import { act, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { createFakeAuthBackend, fakeProfile, fakeSession } from '../test/fakeAuthBackend'
import { AuthProvider } from './AuthProvider'
import { useAuth, type AuthState } from './authContext'

function setUp() {
  const fake = createFakeAuthBackend({ session: fakeSession(), profile: fakeProfile() })
  const auth: { current?: AuthState } = {}
  function Probe() {
    auth.current = useAuth()
    return (
      <p>
        {auth.current.status}: {auth.current.profile?.display_name}
      </p>
    )
  }
  render(
    <AuthProvider backend={fake.backend}>
      <Probe />
    </AuthProvider>,
  )
  return { fake, auth }
}

describe('refreshProfile', () => {
  it('replaces the profile in place, without a loading state', async () => {
    const { fake, auth } = setUp()
    expect(await screen.findByText('signedIn: Quinn')).toBeInTheDocument()
    fake.state.profile = fakeProfile({ display_name: 'Quinn Q.' })
    await act(() => auth.current!.refreshProfile())
    expect(screen.getByText('signedIn: Quinn Q.')).toBeInTheDocument()
  })

  it('keeps the old profile when the fetch fails', async () => {
    const { fake, auth } = setUp()
    expect(await screen.findByText('signedIn: Quinn')).toBeInTheDocument()
    fake.state.profile = new Error('offline')
    await act(() => auth.current!.refreshProfile())
    expect(screen.getByText('signedIn: Quinn')).toBeInTheDocument()
  })

  it("ignores another user's profile", async () => {
    const { fake, auth } = setUp()
    expect(await screen.findByText('signedIn: Quinn')).toBeInTheDocument()
    fake.state.profile = fakeProfile({ id: 'profile-2', display_name: 'Someone else' })
    await act(() => auth.current!.refreshProfile())
    expect(screen.getByText('signedIn: Quinn')).toBeInTheDocument()
  })
})
