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

/** Sort options and their labels; the first is the default. */
export const SORTS = {
  newest: 'Newest screening',
  oldest: 'Oldest screening',
  title: 'Title A–Z',
  'title-desc': 'Title Z–A',
  'year-desc': 'Newest release',
  year: 'Oldest release',
  'score-desc': 'Highest average',
  score: 'Lowest average',
} as const

export type Sort = keyof typeof SORTS

/** Only the screening-date sorts group films into weeks. */
export const isDateSort = (sort: Sort) => sort === 'newest' || sort === 'oldest'

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

/**
 * The screening dates of a week as "2026/11/13 · 2026/11/14", in the order
 * given (the current sort order). Calendar dates, so no time zone applies.
 */
export function weekHeading(dates: string[]): string {
  return [...new Set(dates)].map((d) => d.replaceAll('-', '/')).join(' · ')
}

export interface WeekGroup {
  weekStart: string
  heading: string
  films: FilmItem[]
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base' })
// Ignores a leading English article, so "The Thing" sorts under T.
const sortTitle = (title: string) => title.replace(/^(the|an?)\s+/i, '')

/** Compares possibly missing numbers in `dir` (1 = ascending); missing values always go last. */
function byValue(a: number | null, b: number | null, dir: number): number {
  if (a == null || b == null) return (a == null ? 1 : 0) - (b == null ? 1 : 0)
  return dir * (a - b)
}

/**
 * Sorts by the chosen key. Screening-date sorts keep same-day films in their
 * day_order; every other sort breaks ties by screening date (newest first),
 * then title. Films with no year or average go last in both directions.
 */
export function sortFilms(films: FilmItem[], sort: Sort): FilmItem[] {
  const date = (a: FilmItem, b: FilmItem) =>
    b.screenedOn.localeCompare(a.screenedOn) || a.dayOrder - b.dayOrder
  const title = (a: FilmItem, b: FilmItem) =>
    collator.compare(sortTitle(a.title), sortTitle(b.title))
  const key: Record<Sort, (a: FilmItem, b: FilmItem) => number> = {
    newest: date,
    oldest: (a, b) => a.screenedOn.localeCompare(b.screenedOn) || a.dayOrder - b.dayOrder,
    title,
    'title-desc': (a, b) => title(b, a),
    year: (a, b) => byValue(a.releaseYear, b.releaseYear, 1),
    'year-desc': (a, b) => byValue(a.releaseYear, b.releaseYear, -1),
    score: (a, b) => byValue(a.avgScore, b.avgScore, 1),
    'score-desc': (a, b) => byValue(a.avgScore, b.avgScore, -1),
  }
  return [...films].sort((a, b) => key[sort](a, b) || date(a, b) || title(a, b) || a.id - b.id)
}

/** Groups films, already sorted by screening date, into Mon–Sun weeks. */
export function groupByWeek(sorted: FilmItem[]): WeekGroup[] {
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

export const KINDS = Object.keys(KIND_LABELS) as FilmKind[]

export interface PageState {
  /** posters = grouped by week; grid = one continuous poster grid with no dates. */
  view: 'list' | 'posters' | 'grid'
  sort: Sort
  filters: Filters
}

/** Reads the page state from URL search params (unknown view/sort/kind values are ignored). */
export function readParams(params: URLSearchParams): PageState {
  const kind = params.get('kind') ?? ''
  const view = params.get('view')
  const sort = params.get('sort') ?? ''
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
    view: view === 'posters' || view === 'grid' ? view : 'list',
    sort: Object.hasOwn(SORTS, sort) ? (sort as Sort) : 'newest',
    filters,
  }
}

/** The page state as search params, defaults left out (known keys only). */
export function toParams({ view, sort, filters: f }: PageState): URLSearchParams {
  const p = new URLSearchParams()
  if (view !== 'list') p.set('view', view)
  if (sort !== 'newest') p.set('sort', sort)
  if (f.present.length > 0) p.set('present', f.present.join(','))
  if (f.presentMode === 'all') p.set('presentMode', 'all')
  for (const key of ['genre', 'assigned', 'kind', 'year'] as const) if (f[key]) p.set(key, f[key])
  if (f.unscored) p.set('unscored', '1')
  return p
}

export interface FilterOptions {
  present: Set<string>
  genres: Set<string>
  assigned: Set<string>
  years: Set<string>
  canScore: boolean
}

/** Drops filter values that match no option (stale links, old localStorage), so no hidden filter is ever active. */
export function validFilters(f: Filters, o: FilterOptions): Filters {
  return {
    ...f,
    present: f.present.filter((id) => o.present.has(id)),
    genre: o.genres.has(f.genre) ? f.genre : '',
    assigned: o.assigned.has(f.assigned) ? f.assigned : '',
    year: o.years.has(f.year) ? f.year : '',
    unscored: f.unscored && o.canScore,
  }
}
