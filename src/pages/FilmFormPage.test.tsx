import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
    const watched = await screen.findByRole('button', { name: /Glass River 2/ })
    // Debounced: one search for the final text only.
    expect(api.searchTmdb).toHaveBeenCalledTimes(1)
    expect(api.searchTmdb).toHaveBeenCalledWith('glass')
    expect(watched).toBeDisabled()
    expect(watched).toHaveTextContent('Already watched on 2026/01/10')

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
    expect(await screen.findByRole('alert')).toHaveTextContent(
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
    fireEvent.change(screen.getByLabelText('Screening date'), { target: { value: '2026-01-17' } })
    await waitFor(() => expect(api.findDuplicates).toHaveBeenCalled())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(api.saveFilm).toHaveBeenCalledWith({
        id: 5,
        tmdb_id: 11,
        screened_on: '2026-01-17',
        kind: 'democratico',
        assigned_id: 'p-ada',
        turn_holder_id: null,
      }),
    )
  })
})
