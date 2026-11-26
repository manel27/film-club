import { afterAll, describe, expect, it, vi } from 'vitest'
import {
  filterFilms,
  nextFilm,
  ratingBand,
  readParams,
  screeningDay,
  sortFilms,
  toParams,
  validFilters,
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
    isEasterEgg: false,
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

describe('ratingBand', () => {
  it.each([
    [0, '🤮', 'awful'],
    [2.99, '🤮', 'awful'],
    [3, '👎', 'bad'],
    [4.99, '👎', 'bad'],
    [5, '😐', 'okay'],
    [6.49, '😐', 'okay'],
    [6.5, '👌', 'good'],
    [7.99, '👌', 'good'],
    [8, '👏', 'great'],
    [9.49, '👏', 'great'],
    [9.5, '🔥', 'outstanding'],
    [10, '🔥', 'outstanding'],
  ])('puts %s in %s (%s)', (avg, emoji, label) => {
    expect(ratingBand(avg)).toEqual({ emoji, label })
  })

  it('follows the average as shown, rounded to 2 decimals', () => {
    // Shown as 5.00 and 9.50, so okay and outstanding, not bad and great.
    expect(ratingBand(4.996)).toEqual({ emoji: '😐', label: 'okay' })
    expect(ratingBand(9.4951)).toEqual({ emoji: '🔥', label: 'outstanding' })
    // Shown as 4.99.
    expect(ratingBand(4.994)).toEqual({ emoji: '👎', label: 'bad' })
  })
})

describe('screeningDay', () => {
  it('shows a weekday, day, month and year', () => {
    expect(screeningDay('2026-12-05', '2026-11-26')).toBe('Sat 5 Dec 2026')
    expect(screeningDay('2027-01-01', '2026-11-26')).toBe('Fri 1 Jan 2027')
  })

  it('says Today for today', () => {
    expect(screeningDay('2026-11-26', '2026-11-26')).toBe('Today')
  })

  it.each(['', 'soon', '2026-02-31', '2026-13-01', '2026-1-5'])(
    'says "Date unknown" for %j, never "Invalid Date"',
    (date) => {
      expect(screeningDay(date, '2026-11-26')).toBe('Date unknown')
    },
  )

  describe('in a browser far from Lisbon', () => {
    afterAll(() => vi.unstubAllEnvs())

    it('gives the same day', () => {
      vi.stubEnv('TZ', 'Pacific/Kiritimati') // UTC+14
      expect(new Date(2026, 10, 15).getTimezoneOffset()).toBe(-840)
      expect(screeningDay('2026-03-29', '')).toBe('Sun 29 Mar 2026') // DST starts
      vi.stubEnv('TZ', 'America/Adak') // UTC-10
      expect(new Date(2026, 10, 15).getTimezoneOffset()).toBe(600)
      expect(screeningDay('2026-10-25', '')).toBe('Sun 25 Oct 2026') // DST ends
    })
  })
})

describe('nextFilm', () => {
  it('picks the earliest film on or after today, lowest day_order first', () => {
    const films = [
      film(1, '2026-11-25'),
      film(2, '2026-12-05', { dayOrder: 2 }),
      film(3, '2026-12-12'),
      film(4, '2026-12-05', { dayOrder: 1 }),
    ]
    expect(nextFilm(films, '2026-11-26')?.id).toBe(4)
    expect(nextFilm(films, '2026-12-05')?.id).toBe(4) // today counts
    expect(nextFilm(films, '2026-12-06')?.id).toBe(3)
  })

  it('never picks the easter egg, and finds nothing when no film is ahead', () => {
    const films = [film(1, '2026-11-01'), film(2, '2026-12-05', { isEasterEgg: true })]
    expect(nextFilm(films, '2026-11-26')).toBeUndefined()
    expect(nextFilm([], '2026-11-26')).toBeUndefined()
  })
})

describe('sortFilms', () => {
  const ids = (films: FilmItem[], sort: Parameters<typeof sortFilms>[1]) =>
    sortFilms(films, sort).map((f) => f.id)

  it('sorts titles ignoring case, accents and a leading article', () => {
    const films = [
      film(1, '2026-01-01', { title: 'zebra' }),
      film(2, '2026-01-01', { title: 'Élan' }),
      film(3, '2026-01-01', { title: 'The Fly' }),
      film(4, '2026-01-01', { title: 'eagle' }),
      film(5, '2026-01-01', { title: 'An Apple' }),
    ]
    expect(ids(films, 'title')).toEqual([5, 4, 2, 3, 1])
    expect(ids(films, 'title-desc')).toEqual([1, 3, 2, 4, 5])
  })

  it('sorts numbers by value and ignores leading punctuation', () => {
    const films = [
      film(1, '2026-01-01', { title: 'Rocky 10' }),
      film(2, '2026-01-01', { title: '2001' }),
      film(3, '2026-01-01', { title: 'Rocky 2' }),
      film(4, '2026-01-01', { title: '10' }),
      film(5, '2026-01-01', { title: '9' }),
      film(6, '2026-01-01', { title: '"Quoted"' }),
      film(7, '2026-01-01', { title: '¡Bang!' }),
      film(8, '2026-01-01', { title: "'The Mole'" }),
      film(9, '2026-01-01', { title: '(Cut)' }),
    ]
    expect(ids(films, 'title')).toEqual([5, 4, 2, 7, 9, 8, 6, 3, 1])
  })

  it('puts films with no year or average last in both directions', () => {
    const films = [
      film(1, '2026-01-01', { releaseYear: null, avgScore: 8 }),
      film(2, '2026-01-01', { releaseYear: 1990, avgScore: null }),
      film(3, '2026-01-01', { releaseYear: 2010, avgScore: 6.5 }),
    ]
    expect(ids(films, 'year')).toEqual([2, 3, 1])
    expect(ids(films, 'year-desc')).toEqual([3, 2, 1])
    expect(ids(films, 'score')).toEqual([3, 1, 2])
    expect(ids(films, 'score-desc')).toEqual([1, 3, 2])
  })

  it('breaks ties by screening date (newest first), then title', () => {
    const films = [
      film(1, '2025-01-01', { title: 'B', avgScore: 7 }),
      film(2, '2026-01-01', { title: 'C', avgScore: 7 }),
      film(3, '2025-01-01', { title: 'A', avgScore: 7 }),
      film(4, '2024-01-01', { title: 'D', avgScore: null }),
      film(5, '2026-01-01', { title: 'E', avgScore: null }),
    ]
    expect(ids(films, 'score')).toEqual([2, 3, 1, 5, 4])
    expect(ids(films, 'score-desc')).toEqual([2, 3, 1, 5, 4])
    expect(ids(films, 'year')).toEqual([2, 5, 3, 1, 4]) // all 2000
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
    const { view, sort, filters } = readParams(new URLSearchParams('view=mosaic&sort=x&kind=bogus'))
    expect(view).toBe('list')
    expect(sort).toBe('newest')
    expect(filters).toEqual(NO_FILTERS)
    expect(readParams(new URLSearchParams('sort=toString')).sort).toBe('newest')
  })

  it('reads every view, old "posters" links included (now the poster list)', () => {
    for (const view of ['list', 'posters', 'grid']) {
      expect(readParams(new URLSearchParams(`view=${view}`)).view).toBe(view)
    }
  })

  it('reads every sort', () => {
    for (const sort of [
      'oldest',
      'title',
      'title-desc',
      'year',
      'year-desc',
      'score',
      'score-desc',
    ])
      expect(readParams(new URLSearchParams({ sort })).sort).toBe(sort)
  })

  it('reads every filter', () => {
    const p = new URLSearchParams(
      'view=grid&sort=oldest&present=a,b&presentMode=all&genre=Drama&assigned=c&kind=cinema&year=2025&unscored=1',
    )
    expect(readParams(p)).toEqual({
      view: 'grid',
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

describe('toParams', () => {
  it('round-trips known keys and drops defaults and junk', () => {
    const p =
      'view=grid&sort=oldest&present=a,b&presentMode=all&genre=Drama&assigned=c&kind=cinema&year=2025&unscored=1'
    expect(toParams(readParams(new URLSearchParams(p))).toString()).toBe(
      'view=grid&sort=oldest&present=a%2Cb&presentMode=all&genre=Drama&assigned=c&kind=cinema&year=2025&unscored=1',
    )
    expect(
      toParams(readParams(new URLSearchParams('{bad json&sort=newest&view=nope'))).toString(),
    ).toBe('')
  })
})

describe('validFilters', () => {
  const options = {
    present: new Set(['a']),
    genres: new Set(['Drama']),
    assigned: new Set(['b']),
    years: new Set(['2026']),
    canScore: false,
  }

  it('drops values that match no option, and unscored for people who cannot score', () => {
    const f = {
      ...NO_FILTERS,
      present: ['a', 'gone'],
      genre: 'Nope',
      assigned: 'b',
      year: 'abc',
      unscored: true,
    }
    expect(validFilters(f, options)).toEqual({ ...NO_FILTERS, present: ['a'], assigned: 'b' })
  })
})
