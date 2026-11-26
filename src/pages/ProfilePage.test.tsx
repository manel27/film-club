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

// Each person's own scores, as fetchProfileData returns them.
const SCORES: Record<string, [number, number][]> = {
  [ME]: [
    [1, 9],
    [2, 7],
    [3, 11],
  ],
  // Ada was at Glass River and Night Bus, and scored Old Reel without attending.
  [ADA]: [[4, 6]],
}

const data = (id = ME): ProfileData => ({
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
    film({
      id: 2,
      title: 'Night Bus',
      screenedOn: '2026-11-07',
      assignedId: ME,
      presentIds: [ADA],
      avgScore: 6,
    }),
    // The easter egg and a future screening: in no tab (P3, P4).
    film({
      id: 3,
      title: 'Shark Joke',
      screenedOn: '2025-06-14',
      assignedId: ME,
      isEasterEgg: true,
    }),
    film({ id: 4, title: 'Old Reel', screenedOn: '2024-03-02' }),
    // Marked present ahead of time: still in no tab and no stat until screened.
    film({ id: 5, title: 'Tomorrow', screenedOn: '2099-01-01', assignedId: ME, presentIds: [ME] }),
  ],
  scores: new Map(SCORES[id] ?? []),
  commentFilmIds: [1, 3],
})

const fetchProfileData = vi.fn(async (id: string): Promise<ProfileData> => data(id))
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
    expect(screen.getByText('Member', { selector: '.badge' })).toBeInTheDocument()
    // The heading chip uses black or white text on the person's colour.
    expect(screen.getByText('Quinn', { selector: '.profile-chip' })).toHaveStyle({
      color: '#000000',
    })
    expect(stat('Films present')).toBe('1')
    expect(stat('Films watched')).toBe('2') // Night Bus: scored, not present
    expect(stat('Films chosen')).toBe('2') // the future film counts
    expect(stat('Average of the films they chose')).toBe('6.00')
    expect(stat('Scores given')).toBe('2')
    expect(stat('Average score given')).toBe('8.00')
    expect(stat('Comments')).toBe('1')
    expect(screen.getByText('Attendance before 2023 may be incomplete.')).toBeInTheDocument()
  })

  it('switches between the four tabs, marks scored-but-absent films on Not present, and shows posters', async () => {
    const { router } = renderPage(`/people/${ME}`)
    const titles = () =>
      within(screen.getByRole('tabpanel'))
        .queryAllByRole('listitem')
        .map((li) => li.querySelector('a[href^="/films/"]')?.textContent)
    const tab = (name: string) => screen.getByRole('tab', { name: new RegExp(`^${name} \\(`) })
    expect(await screen.findByRole('tab', { name: 'Present (1)' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(titles()).toEqual(['Glass River'])
    expect(screen.queryByText('Scored, not present')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Not present (2)' }))
    expect(router.state.location.search).toBe('?tab=not-present')
    expect(titles()).toEqual(['Night Bus', 'Old Reel'])
    const rows = within(screen.getByRole('tabpanel')).getAllByRole('listitem')
    expect(within(rows[0]).getByText('Scored, not present')).toBeInTheDocument()
    expect(within(rows[1]).queryByText('Scored, not present')).not.toBeInTheDocument()
    expect(screen.getByRole('tabpanel')).toHaveAttribute('tabindex', '0')

    // Watched = present or scored; the marker is only on Not present.
    fireEvent.click(screen.getByRole('tab', { name: 'Watched (2)' }))
    expect(router.state.location.search).toBe('?tab=watched')
    expect(titles()).toEqual(['Glass River', 'Night Bus'])
    expect(screen.queryByText('Scored, not present')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Not watched (1)' }))
    expect(router.state.location.search).toBe('?tab=not-watched')
    expect(titles()).toEqual(['Old Reel'])

    // Arrow keys move between the tabs (and wrap); Home and End jump.
    fireEvent.keyDown(tab('Not watched'), { key: 'ArrowRight' })
    expect(tab('Present')).toHaveFocus()
    expect(tab('Present')).toHaveAttribute('aria-selected', 'true')
    expect(router.state.location.search).toBe('') // the default isn't in the URL
    fireEvent.keyDown(tab('Present'), { key: 'ArrowLeft' })
    expect(tab('Not watched')).toHaveFocus()
    fireEvent.keyDown(tab('Not watched'), { key: 'ArrowLeft' })
    expect(tab('Watched')).toHaveFocus()
    fireEvent.keyDown(tab('Watched'), { key: 'Home' })
    expect(tab('Present')).toHaveFocus()
    fireEvent.keyDown(tab('Present'), { key: 'ArrowRight' })
    expect(tab('Not present')).toHaveFocus()
    fireEvent.keyDown(tab('Not present'), { key: 'End' })
    expect(tab('Not watched')).toHaveFocus()
    expect(tab('Not watched')).toHaveAttribute('aria-selected', 'true')

    fireEvent.click(tab('Present'))
    fireEvent.click(screen.getByRole('button', { name: 'Poster grid' }))
    expect(router.state.location.search).toBe('?view=grid')
    expect(screen.getByRole('img', { name: 'Glass River (2001)' })).toBeInTheDocument()
  })

  // Old ?tab=watched / not-watched links now mean the new Watched / Not watched.
  it.each([
    ['present', 'Present (1)', ['Glass River']],
    ['not-present', 'Not present (2)', ['Night Bus', 'Old Reel']],
    ['watched', 'Watched (2)', ['Glass River', 'Night Bus']],
    ['not-watched', 'Not watched (1)', ['Old Reel']],
  ])('opens ?tab=%s on a cold load', async (value, name, titles) => {
    renderPage(`/people/${ME}?tab=${value}`)
    expect(await screen.findByRole('tab', { name })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getAllByRole('tab', { selected: true })).toHaveLength(1)
    expect(
      within(screen.getByRole('tabpanel'))
        .getAllByRole('listitem')
        .map((li) => li.querySelector('a[href^="/films/"]')?.textContent),
    ).toEqual(titles)
  })

  it("shows another person's own stats and tab counts", async () => {
    renderPage(`/people/${ADA}`)
    expect(await screen.findByRole('heading', { level: 1, name: 'Ada' })).toBeInTheDocument()
    expect(fetchProfileData).toHaveBeenCalledWith(ADA)
    expect(stat('Films present')).toBe('2')
    expect(stat('Films watched')).toBe('3')
    expect(stat('Scores given')).toBe('1')
    for (const name of ['Present (2)', 'Not present (1)', 'Watched (3)', 'Not watched (0)']) {
      expect(screen.getByRole('tab', { name })).toBeInTheDocument()
    }
  })

  it('falls back to Present for an unknown tab in the URL', async () => {
    renderPage(`/people/${ME}?tab=bogus`)
    expect(await screen.findByRole('tab', { name: 'Present (1)' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getAllByRole('tab', { selected: true })).toHaveLength(1)
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
    expect(screen.getByText('Moderator', { selector: '.badge' })).toBeInTheDocument()
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
