import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '../auth/AuthProvider'
import RequireAuth from '../auth/RequireAuth'
import type { FilmDetailData, FilmRecord } from '../films/api'
import { comingSaturday, type FilmSaveBody, type TmdbResult } from '../films/filmForm'
import type { Person } from '../films/films'
import { createFakeAuthBackend, fakeProfile, fakeSession } from '../test/fakeAuthBackend'
import FilmFormPage from './FilmFormPage'

const PEOPLE: Person[] = [
  { id: 'p-manel', name: 'Manel', colour: null, isSystem: false },
  { id: 'p-ada', name: 'Ada', colour: null, isSystem: false },
  { id: 'p-cinema', name: 'Cinema', colour: null, isSystem: true },
]
const RESULTS: TmdbResult[] = [
  {
    tmdb_id: 11,
    title: 'Glass River',
    original_title: 'Rio de Vidro',
    year: 2001,
    poster_path: null,
    directors: ['Ana Lume'],
    watched: null,
  },
  {
    tmdb_id: 12,
    title: 'Glass River 2',
    original_title: null,
    year: 2004,
    poster_path: null,
    directors: [],
    watched: { film_id: 3, screened_on: '2026-01-10', kind: 'normal' },
  },
]

const api = vi.hoisted(() => ({
  fetchPeopleList: vi.fn(),
  fetchFilm: vi.fn(),
  searchTmdb: vi.fn(),
  findDuplicates: vi.fn(),
  saveFilm: vi.fn(),
}))
vi.mock('../films/api', () => api)

function renderPage(role: 'admin' | 'moderator' | 'member' | 'viewer', path = '/films/new') {
  const router = createMemoryRouter(
    [
      { path: '/films/new', element: <FilmFormPage /> },
      { path: '/films/:id/edit', element: <FilmFormPage /> },
      { path: '/films/:id', element: <p>Film page</p> },
      { path: '/', element: <p>Films list</p> },
    ].map((r) => ({ ...r, element: <RequireAuth>{r.element}</RequireAuth> })),
    { initialEntries: [path] },
  )
  const fake = createFakeAuthBackend({ session: fakeSession(), profile: fakeProfile({ role }) })
  render(
    <AuthProvider backend={fake.backend}>
      <RouterProvider router={router} />
    </AuthProvider>,
  )
  return router
}

beforeEach(() => {
  vi.clearAllMocks()
  api.fetchPeopleList.mockResolvedValue(PEOPLE)
  api.searchTmdb.mockResolvedValue(RESULTS)
  api.findDuplicates.mockResolvedValue([])
  api.saveFilm.mockResolvedValue(99)
})

describe('add / edit film page', () => {
  it('refuses members and viewers without loading anything', async () => {
    renderPage('member')
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Only moderators and admins can add or edit films.',
    )
    expect(api.fetchPeopleList).not.toHaveBeenCalled()
  })

  it('searches TMDB as you type; watched films cannot be picked; saves and opens the film', async () => {
    const router = renderPage('moderator')
    const search = await screen.findByLabelText('Search TMDB')
    expect(screen.getByLabelText('Screening date')).toHaveValue(comingSaturday())
    fireEvent.change(search, { target: { value: 'g' } })
    fireEvent.change(search, { target: { value: 'gla' } })
    fireEvent.change(search, { target: { value: 'glass' } })
    // Waits on the search debounce.
    const watched = await screen.findByRole('button', { name: /Glass River 2/ }, { timeout: 3000 })
    expect(screen.getByRole('status')).toHaveTextContent('2 matches on TMDB.')
    // Debounced: one search for the final text only.
    expect(api.searchTmdb).toHaveBeenCalledTimes(1)
    expect(api.searchTmdb).toHaveBeenCalledWith('glass')
    // Not selectable, but still focusable so its text can be read.
    expect(watched).toHaveAttribute('aria-disabled', 'true')
    expect(watched).toBeEnabled()
    expect(watched).toHaveTextContent('Already watched on 2026/01/10')
    fireEvent.click(watched)
    expect(screen.queryByRole('button', { name: 'Change film' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Glass River \(2001\)/ }))
    expect(screen.getByRole('button', { name: 'Change film' })).toHaveFocus()

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose who chose the film.')
    expect(api.saveFilm).not.toHaveBeenCalled()

    // Maratona defaults to Manel.
    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'maratona' } })
    expect(screen.getByLabelText('Chosen by')).toHaveValue('p-manel')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/films/99'))
    expect(api.saveFilm).toHaveBeenCalledWith(
      expect.objectContaining<Partial<FilmSaveBody>>({
        tmdb_id: 11,
        kind: 'maratona',
        assigned_id: 'p-manel',
      }),
    )
  })

  it('blocks Save while the film is a duplicate (saving without TMDB)', async () => {
    api.findDuplicates.mockResolvedValue([
      { id: 3, title: 'Glass River', screened_on: '2026-01-24', kind: 'cinema' },
    ])
    renderPage('admin')
    fireEvent.click(await screen.findByRole('button', { name: 'Not on TMDB? Save without TMDB' }))
    expect(screen.getByLabelText('Title')).toHaveFocus()
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'glass river' } })
    fireEvent.change(screen.getByLabelText('Release year'), { target: { value: '2001' } })
    expect(await screen.findByRole('alert', {}, { timeout: 3000 })).toHaveTextContent(
      'Already watched on 2026/01/24 (Cinema): Glass River',
    )
    expect(screen.getByRole('link', { name: 'Glass River' })).toHaveAttribute('href', '/films/3')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(api.findDuplicates).toHaveBeenLastCalledWith({
      title: 'glass river',
      year: 2001,
      tmdbId: null,
      originalTitle: null,
    })
  })

  it('shows a refused save as friendly text', async () => {
    api.saveFilm.mockRejectedValue({
      status: 409,
      error: 'duplicate',
      film: { id: 3, screened_on: '2026-01-10', kind: 'normal' },
    })
    renderPage('moderator')
    fireEvent.click(await screen.findByRole('button', { name: 'Not on TMDB? Save without TMDB' }))
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Home Movie' } })
    fireEvent.change(screen.getByLabelText('Release year'), { target: { value: '2005' } })
    fireEvent.change(screen.getByLabelText('Chosen by'), { target: { value: 'p-cinema' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Already watched on 2026/01/10.')
  })

  it('uses the current search text as the title when saving without TMDB', async () => {
    renderPage('moderator')
    fireEvent.change(await screen.findByLabelText('Search TMDB'), { target: { value: 'first' } })
    fireEvent.change(screen.getByLabelText('Search TMDB'), { target: { value: ' Home Movie ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Not on TMDB? Save without TMDB' }))
    expect(screen.getByLabelText('Title')).toHaveValue('Home Movie')
  })

  it('shows one alert when a save is refused as a duplicate during the check', async () => {
    let finishCheck: (films: unknown[]) => void = () => {}
    api.findDuplicates.mockReturnValue(new Promise((resolve) => (finishCheck = resolve)))
    api.saveFilm.mockRejectedValue({
      status: 409,
      error: 'duplicate',
      film: { id: 3, screened_on: '2026-01-10', kind: 'normal' },
    })
    renderPage('moderator')
    fireEvent.click(await screen.findByRole('button', { name: 'Not on TMDB? Save without TMDB' }))
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Home Movie' } })
    fireEvent.change(screen.getByLabelText('Release year'), { target: { value: '2005' } })
    fireEvent.change(screen.getByLabelText('Chosen by'), { target: { value: 'p-ada' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Already watched on 2026/01/10.')
    await waitFor(() => expect(api.findDuplicates).toHaveBeenCalled(), { timeout: 3000 })
    await act(async () =>
      finishCheck([{ id: 3, title: 'Home Movie', screened_on: '2026-01-10', kind: 'normal' }]),
    )
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(screen.getByRole('alert')).toHaveTextContent('Already watched on 2026/01/10: Home Movie')
  })

  it('edits a film: prefilled, keeps its id, turn-holder optional for old Democrático films', async () => {
    api.fetchFilm.mockResolvedValue({
      film: {
        id: 5,
        tmdb_id: 11,
        title: 'Glass River',
        original_title: 'Rio de Vidro',
        release_year: 2001,
        screened_on: '2026-01-10',
        kind: 'democratico',
        assigned_id: 'p-ada',
        turn_holder_id: null,
        democratico_reason: 'Old reason',
      } as FilmRecord,
      avgScore: null,
      people: PEOPLE,
    } satisfies FilmDetailData)
    // Its own row is not a duplicate of itself.
    api.findDuplicates.mockResolvedValue([
      { id: 5, title: 'Glass River', screened_on: '2026-01-10', kind: 'democratico' },
    ])
    renderPage('moderator', '/films/5/edit')
    expect(await screen.findByRole('heading', { name: 'Edit film' })).toBeInTheDocument()
    expect(await screen.findByText('Glass River')).toBeInTheDocument()
    expect(screen.getByLabelText('Screening date')).toHaveValue('2026-01-10')
    expect(screen.getByLabelText(/Why was it chosen/)).toHaveValue('Old reason')
    fireEvent.change(screen.getByLabelText(/Why was it chosen/), {
      target: { value: ' New\u200b  reason ' },
    })
    fireEvent.change(screen.getByLabelText('Screening date'), { target: { value: '2026-01-17' } })
    await waitFor(() => expect(api.findDuplicates).toHaveBeenCalled(), { timeout: 3000 })
    // Let the check's result land, then: no warning, Save still allowed.
    await act(() => api.findDuplicates.mock.results[0].value)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(api.saveFilm).toHaveBeenCalledWith({
        id: 5,
        tmdb_id: 11,
        screened_on: '2026-01-17',
        kind: 'democratico',
        assigned_id: 'p-ada',
        turn_holder_id: null,
        democratico_reason: 'New reason',
      }),
    )
  })

  it('shows the reason field only for a Democrático, keeps its text across kind changes, saves it only as one', async () => {
    api.saveFilm.mockRejectedValueOnce({ status: 400, error: 'reason_too_long' })
    renderPage('moderator')
    fireEvent.click(await screen.findByRole('button', { name: 'Not on TMDB? Save without TMDB' }))
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Home Movie' } })
    fireEvent.change(screen.getByLabelText('Release year'), { target: { value: '2005' } })
    fireEvent.change(screen.getByLabelText('Chosen by'), { target: { value: 'p-ada' } })
    expect(screen.queryByLabelText(/Why was it chosen/)).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'democratico' } })
    const reason = screen.getByLabelText(/Why was it chosen/)
    // A live count of characters as saved (normalised, code points); no maxlength cut-off.
    expect(reason).not.toHaveAttribute('maxLength')
    const count = screen.getByText('0/200')
    expect(count).toHaveAttribute('aria-live', 'polite')
    expect(reason).toHaveAccessibleDescription('0/200')
    fireEvent.change(reason, { target: { value: '  \u{1F3AC}'.repeat(150) } })
    expect(count).toHaveTextContent('299/200')
    fireEvent.change(reason, { target: { value: 'a'.repeat(201) } })
    fireEvent.change(screen.getByLabelText(/Whose turn/), { target: { value: 'p-manel' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Keep the reason to 200 characters or fewer.',
    )
    expect(api.saveFilm).not.toHaveBeenCalled()
    fireEvent.change(reason, { target: { value: 'Nobody agreed' } })
    expect(count).toHaveTextContent('13/200')
    fireEvent.change(screen.getByLabelText(/Whose turn/), { target: { value: 'p-manel' } })
    // The server's refusal is shown near Save.
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.saveFilm).toHaveBeenCalledTimes(1))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Keep the reason to 200 characters or fewer.',
    )
    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'normal' } })
    expect(screen.queryByLabelText(/Why was it chosen/)).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'democratico' } })
    expect(screen.getByLabelText(/Why was it chosen/)).toHaveValue('Nobody agreed')
    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'normal' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(api.saveFilm).toHaveBeenLastCalledWith(
        expect.objectContaining({ kind: 'normal', democratico_reason: null }),
      ),
    )
  })
})
