import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from './auth/AuthProvider'
import { routes } from './routes'
import { createFakeAuthBackend, fakeProfile, fakeSession } from './test/fakeAuthBackend'
import { DEFAULT_THEME, THEME_STORAGE_KEY, THEMES } from './theme'
import indexHtml from '../index.html?raw'

vi.mock('./films/api', () => ({
  fetchFilmsData: async () => ({ films: [], people: [], scored: new Set() }),
  fetchFilm: async () => null,
}))
// The admin page's data comes from Supabase too (tested in pages/InvitePages.test.tsx).
vi.mock('./invites/api', () => ({}))
vi.mock('./stats/api', () => ({}))
vi.mock('./rotation/api', () => ({
  fetchRotation: async () => ({
    ...{ epoch: null, weekStart: null, standings: [], passes: [], decisions: [] },
    ...{ adjustments: [], chosen: [], people: [] },
  }),
}))

function renderShell(fake: ReturnType<typeof createFakeAuthBackend>, path = '/') {
  render(
    <AuthProvider backend={fake.backend}>
      <RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />
    </AuthProvider>,
  )
}

const html = document.documentElement

describe('theme switcher', () => {
  beforeEach(() => {
    localStorage.clear()
    delete html.dataset.theme
  })

  it('applies a member’s saved theme and saves their changes to user_settings', async () => {
    const fake = createFakeAuthBackend({ session: fakeSession(), savedTheme: 'letterboxd' })
    renderShell(fake)
    const picker = await screen.findByLabelText('Theme')
    await waitFor(() => expect(picker).toHaveValue('letterboxd'))
    expect(html.dataset.theme).toBe('letterboxd')
    expect(fake.backend.fetchTheme).toHaveBeenCalledWith('profile-1')

    fireEvent.change(picker, { target: { value: 'batman' } })
    expect(html.dataset.theme).toBe('batman')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('batman')
    expect(fake.backend.saveTheme).toHaveBeenCalledWith('profile-1', 'batman')
  })

  it('keeps a viewer’s theme in localStorage only', async () => {
    html.dataset.theme = 'batman' // as set by index.html from localStorage
    const fake = createFakeAuthBackend({
      session: fakeSession(),
      profile: fakeProfile({ role: 'viewer' }),
      savedTheme: 'letterboxd',
    })
    renderShell(fake)
    const picker = await screen.findByLabelText('Theme')
    expect(picker).toHaveValue('batman')

    fireEvent.change(picker, { target: { value: 'superman' } })
    expect(html.dataset.theme).toBe('superman')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('superman')
    expect(fake.backend.fetchTheme).not.toHaveBeenCalled()
    expect(fake.backend.saveTheme).not.toHaveBeenCalled()
  })

  it('keeps a switch made while the saved theme is still loading', async () => {
    const fake = createFakeAuthBackend({ session: fakeSession() })
    let resolveSaved: (theme: string | null) => void = () => {}
    fake.backend.fetchTheme.mockImplementation(
      () => new Promise<string | null>((resolve) => (resolveSaved = resolve)),
    )
    renderShell(fake)
    const picker = await screen.findByLabelText('Theme')
    await waitFor(() => expect(fake.backend.fetchTheme).toHaveBeenCalled())

    fireEvent.change(picker, { target: { value: 'batman' } })
    await act(async () => resolveSaved('letterboxd'))
    expect(picker).toHaveValue('batman')
    expect(html.dataset.theme).toBe('batman')
  })

  it('index.html’s pre-paint script knows exactly the THEMES ids', () => {
    const ids = indexHtml.match(/\^\(([\w|]+)\)\$/)?.[1].split('|')
    expect(ids).toEqual(THEMES.map((t) => t.id))
  })

  it('defaults to Letterboxd, in index.html too', () => {
    expect(DEFAULT_THEME).toBe('letterboxd')
    expect(indexHtml).toContain(`theme = '${DEFAULT_THEME}'`)
  })

  it('lets a logged-out visitor switch theme on the login page (device only)', async () => {
    const fake = createFakeAuthBackend()
    renderShell(fake, '/login')
    const picker = await screen.findByLabelText('Theme')
    expect(picker).toHaveValue(DEFAULT_THEME)

    fireEvent.change(picker, { target: { value: 'superman' } })
    expect(html.dataset.theme).toBe('superman')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('superman')
    expect(fake.backend.saveTheme).not.toHaveBeenCalled()
  })
})
