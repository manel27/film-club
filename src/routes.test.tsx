import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { AuthProvider } from './auth/AuthProvider'
import { routes } from './routes'
import {
  createFakeAuthBackend,
  fakeProfile,
  fakeSession,
  TEST_EMAIL,
  TEST_PASSWORD,
} from './test/fakeAuthBackend'

// The film pages' data comes from Supabase; these tests are about routing (no such film).
vi.mock('./films/api', () => ({
  fetchFilmsData: async () => ({ films: [], people: [], scored: new Set() }),
  fetchFilm: async () => null,
  fetchPeopleList: async () => [],
}))
vi.mock('./stats/api', () => ({
  fetchStatsData: async () => ({ films: [], scores: [], attendance: [] }),
}))
// The admin page's data comes from Supabase too (tested in pages/InvitePages.test.tsx).
vi.mock('./invites/api', () => ({ fetchLastExport: vi.fn(async () => null) }))
vi.mock('./support/api', () => ({
  fetchSuggestions: async () => ({ suggestions: [], people: [] }),
  fetchSuggestion: async () => null,
}))
vi.mock('./rotation/api', () => ({
  fetchRotation: async () => ({
    ...{ epoch: null, weekStart: null, standings: [], passes: [], decisions: [] },
    ...{ adjustments: [], chosen: [], people: [] },
  }),
}))

function renderApp(path: string, fake = createFakeAuthBackend()) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(
    <AuthProvider backend={fake.backend}>
      <RouterProvider router={router} />
    </AuthProvider>,
  )
  return { router, fake }
}

const signedIn = (profile = fakeProfile()) =>
  createFakeAuthBackend({ session: fakeSession(), profile })

async function logIn(email: string, password: string) {
  fireEvent.change(await screen.findByLabelText('Email'), { target: { value: email } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } })
  fireEvent.click(screen.getByRole('button', { name: 'Log in' }))
}

describe('route guard', () => {
  it('shows a loading state until the session is known', async () => {
    renderApp('/', signedIn())
    expect(screen.getByRole('status')).toHaveTextContent('Loading')
    expect(await screen.findByRole('heading', { name: 'Films' })).toBeInTheDocument()
  })

  it('sends logged-out visitors to the login page', async () => {
    const { router } = renderApp('/')
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
    expect(router.state.location.search).toBe('')
  })

  it('protects unknown paths too, and remembers where the visitor was going', async () => {
    const { router } = renderApp('/films/12?sort=oldest')
    await screen.findByRole('heading', { name: 'Log in' })
    expect(router.state.location.pathname).toBe('/login')
    expect(new URLSearchParams(router.state.location.search).get('next')).toBe(
      '/films/12?sort=oldest',
    )
  })

  it('returns to the original page after logging in', async () => {
    const { router } = renderApp('/films/12')
    await logIn(TEST_EMAIL, TEST_PASSWORD)
    expect(await screen.findByRole('heading', { name: 'Film not found' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/films/12')
    expect(screen.getByText('Quinn')).toBeInTheDocument()
  })

  it('shows the "not linked" page to a login without a profile, with log out', async () => {
    const fake = createFakeAuthBackend({ session: fakeSession(), profile: null })
    const { router } = renderApp('/', fake)
    expect(
      await screen.findByRole('heading', { name: "Your account isn't linked yet" }),
    ).toBeInTheDocument()
    expect(screen.getByText(/Ask Manel to link it/)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Films' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Log out' }))
    expect(fake.backend.signOut).toHaveBeenCalledOnce()
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
  })

  it('offers a retry when the profile fails to load', async () => {
    const fake = createFakeAuthBackend({ session: fakeSession(), profile: new Error('offline') })
    renderApp('/', fake)
    expect(
      await screen.findByRole('heading', { name: "Couldn't load your profile" }),
    ).toBeInTheDocument()

    fake.state.profile = fakeProfile()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { name: 'Films' })).toBeInTheDocument()
    expect(fake.backend.fetchMyProfile).toHaveBeenCalledTimes(2)
  })

  it('does not reload the profile on a token refresh', async () => {
    const fake = signedIn()
    renderApp('/', fake)
    await screen.findByRole('heading', { name: 'Films' })
    act(() => fake.refreshToken())
    await screen.findByRole('heading', { name: 'Films' })
    expect(fake.backend.fetchMyProfile).toHaveBeenCalledOnce()
  })
})

describe('login page', () => {
  it('has no sign-up link and says it is invite-only', async () => {
    renderApp('/login')
    await screen.findByRole('heading', { name: 'Log in' })
    expect(screen.getByText('Got an invite? Open the link Manel sent you.')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.queryByText(/sign up|register|create account/i)).not.toBeInTheDocument()
  })

  it('shows a clear error for wrong credentials and clears the password', async () => {
    renderApp('/login')
    await logIn(TEST_EMAIL, 'wrong-password')
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong email or password.')
    expect(screen.getByLabelText('Password')).toHaveValue('')
    expect(screen.getByLabelText('Email')).toHaveValue(TEST_EMAIL)
  })

  it('shows a network error message', async () => {
    const fake = createFakeAuthBackend({
      signInError: { name: 'AuthRetryableFetchError', status: 0 },
    })
    renderApp('/login', fake)
    await logIn(TEST_EMAIL, TEST_PASSWORD)
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't reach the server")
  })

  it('trims the email before signing in', async () => {
    const fake = createFakeAuthBackend()
    renderApp('/login', fake)
    await logIn(`  ${TEST_EMAIL} `, TEST_PASSWORD)
    await screen.findByRole('heading', { name: 'Films' })
    expect(fake.backend.signIn).toHaveBeenCalledWith(TEST_EMAIL, TEST_PASSWORD)
  })

  it('goes home after logging in without a destination', async () => {
    const { router } = renderApp('/login')
    await logIn(TEST_EMAIL, TEST_PASSWORD)
    expect(await screen.findByRole('heading', { name: 'Films' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')
  })

  it('ignores an off-site destination', async () => {
    const { router } = renderApp('/login?next=//evil.example')
    await logIn(TEST_EMAIL, TEST_PASSWORD)
    await screen.findByRole('heading', { name: 'Films' })
    expect(router.state.location.pathname).toBe('/')
  })

  it('sends an already logged-in user on to the app', async () => {
    const { router } = renderApp('/login?next=%2Ffilms%2F3', signedIn())
    expect(await screen.findByRole('heading', { name: 'Film not found' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/films/3')
  })
})

describe('app shell', () => {
  it('shows the name, colour dot and admin badge', async () => {
    renderApp('/', signedIn(fakeProfile({ display_name: 'Orla', role: 'admin' })))
    expect(await screen.findByText('Orla')).toBeInTheDocument()
    expect(within(screen.getByLabelText('Logged in as')).getByText('Admin')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Film Club' })).toBeInTheDocument()
    const dot = document.querySelector('.colour-dot') as HTMLElement
    expect(dot.style.backgroundColor).toBe('rgb(74, 134, 232)')
  })

  it('reminds an admin, on every page, when there has never been an export', async () => {
    renderApp('/rotation', signedIn(fakeProfile({ role: 'admin' })))
    const banner = await screen.findByText(/No data export in the last 30 days \(last: never\)/)
    expect(banner).toHaveAttribute('role', 'status')
    expect(
      within(banner).getByRole('link', { name: 'Export it from the Admin page' }),
    ).toHaveAttribute('href', '/admin')
  })

  it('reminds an admin when the last export is long ago, not when it is recent', async () => {
    const fetchLastExport = vi.mocked((await import('./invites/api')).fetchLastExport)
    fetchLastExport.mockResolvedValueOnce('2026-01-01T12:00:00Z')
    renderApp('/', signedIn(fakeProfile({ role: 'admin' })))
    expect(await screen.findByText(/\(last: 1 Jan 2026\)/)).toBeInTheDocument()
    cleanup()

    fetchLastExport.mockResolvedValueOnce(new Date().toISOString())
    renderApp('/', signedIn(fakeProfile({ role: 'admin' })))
    await screen.findByText('Quinn')
    await act(() => Promise.resolve())
    expect(screen.queryByText(/No data export/)).not.toBeInTheDocument()
  })

  it.each(['moderator', 'member', 'viewer'] as const)(
    'never reminds a %s (and never asks)',
    async (role) => {
      const fetchLastExport = vi.mocked((await import('./invites/api')).fetchLastExport)
      fetchLastExport.mockClear()
      renderApp('/', signedIn(fakeProfile({ role })))
      await screen.findByText('Quinn')
      await act(() => Promise.resolve())
      expect(screen.queryByText(/No data export/)).not.toBeInTheDocument()
      expect(fetchLastExport).not.toHaveBeenCalled()
    },
  )

  it('shows a moderator badge', async () => {
    renderApp('/', signedIn(fakeProfile({ role: 'moderator' })))
    expect(await screen.findByText('Moderator')).toBeInTheDocument()
  })

  it.each(['member', 'viewer'] as const)('shows no badge for a %s', async (role) => {
    renderApp('/', signedIn(fakeProfile({ role })))
    await screen.findByText('Quinn')
    expect(screen.queryByText(/admin|moderator/i)).not.toBeInTheDocument()
  })

  it('links Films and Rotation in the header, marking the current page', async () => {
    const { router } = renderApp('/', signedIn())
    const nav = await screen.findByRole('navigation', { name: 'Main' })
    expect(within(nav).getByRole('link', { name: 'Films' })).toHaveAttribute('aria-current', 'page')
    fireEvent.click(within(nav).getByRole('link', { name: 'Rotation' }))
    expect(await screen.findByRole('heading', { name: 'Rotation', level: 1 })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/rotation')
    expect(within(nav).getByRole('link', { name: 'Rotation' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(await screen.findByText(/starts at go-live/)).toBeInTheDocument()
  })

  it.each([
    ['viewer', ['Films', 'Rotation', 'People', 'Stats', 'Support', 'About']],
    ['admin', ['Films', 'Rotation', 'People', 'Stats', 'Support', 'Admin', 'About']],
  ] as const)(
    'links Stats and Support after People for a %s, opening #/support',
    async (role, links) => {
      const { router } = renderApp('/', signedIn(fakeProfile({ role })))
      const nav = await screen.findByRole('navigation', { name: 'Main' })
      expect(
        within(nav)
          .getAllByRole('link')
          .map((a) => a.textContent),
      ).toEqual(links)
      fireEvent.click(within(nav).getByRole('link', { name: 'Support' }))
      expect(await screen.findByRole('heading', { name: 'Support', level: 1 })).toBeInTheDocument()
      expect(router.state.location.pathname).toBe('/support')
    },
  )

  it('opens the stats at #/stats from the nav, for a viewer too', async () => {
    const { router } = renderApp('/', signedIn(fakeProfile({ role: 'viewer' })))
    const nav = await screen.findByRole('navigation', { name: 'Main' })
    fireEvent.click(within(nav).getByRole('link', { name: 'Stats' }))
    expect(await screen.findByText('No screenings yet.')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/stats')
    expect(within(nav).getByRole('link', { name: 'Stats' })).toHaveAttribute('aria-current', 'page')
  })

  it('opens a suggestion at #/support/:id', async () => {
    renderApp('/support/5', signedIn())
    expect(await screen.findByRole('heading', { name: 'Suggestion not found' })).toBeInTheDocument()
  })

  it('copes with a profile that has no colour yet', async () => {
    renderApp('/', signedIn(fakeProfile({ colour: null })))
    await screen.findByText('Quinn')
    expect((document.querySelector('.colour-dot') as HTMLElement).style.backgroundColor).toBe('')
  })

  it('logs out and returns to the login page', async () => {
    const fake = signedIn()
    const { router } = renderApp('/', fake)
    fireEvent.click(await screen.findByRole('button', { name: 'Log out' }))
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument()
    expect(fake.backend.signOut).toHaveBeenCalledOnce()
    expect(router.state.location.pathname).toBe('/login')
    expect(router.state.location.search).toBe('')
  })
})

describe('session checks and logout edge cases', () => {
  it('signs out on start-up when the server says the session is gone', async () => {
    const fake = createFakeAuthBackend({ session: fakeSession(), sessionCheck: 'invalid' })
    const { router } = renderApp('/', fake)
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument()
    expect(screen.getByText('Your session has ended. Please log in again.')).toBeInTheDocument()
    expect(fake.backend.signOut).toHaveBeenCalledOnce()
    expect(fake.backend.fetchMyProfile).not.toHaveBeenCalled()
    expect(router.state.location.pathname).toBe('/login')
  })

  it('keeps the session when the check cannot reach the server', async () => {
    const fake = createFakeAuthBackend({ session: fakeSession(), sessionCheck: 'unknown' })
    renderApp('/', fake)
    expect(await screen.findByRole('heading', { name: 'Films' })).toBeInTheDocument()
    expect(fake.backend.signOut).not.toHaveBeenCalled()
  })

  it.each([
    ['focus', () => window.dispatchEvent(new Event('focus'))],
    ['visibilitychange', () => document.dispatchEvent(new Event('visibilitychange'))],
  ])('re-checks on %s and signs out a revoked session', async (_, fire) => {
    const fake = signedIn()
    renderApp('/', fake)
    await screen.findByRole('heading', { name: 'Films' })
    expect(fake.backend.validateSession).toHaveBeenCalledOnce()

    fake.state.sessionCheck = 'invalid'
    act(() => fire())
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument()
    expect(screen.getByText('Your session has ended. Please log in again.')).toBeInTheDocument()
  })

  it('forgets the profile on sign-out (no stale name or role for the next login)', async () => {
    const fake = signedIn(fakeProfile({ display_name: 'Orla', role: 'admin' }))
    renderApp('/', fake)
    fireEvent.click(await screen.findByRole('button', { name: 'Log out' }))
    await screen.findByRole('heading', { name: 'Log in' })

    // The next login's profile is slow to arrive: nothing from Orla may show meanwhile.
    let release: (p: ReturnType<typeof fakeProfile>) => void = () => {}
    fake.backend.fetchMyProfile.mockImplementationOnce(
      () => new Promise((resolve) => (release = resolve)),
    )
    await logIn(TEST_EMAIL, TEST_PASSWORD)
    await screen.findByRole('status')
    expect(screen.queryByText('Orla')).not.toBeInTheDocument()
    expect(screen.queryByText('Admin')).not.toBeInTheDocument()

    act(() => release(fakeProfile({ display_name: 'Quinn', role: 'member' })))
    expect(await screen.findByText('Quinn')).toBeInTheDocument()
    expect(screen.queryByText('Admin')).not.toBeInTheDocument()
  })

  it('still goes to the login page and says so when the server could not be told', async () => {
    const fake = createFakeAuthBackend({
      session: fakeSession(),
      signOutError: { name: 'AuthRetryableFetchError', status: 0 },
    })
    const { router } = renderApp('/', fake)
    fireEvent.click(await screen.findByRole('button', { name: 'Log out' }))
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument()
    expect(
      screen.getByText(/logged out on this device, but the server couldn't be reached/),
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
  })
})
