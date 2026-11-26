import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
    { id: 'p-ada', name: 'Ada', colour: '#ff0000', isSystem: false, role: 'admin' },
    { id: 'p-bo', name: 'Bo', colour: '#00ff00', isSystem: false, role: 'viewer' },
    { id: 'p-cinema', name: 'Cinema', colour: '#999999', isSystem: true, role: 'viewer' },
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
  it('lists films in one flat list: chooser, title, year, rating, present names, date and kind', async () => {
    renderPage()
    const title = await screen.findByRole('link', { name: 'Glass River' }, { timeout: 3000 })
    const row = title.closest('li')!
    expect(row.querySelector('.film-title')).toHaveTextContent(/· Glass River \(2001\)$/)
    // The chooser is a name chip linking to their profile, described by their role.
    const chooser = within(row.querySelector('.film-title')!).getByRole('link', { name: 'Ada' })
    expect(chooser).toHaveAttribute('href', '/people/p-ada')
    expect(chooser).toHaveAccessibleDescription('Admin')
    expect(within(row).getByText('Chosen by')).toHaveClass('sr-only')
    // The emoji is decorative; the rating is read as words.
    const avg = row.querySelector('.film-avg')!
    expect(within(avg as HTMLElement).getByText('7.50 👌')).toHaveAttribute('aria-hidden', 'true')
    expect(avg).toHaveTextContent('average 7.50, good')
    const present = within(row).getByRole('group', { name: 'Present' })
    expect(
      within(present)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['Ada', 'Bo'])
    expect(within(present).getByRole('link', { name: 'Bo' })).toHaveAccessibleDescription('Viewer')
    // A system chooser's chip is no link and has no role tip.
    const nightBus = screen.getByRole('link', { name: 'Night Bus' }).closest('li')!
    const cinema = within(nightBus).getByText('Cinema', { selector: '.chip' })
    expect(cinema.tagName).toBe('SPAN')
    expect(within(nightBus).queryByRole('tooltip', { hidden: true })).toBeNull()
    expect(within(nightBus).getByText('Cinema', { selector: '.badge' })).toBeInTheDocument()
    // No scores: a dash and no emoji.
    expect(nightBus.querySelector('.film-avg')).toHaveTextContent(/^–No average$/)
    // The Democrático's reason (none recorded) is read, but adds no Tab stop to the row.
    const demo = screen.getByText('Democrático', { selector: '.badge' })
    expect(demo).toHaveAccessibleDescription('Unknown reason')
    expect(demo).not.toHaveAttribute('tabindex')
    // No week headings: each row carries its date.
    expect(screen.queryAllByRole('heading', { level: 2 })).toHaveLength(0)
    expect(
      screen.getAllByRole('listitem').map((r) => r.querySelector('.film-date')?.textContent),
    ).toEqual(['2026/11/14', '2026/11/07', '2025/06/14'])
  })

  it('shows "Unknown" for a chooser or present person who is not in the list', async () => {
    fetchFilmsData.mockResolvedValueOnce({
      ...DATA,
      films: [
        film({
          id: 9,
          title: 'Lost',
          screenedOn: '2026-01-01',
          assignedId: 'gone',
          presentIds: ['gone'],
        }),
      ],
    })
    renderPage()
    const row = (await screen.findByRole('link', { name: 'Lost' })).closest('li')!
    expect(within(row).getAllByText('Unknown', { selector: '.chip' })).toHaveLength(2)
  })

  it('gives the easter egg no emoji, whatever its average', async () => {
    fetchFilmsData.mockResolvedValueOnce({
      ...DATA,
      films: [
        film({ id: 9, title: 'Egg', screenedOn: '2025-01-01', avgScore: 9.9, isEasterEgg: true }),
      ],
    })
    renderPage()
    const row = (await screen.findByRole('link', { name: 'Egg' })).closest('li')!
    expect(row.querySelector('.film-avg')).toHaveTextContent(/^9\.90average 9\.90$/)
  })

  it('Escape hides a hovered role tip with focus anywhere, until focus or the pointer moves', async () => {
    renderPage()
    const ada = (await screen.findAllByRole('link', { name: 'Ada' }))[0]
    const list = ada.closest('ul')!
    fireEvent.pointerOver(ada)
    expect(document.activeElement).toBe(document.body)
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(list).toHaveClass('tips-off')
    fireEvent.pointerOver(ada)
    expect(list).not.toHaveClass('tips-off')
    fireEvent.keyDown(document.body, { key: 'Enter' })
    expect(list).not.toHaveClass('tips-off')
    fireEvent.keyDown(document.body, { key: 'Escape' })
    fireEvent.focusIn(ada)
    expect(list).not.toHaveClass('tips-off')
  })

  it('keeps one Tab stop per film: the name chips are mouse shortcuts', async () => {
    renderPage('/?view=posters')
    await screen.findByText('3 films')
    for (const row of screen.getAllByRole('listitem')) {
      const tabbable = [...row.querySelectorAll('a, button, [tabindex]')].filter(
        (el) => el.getAttribute('tabindex') !== '-1',
      )
      expect(tabbable.map((el) => el.getAttribute('href'))).toEqual([
        expect.stringMatching(/^\/films\/\d+$/),
      ])
    }
    // Still links with their role for screen readers (browse mode) and the mouse.
    const chip = within(screen.getAllByRole('listitem')[0]).getAllByRole('link', { name: 'Ada' })[0]
    expect(chip).toHaveAttribute('href', '/people/p-ada')
    expect(chip).toHaveAccessibleDescription('Admin')
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
    localStorage.setItem('film-club-films', 'view=list&year=2025')
    const router = renderPage()
    expect(await screen.findByText('1 film')).toBeInTheDocument()
    expect(router.state.location.search).toBe('?view=list&year=2025')
    expect(screen.getByRole('button', { name: 'Compact' })).toHaveAttribute('aria-pressed', 'true')
    expect(document.querySelector('.film-row .film-thumb')).toBeNull()
  })

  it('shows a notice passed by the previous page (a deleted film), even after restoring the view', async () => {
    localStorage.setItem('film-club-films', 'view=list')
    const router = renderPage({ pathname: '/', state: { notice: 'Deleted "Old Film".' } })
    await waitFor(() => expect(router.state.location.search).toBe('?view=list'))
    expect(screen.getByText('Deleted "Old Film".')).toHaveAttribute('role', 'status')
    expect(screen.getByText('Deleted "Old Film".')).toHaveFocus()
  })

  it('does not bring the saved choice back when the visitor empties the URL', async () => {
    const router = renderPage('/?view=list')
    fireEvent.click(await screen.findByRole('button', { name: 'Poster list' }))
    expect(router.state.location.search).toBe('')
    expect(screen.getByRole('button', { name: 'Poster list' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(localStorage.getItem('film-club-films')).toBe('')
  })

  it('still restores after clicking the view that is already active', async () => {
    localStorage.setItem('film-club-films', 'year=2025')
    const router = renderPage()
    await screen.findByText('1 film')
    fireEvent.click(screen.getByRole('button', { name: 'Poster list' }))
    await act(() => router.navigate('/'))
    await waitFor(() => expect(router.state.location.search).toBe('?year=2025'))
  })

  it('restores only known keys from a corrupt localStorage value', async () => {
    localStorage.setItem('film-club-films', '{bad json')
    const router = renderPage()
    await screen.findByText('3 films')
    expect(router.state.location.search).toBe('')
  })

  it('shows the poster grid, each poster linking to its film with date, chooser and rating', async () => {
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
    // The details are part of the link, so screen readers hear them.
    const glass = screen.getByRole('link', { name: /^Glass River \(2001\)/ })
    expect(glass).toHaveAttribute('href', '/films/1')
    expect(glass).toHaveAccessibleName(
      'Glass River (2001), 2026/11/14, chosen by Ada, average 7.50, good',
    )
    expect(screen.getByRole('link', { name: /^Night Bus/ })).toHaveAccessibleName(
      /^Night Bus \(2001\) ?, 2026\/11\/07, chosen by Cinema, No average$/, // the placeholder is a block: jsdom adds a space
    )
    expect(localStorage.getItem('film-club-films')).toBe('view=grid')
  })

  it('keeps the poster list with any sort, a thumbnail on each row', async () => {
    const router = renderPage('/?sort=title')
    await screen.findByText('3 films')
    expect(screen.getByRole('button', { name: 'Poster list' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: 'Poster list' })).not.toHaveAttribute('aria-disabled')
    expect(router.state.location.search).toBe('?sort=title')
    const rows = screen.getAllByRole('listitem')
    expect(rows.map((r) => r.querySelector('.film-title a[href^="/films/"]')?.textContent)).toEqual(
      ['Glass River', 'Night Bus', 'Shark Joke'],
    )
    // Decorative thumbnails (the title follows): the TMDB one, else a placeholder.
    expect(rows[0].querySelector('img.film-thumb')).toHaveAttribute(
      'src',
      'https://image.tmdb.org/t/p/w92/glass.jpg',
    )
    expect(rows[0].querySelector('img.film-thumb')).toHaveAttribute('alt', '')
    expect(rows[1].querySelector('.film-thumb')).toHaveAttribute('aria-hidden', 'true')
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
    // Film links only (the name chips link to profiles).
    const films = screen
      .getAllByRole('link')
      .filter((l) => l.getAttribute('href')?.startsWith('/films/'))
    expect(films.map((l) => l.textContent)).toEqual(['Glass River', 'Night Bus', 'Shark Joke'])
  })

  it("shows each poster's release year in the grid only when sorted by release year", async () => {
    renderPage('/?view=grid&sort=year-desc')
    await screen.findByText('3 films')
    expect([...document.querySelectorAll('.poster-note')].map((n) => n.textContent)).toEqual([
      '2001',
      '2001',
      '2001',
    ])
    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'score-desc' } })
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
    expect(
      screen.getAllByRole('listitem').map((r) => r.querySelector('.film-date')?.textContent),
    ).toEqual(['2026/11/14', '2026/11/07', '2025/06/14'])
  })

  it.each(['/', '/?view=mosaic', '/?view=posters'])(
    'opens the poster list for %s (default, unknown view, old link)',
    async (url) => {
      renderPage(url)
      await screen.findByText('3 films')
      expect(screen.getByRole('button', { name: 'Poster list' })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
      expect(document.querySelector('.film-row .film-thumb')).toBeInTheDocument()
    },
  )

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
    renderPage('/?view=grid')
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

describe('next film card', () => {
  // Only Date is faked, so the page's promises and timers still run.
  const at = (iso: string) => vi.useFakeTimers({ toFake: ['Date'], now: new Date(iso) })
  afterEach(() => vi.useRealTimers())
  const withFilms = (...films: FilmItem[]) =>
    fetchFilmsData.mockResolvedValueOnce({ ...DATA, films: [...DATA.films, ...films] })

  it('shows the earliest film added for a coming screening, lowest day_order first, instead of "Next up"', async () => {
    at('2026-11-26T10:00:00Z')
    withFilms(
      film({ id: 10, title: 'Later', screenedOn: '2026-12-12' }),
      film({ id: 11, title: 'Second', screenedOn: '2026-12-05', dayOrder: 2 }),
      film({
        id: 12,
        title: 'First',
        screenedOn: '2026-12-05',
        kind: 'maratona',
        posterPath: '/first.jpg',
        releaseYear: 1999,
      }),
    )
    renderPage()
    const card = await screen.findByRole('region', { name: 'Next film' })
    expect(screen.queryByText('Next up card')).toBeNull()
    // The whole card links to the film (CSS stretches the title link over it).
    const link = within(card).getByRole('link', { name: 'First' })
    expect(link).toHaveAttribute('href', '/films/12')
    expect(link).toHaveAccessibleDescription('Sat 5 Dec 2026 Maratona')
    expect(card).toHaveTextContent('First (1999)')
    expect(card).toHaveTextContent('Sat 5 Dec 2026')
    expect(within(card).getByText('Maratona', { selector: '.badge' })).toBeInTheDocument()
    expect(card.querySelector('img')).toHaveAttribute(
      'src',
      'https://image.tmdb.org/t/p/w185/first.jpg',
    )
    expect(card.querySelector('img')).toHaveAttribute('alt', '')
    const chooser = within(card).getByRole('link', { name: 'Ada' })
    expect(chooser).toHaveAttribute('href', '/people/p-ada')
    expect(chooser).toHaveAccessibleDescription('Admin')
    expect(chooser).not.toHaveAttribute('tabindex') // a Tab stop here, so the tip shows on focus
    expect(card).toHaveTextContent('Chosen by Ada')
  })

  it('says Today on the screening day in Lisbon, with a placeholder when there is no poster', async () => {
    // 23:30 UTC on 13 June is already 14 June in Lisbon (UTC+1).
    at('2026-06-13T23:30:00Z')
    withFilms(film({ id: 10, title: 'Tonight', screenedOn: '2026-06-14', assignedId: 'p-cinema' }))
    renderPage()
    const card = await screen.findByRole('region', { name: 'Next film' })
    expect(card).toHaveTextContent('Today')
    expect(card.querySelector('.poster-placeholder')).toHaveAttribute('aria-hidden', 'true')
    // A system chooser is shown but never linked.
    expect(within(card).getByText('Cinema', { selector: '.chip' }).tagName).toBe('SPAN')
  })

  it('keeps the rotation card when only the easter egg or past films are ahead', async () => {
    at('2026-11-26T10:00:00Z')
    withFilms(film({ id: 10, title: 'Egg', screenedOn: '2026-12-05', isEasterEgg: true }))
    renderPage()
    expect(await screen.findByText('Next up card')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Next film' })).toBeNull()
  })
})
