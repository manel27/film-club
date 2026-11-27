import { compareTitles, KIND_LABELS, KINDS, type FilmKind, type Person } from '../films/films'
import { mean, normaliseName } from '../people/profile'

/** A screened film as stats_data() returns it (migration 20261128120000). */
export interface StatsFilm {
  id: number
  title: string
  releaseYear: number | null
  screenedOn: string // YYYY-MM-DD
  /** Null: a kind this app doesn't know (counted in no kind). */
  kind: FilmKind | null
  assignedId: string
  genres: string[]
  directors: string[]
  runtimeMin: number | null
}

export interface StatsData {
  films: StatsFilm[]
  scores: { filmId: number; profileId: string; score: number }[]
  attendance: { filmId: number; profileId: string }[]
}

/** Minimum counts for each ranking (shown under it). */
export const MIN = {
  filmScores: 3,
  chosenFilms: 3,
  scoresGiven: 10,
  sharedFilms: 5,
  directorFilms: 2,
}
const TOP = 10
const PAIRS = 5
/** Rows in the director table. */
export const DIRECTOR_ROWS = 20

const isId = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''
const rows = (v: unknown): unknown[][] =>
  Array.isArray(v) ? v.filter((r): r is unknown[] => Array.isArray(r)) : []

/** A real calendar date as YYYY-MM-DD (not 2026-02-31). */
function isDate(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const t = Date.parse(`${v}T00:00:00Z`)
  return !Number.isNaN(t) && new Date(t).toISOString().startsWith(v)
}

const whole = (v: unknown, min: number, max: number) =>
  Number.isSafeInteger(v) && (v as number) >= min && (v as number) <= max ? (v as number) : null

/** Names as the club sees them (zero-width characters out, spaces tidied), blanks and repeats dropped. */
const names = (v: unknown) =>
  Array.isArray(v)
    ? [...new Set(v.filter((x) => typeof x === 'string').map(normaliseName))].filter(Boolean)
    : []

/**
 * Reads stats_data()'s jsonb. Rows without a usable id or date, repeats, and
 * scores or marks of films not in the list are skipped; other bad fields become
 * unknown. Films screened after `today` (YYYY-MM-DD) are dropped too, though the
 * database already leaves them out.
 */
export function parseStatsData(raw: unknown, today: string): StatsData {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const films = new Map<number, StatsFilm>()
  for (const [id, title, year, date, kind, assigned, genres, directors, runtime] of rows(
    obj.films,
  )) {
    if (!isId(id) || films.has(id) || !isDate(date) || date > today) continue
    films.set(id, {
      id,
      title: isText(title) ? normaliseName(title) || 'Untitled' : 'Untitled',
      releaseYear: whole(year, 1, 9999),
      screenedOn: date,
      kind: KINDS.includes(kind as FilmKind) ? (kind as FilmKind) : null,
      assignedId: isText(assigned) ? assigned : '',
      genres: names(genres),
      directors: names(directors),
      runtimeMin: whole(runtime, 1, 10_000),
    })
  }
  const seen = new Set<string>()
  const fresh = (kind: string, filmId: unknown, profileId: unknown) => {
    if (!isId(filmId) || !films.has(filmId) || !isText(profileId)) return false
    const key = `${kind} ${filmId} ${profileId}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }
  return {
    films: [...films.values()],
    scores: rows(obj.scores).flatMap(([filmId, profileId, score]) =>
      typeof score === 'number' &&
      Number.isFinite(score) &&
      score >= 0 &&
      score < 100 &&
      fresh('s', filmId, profileId)
        ? [{ filmId: filmId as number, profileId: profileId as string, score }]
        : [],
    ),
    attendance: rows(obj.attendance).flatMap(([filmId, profileId]) =>
      fresh('a', filmId, profileId)
        ? [{ filmId: filmId as number, profileId: profileId as string }]
        : [],
    ),
  }
}

/** Years with screenings, newest first. */
export const statsYears = (data: StatsData) =>
  [...new Set(data.films.map((f) => f.screenedOn.slice(0, 4)))].sort().reverse()

/** The ?year= value if it is one of `years`, else '' (All time). */
export const readYear = (value: string | null, years: string[]) =>
  value != null && years.includes(value) ? value : ''

export interface FilmStat {
  film: StatsFilm
  avg: number | null
  scores: number
  /** Population standard deviation of its scores, two decimals; null with no scores. */
  sd: number | null
  present: number
}

export interface Group {
  /** Null: films missing this data ("Unknown"). */
  label: string | null
  count: number
  avg: number | null
}

/** One year (all time) or one month (a single year) with screenings. */
export interface Period {
  /** "2019", or the month's English name ("March"). */
  label: string
  films: number
  /** Mean of the film averages; null when no film has a score. */
  avg: number | null
  /** Mean people present per screening. */
  attendance: number
}

export interface Pair {
  a: Person
  b: Person
  /** Mean absolute score difference on the films both scored. */
  diff: number
  shared: number
}

export interface Stats {
  overview: {
    films: number
    scores: number
    clubAvg: number | null
    avgAttendance: number | null
    kinds: { kind: FilmKind; label: string; count: number }[]
    first: string | null
    last: string | null
  }
  top: FilmStat[]
  bottom: FilmStat[]
  divisive: FilmStat[]
  attended: FilmStat[]
  /** Oldest first: years for all time, months for a single year. */
  overTime: Period[]
  attendance: { person: Person; count: number; pct: number }[]
  choosers: { person: Person; avg: number; films: number }[]
  /** Kindest first, harshest last. */
  scorers: { person: Person; avg: number; scores: number }[]
  alike: Pair[]
  unalike: Pair[]
  genres: Group[]
  directors: Group[]
  decades: Group[]
  runtimes: Group[]
}

const RUNTIME_BANDS: [max: number, label: string][] = [
  [89, '< 90 min'],
  [119, '90–119 min'],
  [149, '120–149 min'],
  [Infinity, '150+ min'],
]

// Fixed names, like films.ts (no locale data involved).
const MONTHS = [
  ...['January', 'February', 'March', 'April', 'May', 'June'],
  ...['July', 'August', 'September', 'October', 'November', 'December'],
]

/** Years (all time) or months of `year` that have screenings, oldest first. */
function overTime(films: FilmStat[], year: string): Period[] {
  const map = new Map<string, FilmStat[]>()
  for (const s of films) {
    const key = year ? s.film.screenedOn.slice(0, 7) : s.film.screenedOn.slice(0, 4)
    map.set(key, [...(map.get(key) ?? []), s])
  }
  return [...map]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, g]) => ({
      label: year ? MONTHS[Number(key.slice(5)) - 1] : key,
      films: g.length,
      avg: mean(nums(g.map((s) => s.avg))),
      attendance: mean(g.map((s) => s.present))!,
    }))
}

/** Population standard deviation, worked in whole hundredths like mean(). */
function sd(xs: number[]): number | null {
  if (!xs.length) return null
  const h = xs.map((x) => Math.round(x * 100))
  const m = h.reduce((a, b) => a + b, 0) / h.length
  const variance = h.reduce((a, x) => a + (x - m) ** 2, 0) / h.length
  return Math.round(Math.sqrt(variance)) / 100
}

/** Most recent screening first, then title, then id: every ranking's tie-break. */
const byFilm = (a: FilmStat, b: FilmStat) =>
  b.film.screenedOn.localeCompare(a.film.screenedOn) ||
  compareTitles(a.film.title, b.film.title) ||
  a.film.id - b.film.id

const byName = (a: Person, b: Person) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)

const nums = (xs: (number | null)[]) => xs.filter((x): x is number => x != null)

/**
 * Films per label with their mean average; films with no label go under Unknown
 * (null), always last. Labels with fewer than `min` films are left out, Unknown
 * too. Sorted by count, then average, unless `order` gives the labels' natural
 * order (bands, decades).
 */
function groups(
  films: FilmStat[],
  keys: (f: StatsFilm) => string[],
  { min = 1, order }: { min?: number; order?: (label: string) => number } = {},
): Group[] {
  const map = new Map<string | null, FilmStat[]>()
  for (const s of films) {
    const ks = keys(s.film)
    for (const k of ks.length ? ks : [null]) map.set(k, [...(map.get(k) ?? []), s])
  }
  return [...map]
    .filter(([, g]) => g.length >= min)
    .map(([label, g]) => ({ label, count: g.length, avg: mean(nums(g.map((s) => s.avg))) }))
    .sort(
      (a, b) =>
        +(a.label == null) - +(b.label == null) ||
        (order && a.label != null && b.label != null ? order(a.label) - order(b.label) : 0) ||
        b.count - a.count ||
        (b.avg ?? -1) - (a.avg ?? -1) ||
        (a.label ?? '').localeCompare(b.label ?? ''),
    )
}

/** The genre chart's bars: the 10 genres with the most films, then Unknown. */
export const chartGenres = (genres: Group[]) => [
  ...genres.filter((g) => g.label != null).slice(0, 10),
  ...genres.filter((g) => g.label == null),
]

/**
 * Every number on the Stats page for one period: `year` (YYYY) or '' for all
 * time. Only non-system people from `people` are ranked; every score counts
 * toward film averages, as in film_stats.
 */
export function computeStats(data: StatsData, people: Person[], year: string): Stats {
  const films = data.films.filter((f) => !year || f.screenedOn.startsWith(year))
  const ids = new Set(films.map((f) => f.id))
  const scores = data.scores.filter((s) => ids.has(s.filmId))
  const attendance = data.attendance.filter((a) => ids.has(a.filmId))

  const scoresOf = new Map<number, number[]>()
  for (const s of scores) scoresOf.set(s.filmId, [...(scoresOf.get(s.filmId) ?? []), s.score])
  const presentOf = new Map<number, number>()
  for (const a of attendance) presentOf.set(a.filmId, (presentOf.get(a.filmId) ?? 0) + 1)
  const filmStats: FilmStat[] = films.map((film) => {
    const xs = scoresOf.get(film.id) ?? []
    return {
      film,
      avg: mean(xs),
      scores: xs.length,
      sd: sd(xs),
      present: presentOf.get(film.id) ?? 0,
    }
  })
  const avgOf = new Map(filmStats.map((s) => [s.film.id, s.avg]))
  const dates = films.map((f) => f.screenedOn).sort()

  const scored = filmStats.filter((s) => s.scores >= MIN.filmScores)
  const rank = (list: FilmStat[], stat: (s: FilmStat) => number) =>
    [...list].sort((a, b) => stat(b) - stat(a) || byFilm(a, b)).slice(0, TOP)

  const ranked = people.filter((p) => !p.isSystem).sort(byName)
  const given = new Map(ranked.map((p) => [p.id, new Map<number, number>()]))
  for (const s of scores) given.get(s.profileId)?.set(s.filmId, s.score)

  const pairs: Pair[] = []
  ranked.forEach((a, i) => {
    const mine = given.get(a.id)!
    for (const b of ranked.slice(i + 1)) {
      const theirs = given.get(b.id)!
      const diffs = [...mine].flatMap(([id, x]) =>
        theirs.has(id)
          ? [Math.abs(Math.round(x * 100) - Math.round(theirs.get(id)! * 100)) / 100]
          : [],
      )
      if (diffs.length >= MIN.sharedFilms)
        pairs.push({ a, b, diff: mean(diffs)!, shared: diffs.length })
    }
  })
  const pairOrder = (x: Pair, y: Pair) => byName(x.a, y.a) || byName(x.b, y.b)

  return {
    overview: {
      films: films.length,
      scores: scores.length,
      clubAvg: mean(nums(filmStats.map((s) => s.avg))),
      avgAttendance: mean(filmStats.map((s) => s.present)),
      kinds: KINDS.map((kind) => ({
        kind,
        label: KIND_LABELS[kind] ?? 'Normal',
        count: films.filter((f) => f.kind === kind).length,
      })),
      first: dates[0] ?? null,
      last: dates.at(-1) ?? null,
    },
    top: rank(scored, (s) => s.avg!),
    bottom: rank(scored, (s) => -s.avg!),
    divisive: rank(scored, (s) => s.sd!),
    attended: rank(
      filmStats.filter((s) => s.present > 0),
      (s) => s.present,
    ),
    overTime: overTime(filmStats, year),
    attendance: ranked
      .map((person) => {
        const count = attendance.filter((a) => a.profileId === person.id).length
        return { person, count, pct: Math.round((count * 100) / films.length) }
      })
      .filter((r) => r.count > 0)
      .sort((a, b) => b.count - a.count || byName(a.person, b.person)),
    choosers: ranked
      .flatMap((person) => {
        const avgs = nums(
          films.filter((f) => f.assignedId === person.id).map((f) => avgOf.get(f.id)!),
        )
        return avgs.length >= MIN.chosenFilms
          ? [{ person, avg: mean(avgs)!, films: avgs.length }]
          : []
      })
      .sort((a, b) => b.avg - a.avg || byName(a.person, b.person))
      .slice(0, TOP),
    scorers: ranked
      .flatMap((person) => {
        const xs = [...given.get(person.id)!.values()]
        return xs.length >= MIN.scoresGiven ? [{ person, avg: mean(xs)!, scores: xs.length }] : []
      })
      .sort((a, b) => b.avg - a.avg || byName(a.person, b.person)),
    alike: [...pairs].sort((x, y) => x.diff - y.diff || pairOrder(x, y)).slice(0, PAIRS),
    unalike: [...pairs].sort((x, y) => y.diff - x.diff || pairOrder(x, y)).slice(0, PAIRS),
    genres: groups(filmStats, (f) => f.genres),
    directors: groups(filmStats, (f) => f.directors, { min: MIN.directorFilms }).slice(
      0,
      DIRECTOR_ROWS,
    ),
    decades: groups(
      filmStats,
      (f) => (f.releaseYear == null ? [] : [`${Math.floor(f.releaseYear / 10) * 10}s`]),
      { order: parseInt },
    ),
    runtimes: groups(
      filmStats,
      (f) =>
        f.runtimeMin == null ? [] : [RUNTIME_BANDS.find(([max]) => f.runtimeMin! <= max)![1]],
      { order: (label) => RUNTIME_BANDS.findIndex(([, l]) => l === label) },
    ),
  }
}
