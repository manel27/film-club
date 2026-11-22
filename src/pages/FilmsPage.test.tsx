import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '../auth/AuthProvider'
import type { FilmsData } from '../films/api'
import type { FilmItem } from '../films/films'
import { createFakeAuthBackend, fakeProfile, fakeSession } from '../test/fakeAuthBackend'
import FilmsPage from './FilmsPage'

const film = (f: Partial<FilmItem> & Pick<FilmItem, 'id' | 'title' | 'screenedOn'>): FilmItem => ({
  releaseYear: 2001,
  posterPath: null,
  genres: [],
  dayOrder: 1,
  kind: 'normal',
  assignedId: 'p-ada',
  presentIds: [],
  avgScore: null,
  isEasterEgg: false,
  ...f,
})

const DATA: FilmsData = {
  people: [
    { id: 'p-ada', name: 'Ada', colour: '#ff0000', isSystem: false },
    { id: 'p-bo', name: 'Bo', colour: '#00ff00', isSystem: false },
    { id: 'p-cinema', name: 'Cinema', colour: '#999999', isSystem: true },
  ],
  films: [
    film({
      id: 1,
      title: 'Glass River',
      screenedOn: '2026-11-14',
      presentIds: ['p-bo', 'p-ada'],
      avgScore: 7.5,
      posterPath: '/glass.jpg',
      genres: ['Drama'],
    }),
    film({
      id: 2,
      title: 'Night Bus',
      screenedOn: '2026-11-07',
      kind: 'cinema',
      assignedId: 'p-cinema',
    }),
    film({ id: 3, title: 'Shark Joke', screenedOn: '2025-06-14', kind: 'democratico' }),
  ],
  scored: new Set([1]),
}

const fetchFilmsData = vi.fn(async (): Promise<FilmsData> => DATA)
vi.mock('../films/api', () => ({ fetchFilmsData: () => fetchFilmsData() }))
// The card has its own tests (NextUp.test.tsx).
vi.mock('../components/NextUp', () => ({ default: () => <p>Next up card</p> }))

function renderPage(
  path: string | { pathname: string; state: unknown } = '/',
  role: 'member' | 'viewer' = 'member',
) {
  const router = createMemoryRouter([{ path: '/', element: <FilmsPage /> }], {
    initialEntries: [path],
  })
  const fake = createFakeAuthBackend({ session: fakeSession(), profile: fakeProfile({ role }) })
  render(
    <AuthProvider backend={fake.backend}>
      <RouterProvider router={router} />
    </AuthProvider>,
  )
  return router
}

beforeEach(() => localStorage.clear())

describe('films page', () => {
  it('lists films by week with year, kind, average and present people', async () => {
    renderPage()
    const heading = await screen.findByRole('heading', { name: '2026/11/14' }, { timeout: 3000 })
    const row = within(heading.closest('section')!).getByRole('listitem')
    expect(row).toHaveTextContent('Glass River (2001)')
    expect(within(row).getByText('Chosen by Ada')).toHaveClass('sr-only')
    // The dot links to the profile for the mouse only: no Tab stop, hidden from screen readers.
    const dotLink = row.querySelector('a.dot-link')
    expect(dotLink).toHaveAttribute('href', '/people/p-ada')
    expect(dotLink).toHaveAttribute('tabindex', '-1')
    expect(dotLink).toHaveAttribute('aria-hidden', 'true')
    expect(within(row).queryByRole('link', { name: /Chosen by/ })).not.toBeInTheDocument()
    // A system chooser's dot is not a link.
    const cinema = screen.getByRole('img', { name: 'Chosen by Cinema' })
    expect(cinema.tagName).toBe('SPAN')
    expect(cinema.closest('a')).toBeNull()
    expect(row.querySelector('.film-avg')).toHaveTextContent('Average 7.50')
    expect(screen.getAllByText('No average')).toHaveLength(2)
    const present = within(row).getByRole('group', { name: 'Present' })
    expect(
      within(present)
        .getAllByRole('img')
        .map((d) => d.getAttribute('aria-label')),
    ).toEqual(['Ada', 'Bo'])
    expect(screen.getByText('Cinema', { selector: '.badge' })).toBeInTheDocument()
    expect(screen.getByText('Democrático', { selector: '.badge' })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      '2026/11/14',
      '2026/11/07',
      '2025/06/14',
    ])
  })

  it('keeps sort and filters in the URL and localStorage', async () => {
    const router = renderPage()
    fireEvent.change(await screen.findByLabelText('Sort'), { target: { value: 'oldest' } })
    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'cinema' } })
    expect(screen.getByText('1 film')).toBeInTheDocument()
    expect(router.state.location.search).toBe('?sort=oldest&kind=cinema')
    expect(localStorage.getItem('film-club-films')).toBe('sort=oldest&kind=cinema')

    // Clearing the filters keeps the sort (and view).
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(screen.getByText('3 films')).toBeInTheDocument()
    expect(router.state.location.search).toBe('?sort=oldest')
  })

  it('ignores filter values that match nothing, and offers to clear an empty result', async () => {
    const router = renderPage(
      '/?genre=Nope&year=abc&assigned=gone&present=gone,p-bo&kind=bogus&junk=1',
    )
    expect(await screen.findByText('1 film')).toBeInTheDocument() // only present=p-bo applies
    expect(screen.getByLabelText('Genre')).toHaveValue('')
    expect(screen.getByLabelText('Year shown')).toHaveValue('')

    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'maratona' } })
    expect(router.state.location.search).toBe('?present=p-bo&kind=maratona')
    expect(screen.getByText('No films match these filters.')).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: 'Clear filters' })[1])
    expect(screen.getByText('3 films')).toBeInTheDocument()
  })

  it('says so when there are no films at all', async () => {
    fetchFilmsData.mockResolvedValueOnce({ films: [], people: [], scored: new Set() })
    renderPage()
    expect(await screen.findByText('No films yet.')).toBeInTheDocument()
  })

  it('restores the last choice when opened without one', async () => {
    localStorage.setItem('film-club-films', 'view=posters&year=2025')
    const router = renderPage()
    expect(await screen.findByRole('img', { name: 'Shark Joke (2001)' })).toBeInTheDocument()
    expect(router.state.location.search).toBe('?view=posters&year=2025')
    expect(screen.getByRole('button', { name: 'Posters by week' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('shows a notice passed by the previous page (a deleted film), even after restoring the view', async () => {
    localStorage.setItem('film-club-films', 'view=posters')
    const router = renderPage({ pathname: '/', state: { notice: 'Deleted "Old Film".' } })
    await waitFor(() => expect(router.state.location.search).toBe('?view=posters'))
    expect(screen.getByText('Deleted "Old Film".')).toHaveAttribute('role', 'status')
    expect(screen.getByText('Deleted "Old Film".')).toHaveFocus()
  })

  it('does not bring the saved choice back when the visitor empties the URL', async () => {
    const router = renderPage('/?view=posters')
    fireEvent.click(await screen.findByRole('button', { name: 'List' }))
    expect(router.state.location.search).toBe('')
    expect(screen.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true')
    expect(localStorage.getItem('film-club-films')).toBe('')
  })

  it('still restores after clicking the view that is already active', async () => {
    localStorage.setItem('film-club-films', 'year=2025')
    const router = renderPage()
    await screen.findByText('1 film')
    fireEvent.click(screen.getByRole('button', { name: 'List' }))
    await act(() => router.navigate('/'))
    await waitFor(() => expect(router.state.location.search).toBe('?year=2025'))
  })

  it('restores only known keys from a corrupt localStorage value', async () => {
    localStorage.setItem('film-club-films', '{bad json')
    const router = renderPage()
    await screen.findByText('3 films')
    expect(router.state.location.search).toBe('')
  })

  it('can show posters in one grid without week headings', async () => {
    const router = renderPage('/?view=posters')
    await screen.findByText('3 films')
    const grid = screen.getByRole('button', { name: 'Poster grid' })
    expect(grid).toHaveAttribute('title', 'Poster grid')
    fireEvent.click(grid)
    expect(grid).toHaveAttribute('aria-pressed', 'true')
    expect(router.state.location.search).toBe('?view=grid')
    expect(screen.queryAllByRole('heading', { level: 2 })).toHaveLength(0)
    expect(
      screen
        .getAllByRole('img', { name: /\(2001\)$/ })
        .map((i) => i.getAttribute('aria-label') ?? i.getAttribute('alt')),
    ).toEqual(['Glass River (2001)', 'Night Bus (2001)', 'Shark Joke (2001)'])
    expect(localStorage.getItem('film-club-films')).toBe('view=grid')
  })

  it('sorts by average as a flat list with screening dates', async () => {
    const router = renderPage()
    fireEvent.change(await screen.findByLabelText('Sort'), { target: { value: 'score-desc' } })
    expect(router.state.location.search).toBe('?sort=score-desc')
    expect(localStorage.getItem('film-club-films')).toBe('sort=score-desc')
    expect(screen.queryAllByRole('heading', { level: 2 })).toHaveLength(0)
    expect(
      screen.getAllByRole('listitem').map((r) => r.querySelector('.film-date')?.textContent),
    ).toEqual(['2026/11/14', '2026/11/07', '2025/06/14'])
    // Film links only (the "chosen by" dots link to profiles).
    const films = screen
      .getAllByRole('link')
      .filter((l) => l.getAttribute('href')?.startsWith('/films/'))
    expect(films.map((l) => l.textContent)).toEqual(['Glass River', 'Night Bus', 'Shark Joke'])
  })

  it('shows posters by week as the grid, with the averages, when not sorted by date', async () => {
    const router = renderPage('/?view=posters&sort=score-desc')
    await screen.findByText('3 films')
    const byWeek = screen.getByRole('button', { name: 'Posters by week' })
    expect(byWeek).toHaveAttribute('aria-disabled', 'true')
    expect(byWeek).toHaveAttribute('aria-pressed', 'false')
    expect(byWeek).toHaveAttribute('title', 'Posters by week: only when sorted by screening date')
    expect(screen.getByRole('button', { name: 'Poster grid' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.queryAllByRole('heading', { level: 2 })).toHaveLength(0)
    expect(
      screen
        .getAllByRole('listitem')
        .map((t) => [t.title, t.querySelector('.poster-note')?.textContent]),
    ).toEqual([
      ['Glass River (2001)', 'Average 7.50'],
      ['Night Bus (2001)', 'Average –'],
      ['Shark Joke (2001)', 'Average –'],
    ])

    fireEvent.click(byWeek)
    expect(router.state.location.search).toBe('?view=posters&sort=score-desc')

    // Back to a date sort, the weeks return.
    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'newest' } })
    expect(byWeek).not.toHaveAttribute('aria-disabled')
    expect(byWeek).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(3)
    expect(document.querySelector('.poster-note')).toBeNull()
  })

  it('renders no empty list when nothing matches a flat sort', async () => {
    renderPage('/?sort=title&kind=maratona')
    expect(await screen.findByText('No films match these filters.')).toBeInTheDocument()
    expect(document.querySelector('.film-list, .poster-grid')).toBeNull()
  })

  it('falls back to the default sort for an unknown value', async () => {
    renderPage('/?sort=bogus')
    expect(await screen.findByLabelText('Sort')).toHaveValue('newest')
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(3)
  })

  it('closes the present filter on a click outside or Escape', async () => {
    renderPage()
    const summary = await screen.findByText('Present', { selector: 'summary' })
    const details = summary.closest('details')!
    fireEvent.click(summary)
    expect(details.open).toBe(true)
    fireEvent.pointerDown(screen.getByText('Present at the screening'))
    expect(details.open).toBe(true)
    fireEvent.pointerDown(document.body)
    expect(details.open).toBe(false)

    fireEvent.click(summary)
    fireEvent.keyDown(screen.getByRole('checkbox', { name: 'Bo' }), { key: 'Escape' })
    expect(details.open).toBe(false)
    expect(summary).toHaveFocus()
  })

  it('shows TMDB posters lazily, and a text placeholder without one', async () => {
    renderPage('/?view=posters')
    const img = await screen.findByRole('img', { name: 'Glass River (2001)' })
    expect(img).toHaveAttribute('src', 'https://image.tmdb.org/t/p/w185/glass.jpg')
    expect(img).toHaveAttribute('loading', 'lazy')
    expect(screen.getByRole('img', { name: 'Night Bus (2001)' })).toHaveTextContent('Night Bus')
  })

  it('filters on present people and films I have not scored', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Bo' }))
    expect(screen.getByText('1 film')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Bo' }))
    fireEvent.click(screen.getByLabelText("I haven't scored"))
    expect(screen.getByText('2 films')).toBeInTheDocument()
    expect(screen.queryByText('Glass River')).not.toBeInTheDocument()
  })

  it('has no "I haven\'t scored" filter for viewers', async () => {
    renderPage('/?unscored=1', 'viewer')
    await screen.findByText('3 films') // a hidden filter is never active
    expect(screen.queryByLabelText("I haven't scored")).not.toBeInTheDocument()
  })

  it('offers a retry when loading fails', async () => {
    fetchFilmsData.mockRejectedValueOnce(new Error('offline'))
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load the films")
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('3 films')).toBeInTheDocument()
  })
})
