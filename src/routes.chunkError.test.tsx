import { fireEvent, render, screen, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from './auth/AuthProvider'
import { routes } from './routes'
import { createFakeAuthBackend, fakeProfile, fakeSession } from './test/fakeAuthBackend'

// The Stats chunk is gone (an old tab after a deploy): its import rejects.
vi.mock('./pages/StatsPage', () => {
  throw new TypeError('Failed to fetch dynamically imported module')
})
vi.mock('./films/api', () => ({
  fetchFilmsData: async () => ({ films: [], people: [], scored: new Set() }),
  fetchFilm: async () => null,
  fetchPeopleList: async () => [],
}))

afterEach(() => {
  vi.restoreAllMocks()
})

describe('a page that fails to load', () => {
  it('shows a friendly alert with Reload inside the header, and the nav still works', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const reload = vi.fn()
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload })
    const router = createMemoryRouter(routes, { initialEntries: ['/stats'] })
    render(
      <AuthProvider
        backend={createFakeAuthBackend({ session: fakeSession(), profile: fakeProfile() }).backend}
      >
        <RouterProvider router={router} />
      </AuthProvider>,
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't load this page. The site may have been updated.",
    )
    expect(screen.queryByText(/Unexpected Application Error/)).toBeNull()
    expect(consoleError).toHaveBeenCalled() // the real error is logged
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(reload).toHaveBeenCalledOnce()

    // The header stayed; another page loads normally.
    const nav = screen.getByRole('navigation', { name: 'Main' })
    fireEvent.click(within(nav).getByRole('link', { name: 'Films' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Films' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
