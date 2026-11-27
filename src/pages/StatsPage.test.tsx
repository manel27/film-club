import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Person } from '../films/films'
import StatsPage from './StatsPage'

const people: Person[] = [
  { id: 'p-ada', name: 'Ada', colour: '#ff0000', isSystem: false, role: 'admin' },
  { id: 'p-bo', name: 'Bo', colour: null, isSystem: false, role: 'viewer' },
  { id: 'p-cy', name: 'Cy', colour: '#0000ff', isSystem: false, role: 'member' },
  { id: 'p-cin', name: 'Cinema', colour: '#999999', isSystem: true, role: 'member' },
]

// stats_data()'s shape: films [id, title, year, date, kind, assigned, genres, directors, runtime].
const RAW = {
  films: [
    [
      1,
      'Glass River',
      2001,
      '2026-03-01',
      'normal',
      'p-ada',
      ['Drama', 'Psychological Thriller'],
      ['Rui'],
      100,
    ],
    [2, 'Night Bus', 1995, '2025-05-01', 'cinema', 'p-cin', [], [], null],
    // In the future: the database leaves these out, and so does the page.
    [3, 'Far Future', 2020, '2999-01-01', 'normal', 'p-ada', ['Drama'], [], 90],
    // Malformed: skipped, never a crash.
    ['x', 'Broken', null, 'not a date'],
  ],
  scores: [
    [1, 'p-ada', 8],
    [1, 'p-bo', 7],
    [1, 'p-cy', 6],
    [2, 'p-ada', 9],
    [2, 'p-bo', 5],
    [3, 'p-ada', 1],
    [1, 'p-cy', 'ten'],
  ],
  attendance: [
    [1, 'p-ada'],
    [1, 'p-bo'],
    [2, 'p-ada'],
    [2, 'p-cin'],
    [3, 'p-bo'],
  ],
}

const fetchStatsData = vi.fn(async (): Promise<unknown> => RAW)
vi.mock('../stats/api', () => ({ fetchStatsData: () => fetchStatsData() }))
vi.mock('../films/api', () => ({ fetchPeopleList: async () => people }))

function renderPage(path = '/stats') {
  const router = createMemoryRouter([{ path: '/stats', element: <StatsPage /> }], {
    initialEntries: [path],
  })
  render(<RouterProvider router={router} />)
  return router
}

/** The value shown next to an overview label. */
const fact = (label: string) =>
  screen.getByText(label, { selector: 'dt' }).nextElementSibling?.textContent

const table = (name: string) => screen.getByRole('table', { name })

/** The data cells (not the row header) of the row with the link `name`, one text each. */
const cells = (tableName: string, name: string) => {
  // By the name's link: the header's own text includes the role tip ("AdaAdmin").
  const link = within(table(tableName)).getByRole('link', { name })
  return within(link.closest('tr')!)
    .getAllByRole('cell')
    .map((c) => c.textContent)
}

beforeEach(() => {
  fetchStatsData.mockImplementation(async () => RAW)
})

describe('StatsPage', () => {
  it('shows a loading state, then the all-time overview', async () => {
    renderPage()
    expect(screen.getByRole('status')).toHaveTextContent('Loading stats…')
    expect(await screen.findByText('Films screened')).toBeInTheDocument()
    expect(fact('Films screened')).toBe('2')
    expect(fact('Scores given')).toBe('5')
    // Film averages 7.00 and 7.00.
    expect(fact('Club average')).toContain('7.00 👌')
    expect(fact('Average attendance')).toBe('2.00')
    expect(fact('Normal')).toBe('1')
    expect(fact('Cinema')).toBe('1')
    expect(fact('First screening')).toBe('Thu 1 May 2025')
    expect(fact('Last screening')).toBe('Sun 1 Mar 2026')
    expect(screen.getByLabelText('Period')).toHaveValue('')
  })

  it('leaves out films screened after today, and malformed rows', async () => {
    renderPage('/stats?tab=people')
    await screen.findByRole('table', { name: 'Attendance' })
    expect(screen.queryByText(/Far Future/)).toBeNull()
    expect(screen.queryByText(/Broken/)).toBeNull()
    // Far Future's attendance isn't counted either: Bo was present once, not twice.
    expect(cells('Attendance', 'Bo')).toEqual(['1', '50%'])
  })

  it('shows an error with role="alert", and Try again loads the stats', async () => {
    fetchStatsData.mockRejectedValueOnce(new Error('offline'))
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load the stats.")
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Stats' })).toHaveFocus()
    expect(await screen.findByText('Films screened')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('reads the year from the URL', async () => {
    renderPage('/stats?year=2025')
    await screen.findByText('Films screened')
    expect(screen.getByLabelText('Period')).toHaveValue('2025')
    expect(fact('Films screened')).toBe('1')
    expect(fact('Scores given')).toBe('2')
    expect(fact('Cinema')).toBe('1')
    expect(fact('Normal')).toBe('0')
  })

  it.each(['abc', '1999', '2999', '2025,5', '%E2%80%8B2025', ''])(
    'falls back to All time for ?year=%s',
    async (value) => {
      renderPage(`/stats?year=${value}`)
      await screen.findByText('Films screened')
      expect(screen.getByLabelText('Period')).toHaveValue('')
      expect(fact('Films screened')).toBe('2')
    },
  )

  it('offers only years with screenings, newest first', async () => {
    renderPage()
    await screen.findByText('Films screened')
    const options = within(screen.getByLabelText('Period')).getAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual(['All time', '2026', '2025'])
  })

  it('changing the year updates the URL and every tab, without loading again', async () => {
    const router = renderPage('/stats?tab=people')
    await screen.findByRole('table', { name: 'Attendance' })
    fireEvent.change(screen.getByLabelText('Period'), { target: { value: '2026' } })
    // The tab stays; the year joins it.
    expect(router.state.location.search).toBe('?tab=people&year=2026')
    expect(screen.getByRole('tab', { name: 'People' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Showing 2026: 1 film screened.')).toBeInTheDocument()
    expect(within(table('Attendance')).queryByText('Ada')).toBeInTheDocument()
    // Changing the tab keeps the year.
    fireEvent.click(screen.getByRole('tab', { name: 'Films' }))
    expect(router.state.location.search).toBe('?tab=films&year=2026')
    expect(within(table('Most attended')).queryByText(/Night Bus/)).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }))
    expect(router.state.location.search).toBe('?year=2026')
    expect(fact('Films screened')).toBe('1')
    fireEvent.change(screen.getByLabelText('Period'), { target: { value: '' } })
    expect(router.state.location.search).toBe('')
    expect(fact('Films screened')).toBe('2')
    expect(fetchStatsData).toHaveBeenCalledTimes(1)
  })

  it('ranks films with at least 3 scores only, says so, and links each film', async () => {
    renderPage('/stats?tab=films')
    await screen.findByRole('table', { name: 'Highest average' })
    const top = table('Highest average')
    // Glass River has 3 scores; Night Bus only 2.
    expect(within(top).getByRole('link', { name: 'Glass River (2001)' })).toHaveAttribute(
      'href',
      '/films/1',
    )
    expect(within(top).queryByText(/Night Bus/)).toBeNull()
    expect(screen.getAllByText('Films with at least 3 scores')).toHaveLength(2)
    // Captions name the tables; header cells have scopes.
    expect(within(top).getByRole('columnheader', { name: 'Average' })).toHaveAttribute(
      'scope',
      'col',
    )
    expect(within(top).getByRole('rowheader', { name: 'Glass River (2001)' })).toBeInTheDocument()
  })

  it('never ranks a system profile as a person', async () => {
    renderPage('/stats?tab=people')
    await screen.findByRole('table', { name: 'Attendance' })
    const attendance = table('Attendance')
    expect(within(attendance).getByRole('link', { name: 'Ada' })).toBeInTheDocument()
    expect(within(attendance).queryByText('Cinema')).toBeNull()
    // Ada was at both screenings, Bo at one.
    expect(cells('Attendance', 'Ada')).toEqual(['2', '100%'])
  })

  it('says when a ranking has nobody in it', async () => {
    renderPage('/stats?tab=people')
    await screen.findByRole('table', { name: 'Best chooser' })
    expect(within(table('Best chooser')).getByText('None in this period.')).toBeInTheDocument()
  })

  it('shows films, average and attendance per year, then per month for one year', async () => {
    renderPage()
    await screen.findByText('Films screened')
    const byYear = table('By year')
    expect(
      within(byYear)
        .getAllByRole('rowheader')
        .map((c) => c.textContent),
    ).toEqual(['2025', '2026'])
    // Night Bus (2025): averages 9 and 5 → 7.00; Ada and Cinema present.
    const row2025 = within(within(byYear).getByRole('rowheader', { name: '2025' }).closest('tr')!)
    expect(row2025.getAllByRole('cell').map((c) => c.textContent)).toEqual([
      '1',
      '7.00 👌average 7.00, good',
      '2.00',
    ])
    expect(within(byYear).getByRole('columnheader', { name: 'Attendance' })).toHaveAttribute(
      'scope',
      'col',
    )

    fireEvent.change(screen.getByLabelText('Period'), { target: { value: '2026' } })
    const byMonth = table('By month in 2026')
    expect(
      within(byMonth)
        .getAllByRole('rowheader')
        .map((c) => c.textContent),
    ).toEqual(['March'])
    expect(screen.queryByRole('table', { name: 'By year' })).toBeNull()
  })

  it('draws the over-time chart on Overview and the genre and decade charts on Breakdowns, hidden from screen readers and Tab', async () => {
    renderPage()
    await screen.findByText('Films screened')
    const charts = () => [...document.querySelectorAll<HTMLElement>('.stats-chart')]
    const hidden = (chart: HTMLElement) => {
      expect(chart).toHaveAttribute('aria-hidden', 'true')
      expect(chart.querySelector('svg')).not.toBeNull()
      expect(chart.querySelector('[tabindex]:not([tabindex="-1"])')).toBeNull()
    }
    expect(charts()).toHaveLength(2)
    charts().forEach(hidden)
    const [films, average] = charts()
    // Two stacked charts, each with its title and the periods on its x-axis.
    expect(within(films).getByText('Films')).toBeInTheDocument()
    expect(within(average).getByText('Average score')).toBeInTheDocument()
    expect(within(films).getByText('2025')).toBeInTheDocument()
    expect(within(average).getByText('2026')).toBeInTheDocument()
    // Even ticks on the 0–10 score axis.
    for (const tick of ['0', '2', '4', '6', '8', '10']) {
      expect(within(average).getByText(tick)).toBeInTheDocument()
    }

    fireEvent.click(screen.getByRole('tab', { name: 'Breakdowns' }))
    expect(charts()).toHaveLength(2)
    charts().forEach(hidden)
    const [genres, decades] = charts()
    expect(within(genres).getByText('Films by genre')).toBeInTheDocument()
    expect(within(decades).getByText('Films by decade')).toBeInTheDocument()
    // Glass River is Drama and a long genre, shortened on the axis; Night Bus has no genres.
    expect(within(genres).getByText('Drama')).toBeInTheDocument()
    expect(within(genres).getByText('Psychological…')).toBeInTheDocument()
    expect(within(genres).queryByText('Psychological Thriller')).toBeNull()
    expect(within(table('By genre')).getByText('Psychological Thriller')).toBeInTheDocument()
    expect(within(genres).getByText('Unknown')).toBeInTheDocument()
    expect(within(decades).getByText('1990s')).toBeInTheDocument()
  })

  it('says so when there are no screenings', async () => {
    fetchStatsData.mockImplementation(async () => ({ films: [], scores: [], attendance: [] }))
    renderPage('/stats?year=2026')
    expect(await screen.findByText('No screenings yet.')).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.queryByRole('tablist')).toBeNull()
  })

  it('shows the overview as tiles: a term and its value each, in one list', async () => {
    renderPage()
    await screen.findByText('Films screened')
    const list = document.querySelector('dl.stats-tiles')!
    const tiles = [...list.children]
    expect(tiles.every((t) => t.matches('.stats-tile') && t.children.length === 2)).toBe(true)
    expect(tiles.map((t) => t.querySelector('dt')?.textContent)).toEqual([
      'Films screened',
      'Scores given',
      'Club average',
      'Average attendance',
      // Every film kind, even with none in the period.
      'Normal',
      'Democrático',
      'Cinema',
      'Maratona',
      'First screening',
      'Last screening',
    ])
    expect(
      screen.getByText('Averages leave out films with no scores; attendance is per screening.'),
    ).toBeInTheDocument()
  })

  it('shows one tab at a time: tabs, a panel labelled by the selected tab, and the cards', async () => {
    renderPage()
    await screen.findByText('Films screened')
    const tabs = within(screen.getByRole('tablist', { name: 'Stats' })).getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['Overview', 'Films', 'People', 'Breakdowns'])
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual([
      'true',
      'false',
      'false',
      'false',
    ])
    expect(tabs.map((t) => t.tabIndex)).toEqual([0, -1, -1, -1])
    const panel = screen.getByRole('tabpanel', { name: 'Overview' })
    expect(tabs[0]).toHaveAttribute('aria-controls', panel.id)
    expect(within(panel).getByRole('table', { name: 'By year' })).toBeInTheDocument()
    expect(screen.queryByRole('table', { name: 'Attendance' })).toBeNull()

    fireEvent.click(tabs[2])
    const people = screen.getByRole('tabpanel', { name: 'People' })
    expect(
      within(people)
        .getAllByRole('table')
        .map((t) => t.querySelector('caption')?.textContent),
    ).toEqual([
      'Attendance',
      'Best chooser',
      'Kindest to harshest scorer',
      'Most alike',
      'Least alike',
    ])
    // Each card's heading is its table's caption (sr-only, so it isn't shown twice).
    expect(
      within(people).getByRole('heading', { level: 2, name: 'Attendance' }),
    ).toBeInTheDocument()
    expect(table('Attendance').querySelector('caption')).toHaveClass('sr-only')
    expect(screen.queryByText('Films screened')).toBeNull()
  })

  it.each([
    ['films', 'Films'],
    ['people', 'People'],
    ['breakdowns', 'Breakdowns'],
  ])('reads ?tab=%s from the URL', async (value, name) => {
    renderPage(`/stats?tab=${value}&year=2026`)
    expect(await screen.findByRole('tab', { name })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText('Period')).toHaveValue('2026')
  })

  it.each(['abc', 'Films', 'overview', 'people%E2%80%8B', '1e9', ''])(
    'falls back to Overview for ?tab=%s',
    async (value) => {
      renderPage(`/stats?tab=${value}`)
      await screen.findByText('Films screened')
      expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')
      expect(screen.getByRole('tabpanel', { name: 'Overview' })).toBeInTheDocument()
    },
  )

  it('moves between tabs with the arrow keys, Home and End, wrapping, focus on the new tab', async () => {
    const router = renderPage('/stats?year=2026')
    await screen.findByText('Films screened')
    const key = (k: string) => fireEvent.keyDown(document.activeElement!, { key: k })
    const selected = () => screen.getByRole('tab', { selected: true })
    screen.getByRole('tab', { name: 'Overview' }).focus()
    key('ArrowRight')
    expect(selected()).toHaveTextContent('Films')
    expect(selected()).toHaveFocus()
    expect(selected()).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('tabindex', '-1')
    expect(router.state.location.search).toBe('?tab=films&year=2026')
    key('End')
    expect(selected()).toHaveTextContent('Breakdowns')
    key('ArrowRight')
    expect(selected()).toHaveTextContent('Overview')
    expect(selected()).toHaveFocus()
    expect(router.state.location.search).toBe('?year=2026')
    key('ArrowLeft')
    expect(selected()).toHaveTextContent('Breakdowns')
    key('Home')
    expect(selected()).toHaveTextContent('Overview')
    // Other keys do nothing.
    key('ArrowDown')
    expect(selected()).toHaveTextContent('Overview')
    expect(fetchStatsData).toHaveBeenCalledTimes(1)
  })

  it('moves from the pressed tab when a second key comes before the re-render', async () => {
    renderPage('/stats?tab=breakdowns')
    const breakdowns = await screen.findByRole('tab', { name: 'Breakdowns' })
    const overview = screen.getByRole('tab', { name: 'Overview' })
    // Both keys in one batch: the second handler still has the old render's tab.
    act(() => {
      fireEvent.keyDown(breakdowns, { key: 'Home' })
      fireEvent.keyDown(overview, { key: 'ArrowLeft' })
    })
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('Breakdowns')
  })

  it('keeps a tab change when the year changes before the re-render, and the other way round', async () => {
    const router = renderPage('/stats?tab=breakdowns')
    await screen.findByRole('tab', { name: 'Breakdowns' })
    // Both in one batch: the select's handler still has the old render's tab.
    act(() => {
      fireEvent.click(screen.getByRole('tab', { name: 'Overview' }))
      fireEvent.change(screen.getByLabelText('Period'), { target: { value: '2026' } })
    })
    expect(router.state.location.search).toBe('?year=2026')
    act(() => {
      fireEvent.change(screen.getByLabelText('Period'), { target: { value: '2025' } })
      fireEvent.click(screen.getByRole('tab', { name: 'People' }))
    })
    expect(router.state.location.search).toBe('?tab=people&year=2025')
    // Back to what the URL says after a navigation from outside the page.
    await act(() => router.navigate('/stats?tab=films'))
    fireEvent.change(screen.getByLabelText('Period'), { target: { value: '2026' } })
    expect(router.state.location.search).toBe('?tab=films&year=2026')
  })

  describe('Show all', () => {
    // Six screenings, one a year 2001–2006: By year has 6 rows, each year's By month 1.
    const SIX = {
      films: [1, 2, 3, 4, 5, 6].map((i) => [
        i,
        `Film ${i}`,
        1990,
        `200${i}-06-01`,
        'normal',
        'p-ada',
        [],
        [],
        null,
      ]),
      scores: [],
      attendance: [],
    }
    const rows = (name: string) =>
      within(table(name))
        .getAllByRole('rowheader')
        .map((c) => c.textContent)

    it('shows the first 5 rows, then all of them and back, focus staying on the button', async () => {
      fetchStatsData.mockImplementation(async () => SIX)
      renderPage()
      await screen.findByRole('table', { name: 'By year' })
      expect(rows('By year')).toEqual(['2001', '2002', '2003', '2004', '2005'])
      const button = screen.getByRole('button', { name: 'Show all 6 rows: By year' })
      expect(button).toHaveTextContent('Show all (6)')
      expect(button).toHaveAttribute('aria-expanded', 'false')
      expect(button).toHaveAttribute('aria-controls', table('By year').id)
      button.focus()
      fireEvent.click(button)
      expect(rows('By year')).toEqual(['2001', '2002', '2003', '2004', '2005', '2006'])
      expect(button).toHaveAccessibleName('Show fewer rows: By year')
      expect(button).toHaveTextContent('Show fewer')
      expect(button).toHaveAttribute('aria-expanded', 'true')
      expect(button).toHaveFocus()
      fireEvent.click(button)
      expect(rows('By year')).toHaveLength(5)
      expect(button).toHaveAttribute('aria-expanded', 'false')
      expect(button).toHaveFocus()
    })

    it('is not offered for 5 rows or fewer', async () => {
      fetchStatsData.mockImplementation(async () => ({
        ...SIX,
        films: SIX.films.slice(0, 5),
      }))
      renderPage()
      await screen.findByRole('table', { name: 'By year' })
      expect(rows('By year')).toHaveLength(5)
      expect(screen.queryByRole('button', { name: /^Show/ })).toBeNull()
    })

    it('starts collapsed again after the year changes', async () => {
      fetchStatsData.mockImplementation(async () => SIX)
      renderPage()
      fireEvent.click(await screen.findByRole('button', { name: 'Show all 6 rows: By year' }))
      expect(rows('By year')).toHaveLength(6)
      fireEvent.change(screen.getByLabelText('Period'), { target: { value: '2003' } })
      expect(rows('By month in 2003')).toEqual(['June'])
      expect(screen.queryByRole('button', { name: /^Show/ })).toBeNull()
      fireEvent.change(screen.getByLabelText('Period'), { target: { value: '' } })
      expect(rows('By year')).toHaveLength(5)
      expect(screen.getByRole('button', { name: 'Show all 6 rows: By year' })).toHaveAttribute(
        'aria-expanded',
        'false',
      )
    })
  })
})
