import { describe, expect, it } from 'vitest'
import type { Person } from '../films/films'
import {
  chartGenres,
  computeStats,
  parseStatsData,
  readYear,
  statsYears,
  type StatsData,
} from './stats'

const TODAY = '2026-11-27'

const person = (id: string, name: string, extra: Partial<Person> = {}): Person => ({
  id,
  name,
  colour: null,
  isSystem: false,
  role: 'member',
  ...extra,
})
const ANA = person('ana', 'Ana', { colour: '#123456' })
const BEN = person('ben', 'Ben')
const CAL = person('cal', 'Cal')
const DEE = person('dee', 'Dee')
const CINEMA = person('cin', 'Cinema', { isSystem: true })
const PEOPLE = [ANA, BEN, CAL, DEE, CINEMA]

type Row = {
  id: number
  date: string
  title?: string
  year?: number | null
  kind?: string
  by?: string
  genres?: unknown
  directors?: unknown
  runtime?: unknown
}
const film = (r: Row) => [
  r.id,
  r.title ?? `Film ${r.id}`,
  r.year === undefined ? 2000 : r.year,
  r.date,
  r.kind ?? 'normal',
  r.by ?? 'ana',
  r.genres ?? ['Drama'],
  r.directors ?? ['Dir A'],
  r.runtime === undefined ? 100 : r.runtime,
]

/** Raw stats_data() jsonb from rows: films, [filmId, profileId, score], [filmId, profileId]. */
const raw = (films: Row[], scores: unknown[] = [], attendance: unknown[] = []) => ({
  films: films.map(film),
  scores,
  attendance,
})
const data = (...args: Parameters<typeof raw>): StatsData => parseStatsData(raw(...args), TODAY)
const stats = (d: StatsData, year = '', people = PEOPLE) => computeStats(d, people, year)

/** Scores of each listed person on a film. */
const scored = (filmId: number, byPerson: Record<string, number>) =>
  Object.entries(byPerson).map(([p, s]) => [filmId, p, s])

describe('parseStatsData', () => {
  it('reads well-formed rows', () => {
    const d = data(
      [{ id: 1, date: '2026-01-10', title: 'Orchard', year: 2019 }],
      [[1, 'ana', 7.5]],
      [[1, 'ben']],
    )
    expect(d.films).toEqual([
      {
        id: 1,
        title: 'Orchard',
        releaseYear: 2019,
        screenedOn: '2026-01-10',
        kind: 'normal',
        assignedId: 'ana',
        genres: ['Drama'],
        directors: ['Dir A'],
        runtimeMin: 100,
      },
    ])
    expect(d.scores).toEqual([{ filmId: 1, profileId: 'ana', score: 7.5 }])
    expect(d.attendance).toEqual([{ filmId: 1, profileId: 'ben' }])
  })

  it.each([null, undefined, 'nope', 42, [], { films: 'x', scores: {}, attendance: null }])(
    'treats %j as no data instead of crashing',
    (value) => {
      expect(parseStatsData(value, TODAY)).toEqual({ films: [], scores: [], attendance: [] })
    },
  )

  it('skips films without a usable id or date, repeats, and non-array rows', () => {
    const d = parseStatsData(
      {
        films: [
          film({ id: 1, date: '2026-01-10' }),
          film({ id: 1, date: '2026-01-11', title: 'Repeat' }),
          film({ id: 0, date: '2026-01-10' }),
          film({ id: 2 ** 60, date: '2026-01-10' }),
          [3.5, 't', null, '2026-01-10'],
          ['4', 't', null, '2026-01-10'],
          film({ id: 5, date: '2026-02-31' }),
          film({ id: 6, date: 'yesterday' }),
          film({ id: 7, date: '2026-1-5' }),
          'garbage',
          null,
        ],
      },
      TODAY,
    )
    expect(d.films.map((f) => [f.id, f.title])).toEqual([[1, 'Film 1']])
  })

  it('drops films screened after today, with their scores and attendance', () => {
    const d = data(
      [
        { id: 1, date: TODAY },
        { id: 2, date: '2026-11-28' },
      ],
      [
        [1, 'ana', 5],
        [2, 'ana', 5],
      ],
      [[2, 'ana']],
    )
    expect(d.films.map((f) => f.id)).toEqual([1])
    expect(d.scores).toHaveLength(1)
    expect(d.attendance).toEqual([])
  })

  it('makes bad optional fields unknown instead of dropping the film', () => {
    const [f] = data([
      {
        id: 1,
        date: '2026-01-10',
        title: '  ',
        year: 1.5,
        kind: 'imax',
        by: '',
        genres: ['Dra​ma', ' ', 42, 'Drama', '​'],
        directors: 'Dir A',
        runtime: '7,5',
      },
    ]).films
    expect(f).toMatchObject({
      title: 'Untitled',
      releaseYear: null,
      kind: null,
      assignedId: '',
      genres: ['Drama'],
      directors: [],
      runtimeMin: null,
    })
  })

  it('skips scores and marks that are malformed, repeated or for unknown films', () => {
    const d = data(
      [{ id: 1, date: '2026-01-10' }],
      [
        [1, 'ana', 7],
        [1, 'ana', 8],
        [1, 'ben', '7,5'],
        [1, 'ben', 6.5],
        [1, 'cal', -1],
        [1, 'dee', 100],
        [1, 'eve', Number.NaN],
        [9, 'ana', 5],
        [1, '', 5],
        ['1', 'fay', 5],
        'x',
      ],
      [
        [1, 'ana'],
        [1, 'ana'],
        [9, 'ben'],
        [1, null],
      ],
    )
    expect(d.scores).toEqual([
      { filmId: 1, profileId: 'ana', score: 7 },
      // A bad row doesn't hide a good one after it.
      { filmId: 1, profileId: 'ben', score: 6.5 },
    ])
    expect(d.attendance).toEqual([{ filmId: 1, profileId: 'ana' }])
  })
})

describe('years', () => {
  const d = data([
    { id: 1, date: '2024-05-01' },
    { id: 2, date: '2026-01-10' },
    { id: 3, date: '2026-02-10' },
  ])

  it('lists years with screenings, newest first', () => {
    expect(statsYears(d)).toEqual(['2026', '2024'])
  })

  it.each([
    ['2024', '2024'],
    ['2025', ''],
    ['abc', ''],
    ['', ''],
    [' 2026', ''],
    ['2026​', ''],
    [null, ''],
  ])('reads ?year=%j as %j', (value, expected) => {
    expect(readYear(value, statsYears(d))).toBe(expected)
  })
})

describe('computeStats', () => {
  it('handles no films at all', () => {
    const s = stats(data([]))
    expect(s.overview).toMatchObject({
      films: 0,
      scores: 0,
      clubAvg: null,
      avgAttendance: null,
      first: null,
      last: null,
    })
    expect(s.overview.kinds.every((k) => k.count === 0)).toBe(true)
    for (const list of [
      s.top,
      s.overTime,
      s.attendance,
      s.choosers,
      s.alike,
      s.genres,
      s.runtimes,
    ]) {
      expect(list).toEqual([])
    }
  })

  describe('overview', () => {
    const d = data(
      [
        { id: 1, date: '2025-03-01', kind: 'cinema' },
        { id: 2, date: '2026-01-10' },
        { id: 3, date: '2026-01-17', kind: 'maratona' },
        { id: 4, date: '2026-01-24', kind: 'imax' },
      ],
      [...scored(1, { ana: 8 }), ...scored(2, { ana: 7.5, ben: 8 }), ...scored(3, { ben: 4.25 })],
      [
        [1, 'ana'],
        [2, 'ana'],
        [2, 'ben'],
        [2, 'cal'],
      ],
    )

    it('counts and averages all time', () => {
      const o = stats(d).overview
      expect(o.films).toBe(4)
      expect(o.scores).toBe(4)
      // Film averages 8, 7.75, 4.25 (film 4 has no scores): (8 + 7.75 + 4.25) / 3.
      expect(o.clubAvg).toBe(6.67)
      // Present 1, 3, 0, 0.
      expect(o.avgAttendance).toBe(1)
      expect(o.first).toBe('2025-03-01')
      expect(o.last).toBe('2026-01-24')
    })

    it('labels normal films "Normal" and counts an unknown kind in none', () => {
      expect(stats(d).overview.kinds.map((k) => [k.label, k.count])).toEqual([
        ['Normal', 1],
        ['Democrático', 0],
        ['Cinema', 1],
        ['Maratona', 1],
      ])
    })

    it('follows the year', () => {
      const o = stats(d, '2025').overview
      expect(o).toMatchObject({ films: 1, scores: 1, clubAvg: 8, avgAttendance: 1 })
      expect(o.first).toBe('2025-03-01')
      expect(o.last).toBe('2025-03-01')
      expect(stats(d, '2026').overview.films).toBe(3)
    })
  })

  describe('film rankings', () => {
    it('needs at least 3 scores: exactly 3 is in, 2 is out', () => {
      const d = data(
        [
          { id: 1, date: '2026-01-10' },
          { id: 2, date: '2026-01-17' },
        ],
        [...scored(1, { ana: 5, ben: 6, cal: 7 }), ...scored(2, { ana: 9, ben: 9 })],
      )
      const s = stats(d)
      expect(s.top.map((f) => f.film.id)).toEqual([1])
      expect(s.bottom.map((f) => f.film.id)).toEqual([1])
      expect(s.divisive.map((f) => f.film.id)).toEqual([1])
    })

    it('ranks by average, ties by most recent screening then title', () => {
      const three = (id: number, x: number) => scored(id, { ana: x, ben: x, cal: x })
      const d = data(
        [
          { id: 1, date: '2026-01-10', title: 'Zed' },
          { id: 2, date: '2026-02-10', title: 'The Beta' },
          { id: 3, date: '2026-02-10', title: 'Alpha' },
          { id: 4, date: '2026-03-10', title: 'Low' },
        ],
        [...three(1, 8), ...three(2, 8), ...three(3, 8), ...three(4, 3)],
      )
      const s = stats(d)
      expect(s.top.map((f) => f.film.title)).toEqual(['Alpha', 'The Beta', 'Zed', 'Low'])
      expect(s.bottom.map((f) => f.film.title)).toEqual(['Low', 'Alpha', 'The Beta', 'Zed'])
      expect(s.top[0].avg).toBe(8)
    })

    it('keeps the top 10 only', () => {
      const ids = Array.from({ length: 12 }, (_, i) => i + 1)
      const d = data(
        ids.map((id) => ({ id, date: `2026-01-${String(id).padStart(2, '0')}` })),
        ids.flatMap((id) => scored(id, { ana: id / 2, ben: id / 2, cal: id / 2 })),
      )
      const s = stats(d)
      expect(s.top).toHaveLength(10)
      expect(s.top[0].film.id).toBe(12)
      expect(s.bottom[0].film.id).toBe(1)
    })

    it('ranks the most divisive by population standard deviation', () => {
      const d = data(
        [
          { id: 1, date: '2026-01-10' },
          { id: 2, date: '2026-01-17' },
        ],
        // Film 1: 2, 4, 4, 4, 5, 5, 7, 9 has a population SD of exactly 2.
        [
          ...[2, 4, 4, 4, 5, 5, 7, 9].map((x, i) => [1, `p${i}`, x]),
          ...scored(2, { ana: 5, ben: 5, cal: 5.01 }),
        ],
      )
      const s = stats(d)
      expect(s.divisive.map((f) => [f.film.id, f.sd])).toEqual([
        [1, 2],
        [2, 0],
      ])
    })

    it('ranks the most attended, leaving out films nobody came to', () => {
      const d = data(
        [
          { id: 1, date: '2026-01-10' },
          { id: 2, date: '2026-01-17' },
          { id: 3, date: '2026-01-24' },
        ],
        [],
        [
          [1, 'ana'],
          [1, 'ben'],
          [2, 'ana'],
          [2, 'cal'],
        ],
      )
      expect(stats(d).attended.map((f) => [f.film.id, f.present])).toEqual([
        [2, 2],
        [1, 2],
      ])
    })
  })

  describe('people rankings', () => {
    it('counts attendance and its share of the period, never system profiles', () => {
      const d = data(
        [
          { id: 1, date: '2026-01-10' },
          { id: 2, date: '2026-01-17' },
          { id: 3, date: '2026-01-24' },
        ],
        [],
        [
          [1, 'ben'],
          [2, 'ben'],
          [1, 'ana'],
          [3, 'cin'],
          [3, 'ghost'],
        ],
      )
      expect(stats(d).attendance.map((r) => [r.person.name, r.count, r.pct])).toEqual([
        ['Ben', 2, 67],
        ['Ana', 1, 33],
      ])
    })

    it('rounds the share half up: 23 of 40 screenings is 58%', () => {
      const ids = Array.from({ length: 40 }, (_, i) => i + 1)
      const d = data(
        ids.map((id) => ({ id, date: '2026-01-01' })),
        [],
        ids.slice(0, 23).map((id) => [id, 'ana']),
      )
      expect(stats(d).attendance.map((r) => [r.person.name, r.count, r.pct])).toEqual([
        ['Ana', 23, 58],
      ])
    })

    it('ranks choosers with at least 3 chosen films that have scores', () => {
      const films: Row[] = [
        { id: 1, date: '2026-01-01', by: 'ana' },
        { id: 2, date: '2026-01-02', by: 'ana' },
        { id: 3, date: '2026-01-03', by: 'ana' },
        { id: 4, date: '2026-01-04', by: 'ben' },
        { id: 5, date: '2026-01-05', by: 'ben' },
        // Ben's third film has no scores: he has only 2 that count.
        { id: 6, date: '2026-01-06', by: 'ben' },
        { id: 7, date: '2026-01-07', by: 'cin' },
        { id: 8, date: '2026-01-08', by: 'cin' },
        { id: 9, date: '2026-01-09', by: 'cin' },
      ]
      const d = data(
        films,
        [1, 2, 3, 4, 5, 7, 8, 9].map((id) => [id, 'dee', id]),
      )
      expect(stats(d).choosers.map((r) => [r.person.name, r.avg, r.films])).toEqual([['Ana', 2, 3]])
    })

    it('ranks scorers kindest first with at least 10 scores: 10 is in, 9 is out', () => {
      const ids = Array.from({ length: 10 }, (_, i) => i + 1)
      const d = data(
        ids.map((id) => ({ id, date: `2026-01-${String(id).padStart(2, '0')}` })),
        [
          ...ids.map((id) => [id, 'ana', 6]),
          ...ids.map((id) => [id, 'ben', 8]),
          ...ids.slice(1).map((id) => [id, 'cal', 10]),
        ],
      )
      expect(stats(d).scorers.map((r) => [r.person.name, r.avg, r.scores])).toEqual([
        ['Ben', 8, 10],
        ['Ana', 6, 10],
      ])
    })

    it('pairs people on at least 5 shared films by mean absolute difference', () => {
      const ids = [1, 2, 3, 4, 5]
      const d = data(
        ids.map((id) => ({ id, date: `2026-01-0${id}` })),
        [
          ...ids.map((id) => [id, 'ana', 5]),
          ...ids.map((id) => [id, 'ben', id % 2 ? 6 : 4.5]),
          ...ids.map((id) => [id, 'cal', 9.1]),
          // Dee shares only 4 films with anyone.
          ...ids.slice(1).map((id) => [id, 'dee', 5]),
          ...ids.map((id) => [id, 'cin', 5]),
        ],
      )
      const s = stats(d)
      const show = (p: (typeof s.alike)[number]) => [p.a.name, p.b.name, p.diff, p.shared]
      // Ana–Ben: 1, 0.5, 1, 0.5, 1 → 0.8; Ana–Cal 4.1; Ben–Cal: 3.1, 4.6, … → 3.7.
      expect(s.alike.map(show)).toEqual([
        ['Ana', 'Ben', 0.8, 5],
        ['Ben', 'Cal', 3.7, 5],
        ['Ana', 'Cal', 4.1, 5],
      ])
      expect(s.unalike.map(show)[0]).toEqual(['Ana', 'Cal', 4.1, 5])
    })

    it('breaks a tie between scorers by name', () => {
      const ids = Array.from({ length: 10 }, (_, i) => i + 1)
      const d = data(
        ids.map((id) => ({ id, date: '2026-01-01' })),
        [
          ...ids.map((id) => [id, 'ben', 7]),
          ...ids.map((id) => [id, 'ana', id % 2 ? 6 : 8]),
          ...ids.map((id) => [id, 'cal', 8]),
        ],
      )
      expect(stats(d).scorers.map((r) => [r.person.name, r.avg])).toEqual([
        ['Cal', 8],
        ['Ana', 7],
        ['Ben', 7],
      ])
    })

    it('keeps the top 5 pairs each way, ties by name', () => {
      const EVE = person('eve', 'Eve')
      const ids = [1, 2, 3, 4, 5]
      const by: Record<string, number> = { ana: 5, ben: 5, cal: 5, dee: 9, eve: 9 }
      const d = data(
        ids.map((id) => ({ id, date: '2026-01-01' })),
        ids.flatMap((id) => Object.entries(by).map(([p, x]) => [id, p, x])),
      )
      const s = stats(d, '', [...PEOPLE, EVE])
      const show = (ps: typeof s.alike) => ps.map((p) => `${p.a.name}–${p.b.name} ${p.diff}`)
      // 10 pairs: four agree exactly, six differ by 4.
      expect(show(s.alike)).toEqual([
        'Ana–Ben 0',
        'Ana–Cal 0',
        'Ben–Cal 0',
        'Dee–Eve 0',
        'Ana–Dee 4',
      ])
      expect(show(s.unalike)).toEqual([
        'Ana–Dee 4',
        'Ana–Eve 4',
        'Ben–Dee 4',
        'Ben–Eve 4',
        'Cal–Dee 4',
      ])
    })

    it('ranks a person with no colour like anyone else', () => {
      const d = data([{ id: 1, date: '2026-01-10' }], [], [[1, 'ben']])
      expect(stats(d).attendance[0].person).toBe(BEN)
      expect(BEN.colour).toBeNull()
    })
  })

  describe('breakdowns', () => {
    const d = data(
      [
        {
          id: 1,
          date: '2026-01-01',
          genres: ['Drama', 'Crime'],
          directors: ['Dir A'],
          year: 1994,
          runtime: 89,
        },
        {
          id: 2,
          date: '2026-01-02',
          genres: ['Drama'],
          directors: ['Dir A'],
          year: 1999,
          runtime: 90,
        },
        {
          id: 3,
          date: '2026-01-03',
          genres: ['Space Opera'],
          directors: ['Dir B'],
          year: 2001,
          runtime: 149,
        },
        { id: 4, date: '2026-01-04', genres: [], directors: [], year: null, runtime: null },
        {
          id: 5,
          date: '2026-01-05',
          genres: ['Crime'],
          directors: ['Dir B'],
          year: 2000,
          runtime: 150,
        },
      ],
      [...scored(1, { ana: 6 }), ...scored(2, { ana: 8 }), ...scored(5, { ana: 9 })],
    )
    const s = stats(d)
    const show = (gs: typeof s.genres) => gs.map((g) => [g.label, g.count, g.avg])

    it('counts a film once in each genre, sorted by count then average, Unknown last', () => {
      expect(show(s.genres)).toEqual([
        ['Crime', 2, 7.5],
        ['Drama', 2, 7],
        ['Space Opera', 1, null],
        [null, 1, null],
      ])
    })

    it('lists directors with at least 2 films, Unknown too', () => {
      // Same count: the higher average first. Only one film has no director: no Unknown row.
      expect(show(s.directors)).toEqual([
        ['Dir B', 2, 9],
        ['Dir A', 2, 7],
      ])
      const two = stats(
        data([
          { id: 1, date: '2026-01-01', directors: [] },
          { id: 2, date: '2026-01-02', directors: [] },
          { id: 3, date: '2026-01-03', directors: ['Dir A'] },
          { id: 4, date: '2026-01-04', directors: ['Dir A'] },
        ]),
      )
      expect(show(two.directors)).toEqual([
        ['Dir A', 2, null],
        [null, 2, null],
      ])
    })

    it('keeps the 20 directors with the most films', () => {
      const films = Array.from({ length: 21 }, (_, i) => i).flatMap((n) =>
        // Director 0 has 3 films, the others 2 each.
        Array.from({ length: n === 0 ? 3 : 2 }, (_, k) => ({
          id: n * 10 + k + 1,
          date: '2026-01-01',
          directors: [`Dir ${String(n).padStart(2, '0')}`],
        })),
      )
      const list = stats(data(films)).directors
      expect(list).toHaveLength(20)
      expect(list[0]).toMatchObject({ label: 'Dir 00', count: 3 })
      // Same count and no average: by name, so Dir 20 is the one cut.
      expect(list.at(-1)!.label).toBe('Dir 19')
    })

    it('lists decades oldest first, Unknown last', () => {
      expect(show(s.decades)).toEqual([
        ['1990s', 2, 7],
        ['2000s', 2, 9],
        [null, 1, null],
      ])
    })

    it('lists runtime bands in their natural order, Unknown last', () => {
      expect(show(s.runtimes)).toEqual([
        ['< 90 min', 1, 6],
        ['90–119 min', 1, 8],
        ['120–149 min', 1, null],
        ['150+ min', 1, 9],
        [null, 1, null],
      ])
    })

    it('puts 119 minutes in 90–119 and 120 in 120–149', () => {
      const edges = stats(
        data([
          { id: 1, date: '2026-01-01', runtime: 119 },
          { id: 2, date: '2026-01-02', runtime: 120 },
        ]),
      )
      expect(show(edges.runtimes)).toEqual([
        ['90–119 min', 1, null],
        ['120–149 min', 1, null],
      ])
    })
  })

  describe('over time', () => {
    const d = data(
      [
        { id: 1, date: '2024-12-31' },
        { id: 2, date: '2025-03-01' },
        { id: 3, date: '2025-03-15' },
        { id: 4, date: '2025-03-29' },
        { id: 5, date: '2025-11-02' },
        { id: 6, date: '2026-01-10' },
      ],
      // Film averages: 1 → 9; 2 → 7.25; 3 → 6; 4 none; 5 none; 6 → 5.
      [
        ...scored(1, { ana: 9 }),
        ...scored(2, { ana: 7, ben: 7.5 }),
        ...scored(3, { ben: 6 }),
        ...scored(6, { cal: 5 }),
      ],
      [
        [2, 'ana'],
        [2, 'ben'],
        [3, 'ana'],
        [5, 'ana'],
        [5, 'ben'],
        [5, 'cal'],
      ],
    )
    const show = (year = '') =>
      stats(d, year).overTime.map((p) => [p.label, p.films, p.avg, p.attendance])

    it('gives one row per year with screenings, oldest first, for all time', () => {
      expect(show()).toEqual([
        ['2024', 1, 9, 0],
        // (7.25 + 6) / 2 = 6.625 → 6.63; present 2, 1, 0, 3 → 1.5.
        ['2025', 4, 6.63, 1.5],
        ['2026', 1, 5, 0],
      ])
    })

    it('gives one row per month with screenings, in calendar order, for a year', () => {
      // No row for the months in between; March's films 2–4 average 7.25 and 6, film 4 has none.
      expect(show('2025')).toEqual([
        ['March', 3, 6.63, 1],
        ['November', 1, null, 3],
      ])
    })

    it('gives a single month row for a year with one screening', () => {
      expect(show('2024')).toEqual([['December', 1, 9, 0]])
    })

    it('rounds attendance per screening to two decimals', () => {
      const thirds = data(
        [
          { id: 1, date: '2026-05-01' },
          { id: 2, date: '2026-05-02' },
          { id: 3, date: '2026-05-03' },
        ],
        [],
        [
          [1, 'ana'],
          [2, 'ana'],
          [2, 'ben'],
          [2, 'cal'],
          [2, 'dee'],
        ],
      )
      // Present 1, 4, 0: 5 / 3 = 1.666… → 1.67; no scores at all → null.
      expect(stats(thirds, '2026').overTime).toEqual([
        { label: 'May', films: 3, avg: null, attendance: 1.67 },
      ])
    })
  })
})

describe('chartGenres', () => {
  const group = (label: string | null, count: number) => ({ label, count, avg: null })

  it('keeps the first 10 of 12 genres in their order, then Unknown last', () => {
    const genres = [
      ...Array.from({ length: 12 }, (_, i) => group(`G${i + 1}`, 20 - i)),
      group(null, 30),
    ]
    expect(chartGenres(genres).map((g) => g.label)).toEqual([
      ...['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'G9', 'G10'],
      null,
    ])
  })

  it('keeps all of a short list, with no Unknown when every film has a genre', () => {
    const genres = [group('Drama', 2), group('Crime', 1)]
    expect(chartGenres(genres)).toEqual(genres)
  })
})
