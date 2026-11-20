import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it } from 'vitest'
import { AuthProvider } from './auth/AuthProvider'
import { routes } from './routes'
import { createFakeAuthBackend, fakeProfile, fakeSession } from './test/fakeAuthBackend'
import { THEME_STORAGE_KEY } from './theme'

function renderShell(fake: ReturnType<typeof createFakeAuthBackend>) {
  render(
    <AuthProvider backend={fake.backend}>
      <RouterProvider router={createMemoryRouter(routes, { initialEntries: ['/'] })} />
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
})
