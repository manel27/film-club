import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '../auth/AuthProvider'
import RequireAuth from '../auth/RequireAuth'
import type { ProfileData } from '../films/api'
import type { FilmItem } from '../films/films'
import { createFakeAuthBackend, fakeProfile, fakeSession } from '../test/fakeAuthBackend'
import ProfilePage from './ProfilePage'

const ME = '00000000-0000-4000-8000-000000000001'
const ADA = '00000000-0000-4000-8000-000000000002'
const CINEMA = '00000000-0000-4000-8000-000000000003'

const film = (f: Partial<FilmItem> & Pick<FilmItem, 'id' | 'title' | 'screenedOn'>): FilmItem => ({
  releaseYear: 2001,
  posterPath: null,
  genres: [],
  dayOrder: 1,
  kind: 'normal',
  assignedId: ADA,
  presentIds: [],
  avgScore: null,
  isEasterEgg: false,
  ...f,
})

const data = (): ProfileData => ({
  people: [
    { id: ME, name: 'Quinn', colour: '#4a86e8', isSystem: false, role: 'member' },
    { id: ADA, name: 'Ada', colour: '#ffd200', isSystem: false, role: 'moderator' },
    { id: CINEMA, name: 'Cinema', colour: null, isSystem: true },
  ],
  films: [
    film({
      id: 1,
      title: 'Glass River',
      screenedOn: '2026-11-14',
      presentIds: [ME, ADA],
      avgScore: 8,
    }),
    film({ id: 2, title: 'Night Bus', screenedOn: '2026-11-07', assignedId: ME, avgScore: 6 }),
    // The easter egg and a future screening: in no tab (P3, P4).
    film({
      id: 3,
      title: 'Shark Joke',
      screenedOn: '2025-06-14',
      assignedId: ME,
      isEasterEgg: true,
    }),
    film({ id: 4, title: 'Old Reel', screenedOn: '2024-03-02' }),
    film({ id: 5, title: 'Tomorrow', screenedOn: '2099-01-01', assignedId: ME }),
  ],
  scores: new Map([
    [1, 9],
    [2, 7],
    [3, 11],
  ]),
  commentFilmIds: [1, 3],
})

const fetchProfileData = vi.fn(async (id: string): Promise<ProfileData> => (void id, data()))
const renameProfile = vi.fn(async (id: string, name: string) => void [id, name])
vi.mock('../films/api', () => ({
  fetchProfileData: (id: string) => fetchProfileData(id),
  renameProfile: (id: string, name: string) => renameProfile(id, name),
}))

function renderPage(path: string, role: 'member' | 'viewer' = 'member') {
  const router = createMemoryRouter(
    [
      {
        path: '/people/:id',
        element: (
          <RequireAuth>
            <ProfilePage />
          </RequireAuth>
        ),
      },
    ],
    { initialEntries: [path] },
  )
  const fake = createFakeAuthBackend({
    session: fakeSession(),
    profile: fakeProfile({ id: ME, role }),
  })
  render(
    <AuthProvider backend={fake.backend}>
      <RouterProvider router={router} />
    </AuthProvider>,
  )
  return { router, fake }
}

const stat = (name: string) => screen.getByText(name).nextElementSibling?.textContent

beforeEach(() => {
  fetchProfileData.mockClear()
  renameProfile.mockReset()
})

describe('profile page', () => {
  it('shows the name, role, stats without the easter egg, and the attendance note', async () => {
    renderPage(`/people/${ME}`)
    expect(await screen.findByRole('heading', { level: 1, name: 'Quinn' })).toBeInTheDocument()
    expect(fetchProfileData).toHaveBeenCalledWith(ME)
    expect(screen.getByText('Member')).toBeInTheDocument()
    // The heading chip uses black or white text on the person's colour.
    expect(screen.getByText('Quinn', { selector: '.profile-chip' })).toHaveStyle({
      color: '#000000',
    })
    expect(stat('Films watched')).toBe('1')
    expect(stat('Films chosen')).toBe('2') // the future film counts
    expect(stat('Average of the films they chose')).toBe('6.00')
    expect(stat('Scores given')).toBe('2')
    expect(stat('Average score given')).toBe('8.00')
    expect(stat('Comments')).toBe('1')
    expect(screen.getByText('Attendance before 2023 may be incomplete.')).toBeInTheDocument()
  })

  it('switches between watched and not watched, marks scored-but-absent films, and shows posters', async () => {
    const { router } = renderPage(`/people/${ME}`)
    const watched = await screen.findByRole('tab', { name: 'Watched (1)' })
    expect(watched).toHaveAttribute('aria-selected', 'true')
    const panel = screen.getByRole('tabpanel')
    expect(
      within(panel)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([expect.stringContaining('Glass River')])
    expect(within(panel).queryByText('Scored, not present')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Not watched (2)' }))
    expect(router.state.location.search).toBe('?tab=not-watched')
    const rows = within(screen.getByRole('tabpanel')).getAllByRole('listitem')
    expect(rows.map((r) => r.querySelector('a[href^="/films/"]')?.textContent)).toEqual([
      'Night Bus',
      'Old Reel',
    ])
    expect(within(rows[0]).getByText('Scored, not present')).toBeInTheDocument()

    expect(within(rows[1]).queryByText('Scored, not present')).not.toBeInTheDocument()
    expect(screen.getByRole('tabpanel')).toHaveAttribute('tabindex', '0')

    // Arrow keys move between the tabs (and wrap); Home and End jump.
    const notWatched = screen.getByRole('tab', { name: 'Not watched (2)' })
    fireEvent.keyDown(notWatched, { key: 'ArrowLeft' })
    expect(screen.getByRole('tab', { name: 'Watched (1)' })).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Watched (1)' }), { key: 'ArrowLeft' })
    expect(notWatched).toHaveFocus()
    expect(notWatched).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(notWatched, { key: 'Home' })
    expect(screen.getByRole('tab', { name: 'Watched (1)' })).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Watched (1)' }), { key: 'End' })
    expect(notWatched).toHaveFocus()
    fireEvent.keyDown(notWatched, { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: 'Watched (1)' })).toHaveFocus()

    fireEvent.click(screen.getByRole('button', { name: 'Poster grid' }))
    expect(router.state.location.search).toBe('?view=grid')
    expect(screen.getByRole('img', { name: 'Glass River (2001)' })).toBeInTheDocument()
  })

  it('renames yourself: trimmed, saved, header profile refreshed, notice focused', async () => {
    const { fake } = renderPage(`/people/${ME}`)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit name' }))
    const input = screen.getByLabelText('Display name')
    expect(input).toHaveValue('Quinn')

    fireEvent.change(input, { target: { value: '  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a name.')
    fireEvent.change(input, { target: { value: 'ada' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Someone already has that name.')
    expect(renameProfile).not.toHaveBeenCalled()

    const calls = fake.backend.fetchMyProfile.mock.calls.length
    fireEvent.change(input, { target: { value: '  Quinn Q.  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Name saved.'))
    expect(screen.getByRole('status')).toHaveFocus()
    expect(renameProfile).toHaveBeenCalledWith(ME, 'Quinn Q.')
    expect(fake.backend.fetchMyProfile.mock.calls.length).toBe(calls + 1)
    expect(fetchProfileData).toHaveBeenCalledTimes(2)
  })

  it('shows a friendly error when the server refuses the name, and Cancel returns focus', async () => {
    renameProfile.mockRejectedValueOnce({ code: '23505', message: 'duplicate key' })
    renderPage(`/people/${ME}`)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit name' }))
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Zed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Someone already has that name.')
    expect(screen.queryByText(/duplicate key/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('button', { name: 'Edit name' })).toHaveFocus()
  })

  it("offers no rename on someone else's profile, nor to a viewer on their own", async () => {
    renderPage(`/people/${ADA}`)
    expect(await screen.findByRole('heading', { level: 1, name: 'Ada' })).toBeInTheDocument()
    expect(screen.getByText('Moderator')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit name' })).not.toBeInTheDocument()
  })

  it('offers no rename to a viewer on their own profile', async () => {
    const d = data()
    d.people[0].role = 'viewer'
    fetchProfileData.mockResolvedValueOnce(d)
    renderPage(`/people/${ME}`, 'viewer')
    expect(await screen.findByRole('heading', { level: 1, name: 'Quinn' })).toBeInTheDocument()
    expect(screen.getByText('Viewer', { selector: '.badge' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit name' })).not.toBeInTheDocument()
  })

  it('treats system profiles, unknown ids and bad ids as not found', async () => {
    renderPage(`/people/${CINEMA}`)
    expect(await screen.findByRole('heading', { name: 'Person not found' })).toBeInTheDocument()
  })

  it('treats an unknown valid uuid as not found', async () => {
    renderPage('/people/00000000-0000-4000-8000-0000000000ff')
    expect(await screen.findByRole('heading', { name: 'Person not found' })).toBeInTheDocument()
    expect(fetchProfileData).toHaveBeenCalledWith('00000000-0000-4000-8000-0000000000ff')
  })

  it('saves even when the name matches a stale copy, and shows what the server has', async () => {
    renderPage(`/people/${ME}`)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit name' }))
    // The reload after saving brings whatever the server now has.
    const fresh = data()
    fresh.people[0].name = 'Quinn (server)'
    fetchProfileData.mockResolvedValueOnce(fresh)
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Name saved.'))
    expect(renameProfile).toHaveBeenCalledWith(ME, 'Quinn')
    expect(screen.getByRole('heading', { level: 1, name: 'Quinn (server)' })).toBeInTheDocument()
  })

  it('does not query for an id that is not a uuid', async () => {
    renderPage('/people/nope')
    expect(await screen.findByRole('heading', { name: 'Person not found' })).toBeInTheDocument()
    expect(fetchProfileData).not.toHaveBeenCalled()
  })

  it('offers a retry when loading fails', async () => {
    fetchProfileData.mockRejectedValueOnce(new Error('offline'))
    renderPage(`/people/${ADA}`)
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load this profile.")
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Ada' })).toBeInTheDocument()
  })
})
