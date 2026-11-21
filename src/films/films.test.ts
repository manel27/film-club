import { afterAll, describe, expect, it, vi } from 'vitest'
import {
  filterFilms,
  formatDate,
  groupByWeek,
  readParams,
  weekHeading,
  weekStart,
  type FilmItem,
  type Filters,
} from './films'

function film(id: number, screenedOn: string, extra: Partial<FilmItem> = {}): FilmItem {
  return {
    id,
    title: `Film ${id}`,
    releaseYear: 2000,
    posterPath: null,
    genres: [],
    screenedOn,
    dayOrder: 1,
    kind: 'normal',
    assignedId: 'a',
    presentIds: [],
    avgScore: null,
    ...extra,
  }
}

const NO_FILTERS: Filters = {
  present: [],
  presentMode: 'any',
  genre: '',
  assigned: '',
  kind: '',
  year: '',
  unscored: false,
}

describe('weekStart (Mon–Sun weeks)', () => {
  it('maps every day of a week to its Monday', () => {
    for (const day of ['09', '10', '11', '12', '13', '14', '15']) {
      expect(weekStart(`2026-11-${day}`)).toBe('2026-11-09')
    }
  })

  it('puts Sunday in the week before Monday', () => {
    expect(weekStart('2026-11-15')).toBe('2026-11-09') // Sunday
    expect(weekStart('2026-11-16')).toBe('2026-11-16') // Monday
  })

  it('is unaffected by the DST changes in Lisbon', () => {
    // Clocks go forward on Sun 29 Mar 2026 and back on Sun 25 Oct 2026.
    expect(weekStart('2026-03-29')).toBe('2026-03-23')
    expect(weekStart('2026-03-30')).toBe('2026-03-30')
    expect(weekStart('2026-10-25')).toBe('2026-10-19')
    expect(weekStart('2026-10-26')).toBe('2026-10-26')
    expect(formatDate('2026-03-29')).toBe('Sun 29 Mar 2026')
    expect(formatDate('2026-10-25')).toBe('Sun 25 Oct 2026')
  })

  it('crosses month and year boundaries', () => {
    expect(weekStart('2027-01-02')).toBe('2026-12-28')
    expect(weekStart('2024-03-01')).toBe('2024-02-26') // leap year
  })

  describe('in a browser far from Lisbon', () => {
    afterAll(() => vi.unstubAllEnvs())

    it('gives the same weeks and dates', () => {
      vi.stubEnv('TZ', 'Pacific/Kiritimati') // UTC+14
      expect(new Date(2026, 10, 15).getTimezoneOffset()).toBe(-840)
      expect(weekStart('2026-11-15')).toBe('2026-11-09')
      expect(formatDate('2026-11-14')).toBe('Sat 14 Nov 2026')
      vi.stubEnv('TZ', 'America/Adak') // UTC-10
      expect(new Date(2026, 10, 15).getTimezoneOffset()).toBe(600)
      expect(weekStart('2026-11-16')).toBe('2026-11-16')
      expect(formatDate('2026-11-14')).toBe('Sat 14 Nov 2026')
    })
  })
})

describe('weekHeading', () => {
  it('names the screening date', () => {
    expect(weekHeading(['2026-11-14'])).toBe('Week of Sat 14 Nov 2026')
    expect(weekHeading(['2026-11-14', '2026-11-14'])).toBe('Week of Sat 14 Nov 2026')
  })

  it('names every date of a week with several', () => {
    expect(weekHeading(['2026-11-15', '2026-11-13'])).toBe('Week of Fri 13 Nov and Sun 15 Nov 2026')
    expect(weekHeading(['2026-12-31', '2027-01-02'])).toBe(
      'Week of Thu 31 Dec 2026 and Sat 2 Jan 2027',
    )
  })
})

describe('groupByWeek', () => {
  const films = [
    film(1, '2026-11-14', { dayOrder: 2 }),
    film(2, '2026-11-14', { dayOrder: 1 }),
    film(3, '2026-11-16'),
    film(4, '2026-11-09'),
    film(5, '2026-11-01'),
  ]

  it('sorts newest first, keeping same-day films in day_order', () => {
    const groups = groupByWeek(films, 'newest')
    expect(groups.map((g) => g.weekStart)).toEqual(['2026-11-16', '2026-11-09', '2026-10-26'])
    expect(groups[1].films.map((f) => f.id)).toEqual([2, 1, 4])
    expect(groups[1].heading).toBe('Week of Mon 9 Nov and Sat 14 Nov 2026')
  })

  it('sorts oldest first', () => {
    const groups = groupByWeek(films, 'oldest')
    expect(groups.map((g) => g.weekStart)).toEqual(['2026-10-26', '2026-11-09', '2026-11-16'])
    expect(groups[1].films.map((f) => f.id)).toEqual([4, 2, 1])
  })

  it('handles no films', () => {
    expect(groupByWeek([], 'newest')).toEqual([])
  })
})

describe('filterFilms', () => {
  const films = [
    film(1, '2025-05-03', { presentIds: ['a', 'b'], genres: ['Drama'], kind: 'cinema' }),
    film(2, '2026-05-02', { presentIds: ['a'], genres: ['Comedy', 'Drama'], assignedId: 'b' }),
    film(3, '2026-05-09', { presentIds: ['c'], kind: 'maratona' }),
  ]
  const ids = (f: Partial<Filters>, scored = new Set<number>()) =>
    filterFilms(films, { ...NO_FILTERS, ...f }, scored).map((x) => x.id)

  it('keeps everything with no filters', () => {
    expect(ids({})).toEqual([1, 2, 3])
  })

  it('filters on present people, any or all', () => {
    expect(ids({ present: ['b', 'c'] })).toEqual([1, 3])
    expect(ids({ present: ['a', 'b'], presentMode: 'all' })).toEqual([1])
  })

  it('filters on genre, assigned person, kind and year shown', () => {
    expect(ids({ genre: 'Drama' })).toEqual([1, 2])
    expect(ids({ assigned: 'b' })).toEqual([2])
    expect(ids({ kind: 'maratona' })).toEqual([3])
    expect(ids({ year: '2026' })).toEqual([2, 3])
    expect(ids({ genre: 'Drama', year: '2026' })).toEqual([2])
  })

  it('keeps only films I have not scored', () => {
    expect(ids({ unscored: true }, new Set([2]))).toEqual([1, 3])
  })
})

describe('readParams', () => {
  it('has defaults and ignores unknown values', () => {
    const { view, sort, filters } = readParams(new URLSearchParams('view=grid&sort=x&kind=bogus'))
    expect(view).toBe('list')
    expect(sort).toBe('newest')
    expect(filters).toEqual(NO_FILTERS)
  })

  it('reads every filter', () => {
    const p = new URLSearchParams(
      'view=posters&sort=oldest&present=a,b&presentMode=all&genre=Drama&assigned=c&kind=cinema&year=2025&unscored=1',
    )
    expect(readParams(p)).toEqual({
      view: 'posters',
      sort: 'oldest',
      filters: {
        present: ['a', 'b'],
        presentMode: 'all',
        genre: 'Drama',
        assigned: 'c',
        kind: 'cinema',
        year: '2025',
        unscored: true,
      },
    })
  })
})
