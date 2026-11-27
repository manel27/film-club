import { fireEvent, render, screen, within } from '@testing-library/react'
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
    [1, 'Glass River', 2001, '2026-03-01', 'normal', 'p-ada', ['Drama'], ['Rui'], 100],
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
    renderPage()
    await screen.findByText('Films screened')
    expect(screen.queryByText(/Far Future/)).toBeNull()
    expect(screen.queryByText(/Broken/)).toBeNull()
    // Far Future's attendance isn't counted either: Bo was present once, not twice.
    expect(within(table('Attendance')).getByRole('row', { name: /Bo/ })).toHaveTextContent('150%')
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

  it('changing the year updates the URL and every section, without loading again', async () => {
    const router = renderPage()
    await screen.findByText('Films screened')
    fireEvent.change(screen.getByLabelText('Period'), { target: { value: '2026' } })
    expect(router.state.location.search).toBe('?year=2026')
    expect(fact('Films screened')).toBe('1')
    expect(screen.getByText('Showing 2026: 1 film screened.')).toBeInTheDocument()
    expect(within(table('Attendance')).queryByText('Ada')).toBeInTheDocument()
    expect(within(table('Most attended')).queryByText(/Night Bus/)).toBeNull()
    fireEvent.change(screen.getByLabelText('Period'), { target: { value: '' } })
    expect(router.state.location.search).toBe('')
    expect(fact('Films screened')).toBe('2')
    expect(fetchStatsData).toHaveBeenCalledTimes(1)
  })

  it('ranks films with at least 3 scores only, says so, and links each film', async () => {
    renderPage()
    await screen.findByText('Films screened')
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
    renderPage()
    await screen.findByText('Films screened')
    const attendance = table('Attendance')
    expect(within(attendance).getByRole('link', { name: 'Ada' })).toBeInTheDocument()
    expect(within(attendance).queryByText('Cinema')).toBeNull()
    // Ada was at both screenings, Bo at one.
    expect(within(attendance).getByRole('row', { name: /Ada/ })).toHaveTextContent('2100%')
  })

  it('says when a ranking has nobody in it', async () => {
    renderPage()
    await screen.findByText('Films screened')
    expect(within(table('Best chooser')).getByText('None in this period.')).toBeInTheDocument()
  })

  it('says so when there are no screenings', async () => {
    fetchStatsData.mockImplementation(async () => ({ films: [], scores: [], attendance: [] }))
    renderPage('/stats?year=2026')
    expect(await screen.findByText('No screenings yet.')).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
  })
})
