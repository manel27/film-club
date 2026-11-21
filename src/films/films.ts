import type { Database } from '../lib/database.types'

export type FilmKind = Database['public']['Enums']['film_kind']

/** One film as the films page uses it. */
export interface FilmItem {
  id: number
  title: string
  releaseYear: number | null
  posterPath: string | null
  genres: string[]
  screenedOn: string // YYYY-MM-DD
  dayOrder: number
  kind: FilmKind
  assignedId: string
  presentIds: string[]
  /** Average without the easter egg's locked scores (from film_stats). */
  avgScore: number | null
}

export interface Person {
  id: string
  name: string
  colour: string | null
  isSystem: boolean
}

export type Sort = 'newest' | 'oldest'

export interface Filters {
  present: string[]
  presentMode: 'any' | 'all'
  genre: string
  assigned: string
  kind: FilmKind | ''
  year: string
  unscored: boolean
}

export const KIND_LABELS: Record<FilmKind, string | null> = {
  normal: null,
  democratico: 'Democrático',
  cinema: 'Cinema',
  maratona: 'Maratona',
}

const DAY_MS = 86_400_000

// screened_on is a calendar date with no time. Anchoring it at 12:00 UTC keeps
// it on the same day in Europe/Lisbon (UTC+0/+1) whatever the browser's own
// time zone or DST, and the Monday is found with whole-day arithmetic.
function noonUtc(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return Date.UTC(y, m - 1, d, 12)
}

/** The Monday (YYYY-MM-DD) of the Mon–Sun week holding `date`. */
export function weekStart(date: string): string {
  const t = noonUtc(date)
  const daysSinceMonday = (new Date(t).getUTCDay() + 6) % 7
  return new Date(t - daysSinceMonday * DAY_MS).toISOString().slice(0, 10)
}

const dateParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Lisbon',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

/** "Sat 14 Nov 2026", or "Sat 14 Nov" without the year. */
export function formatDate(date: string, withYear = true): string {
  const p = Object.fromEntries(
    dateParts.formatToParts(noonUtc(date)).map((part) => [part.type, part.value]),
  )
  return `${p.weekday} ${p.day} ${p.month}${withYear ? ` ${p.year}` : ''}`
}

const andList = new Intl.ListFormat('en-GB', { type: 'conjunction' })

/**
 * "Week of Sat 14 Nov 2026". A week with several screening dates names them all
 * ("Week of Fri 13 Nov and Sat 14 Nov 2026"); the year is written once unless
 * the dates span two years.
 */
export function weekHeading(dates: string[]): string {
  const sorted = [...new Set(dates)].sort()
  const oneYear = sorted[0].slice(0, 4) === sorted[sorted.length - 1].slice(0, 4)
  const parts = sorted.map((d, i) => formatDate(d, !oneYear || i === sorted.length - 1))
  return `Week of ${andList.format(parts)}`
}

export interface WeekGroup {
  weekStart: string
  heading: string
  films: FilmItem[]
}

/**
 * Sorts by screening date (newest or oldest first); films shown on the same day
 * always keep their day_order. Then groups them into Mon–Sun weeks.
 */
export function groupByWeek(films: FilmItem[], sort: Sort): WeekGroup[] {
  const dir = sort === 'newest' ? -1 : 1
  const sorted = [...films].sort(
    (a, b) =>
      dir * a.screenedOn.localeCompare(b.screenedOn) || a.dayOrder - b.dayOrder || a.id - b.id,
  )
  const groups: WeekGroup[] = []
  for (const film of sorted) {
    const start = weekStart(film.screenedOn)
    const last = groups[groups.length - 1]
    if (last?.weekStart === start) last.films.push(film)
    else groups.push({ weekStart: start, heading: '', films: [film] })
  }
  for (const g of groups) g.heading = weekHeading(g.films.map((f) => f.screenedOn))
  return groups
}

/** `scored` = ids of films the logged-in profile has scored. */
export function filterFilms(films: FilmItem[], f: Filters, scored: Set<number>): FilmItem[] {
  return films.filter((film) => {
    if (f.present.length > 0) {
      const has = (id: string) => film.presentIds.includes(id)
      if (f.presentMode === 'all' ? !f.present.every(has) : !f.present.some(has)) return false
    }
    if (f.genre && !film.genres.includes(f.genre)) return false
    if (f.assigned && film.assignedId !== f.assigned) return false
    if (f.kind && film.kind !== f.kind) return false
    if (f.year && film.screenedOn.slice(0, 4) !== f.year) return false
    if (f.unscored && scored.has(film.id)) return false
    return true
  })
}

const KINDS = Object.keys(KIND_LABELS) as FilmKind[]

/** Reads the page state from URL search params (unknown values are ignored). */
export function readParams(params: URLSearchParams) {
  const kind = params.get('kind') ?? ''
  const filters: Filters = {
    present: params.get('present')?.split(',').filter(Boolean) ?? [],
    presentMode: params.get('presentMode') === 'all' ? 'all' : 'any',
    genre: params.get('genre') ?? '',
    assigned: params.get('assigned') ?? '',
    kind: KINDS.includes(kind as FilmKind) ? (kind as FilmKind) : '',
    year: params.get('year') ?? '',
    unscored: params.get('unscored') === '1',
  }
  return {
    view: params.get('view') === 'posters' ? ('posters' as const) : ('list' as const),
    sort: params.get('sort') === 'oldest' ? ('oldest' as const) : ('newest' as const),
    filters,
  }
}
