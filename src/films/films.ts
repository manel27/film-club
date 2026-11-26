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
  /** Jurassic Shark 2: left out of profiles and every aggregate (plan 4.4). */
  isEasterEgg: boolean
}

export interface Person {
  id: string
  name: string
  colour: string | null
  isSystem: boolean
  /** Viewers aren't in the rotation. Missing = not known (treated as in it). */
  role?: Database['public']['Enums']['profile_role']
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

/**
 * The rating band of an average, as shown (rounded to 2 decimals), lower bounds
 * inclusive: 3.00 is bad, 4.99 still bad, 5.00 okay.
 */
const BANDS: [min: number, emoji: string, label: string][] = [
  [9.5, '🔥', 'outstanding'],
  [8, '👏', 'great'],
  [6.5, '👌', 'good'],
  [5, '😐', 'okay'],
  [3, '👎', 'bad'],
  [-Infinity, '🤮', 'awful'],
]

export function ratingBand(avg: number): { emoji: string; label: string } {
  const shown = Number(avg.toFixed(2))
  const [, emoji, label] = BANDS.find(([min]) => shown >= min) ?? BANDS[BANDS.length - 1]
  return { emoji, label }
}

// Fixed names: Intl's en-GB says "Sept" and adds a comma.
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * A calendar date (YYYY-MM-DD) as "Sat 5 Dec 2026", or "Today" when it is `today`.
 * Anchored at 12:00 UTC so no browser time zone can shift the day. Not a real date: "Date unknown".
 */
export function screeningDay(date: string, today: string): string {
  if (date === today) return 'Today'
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  const t = m ? Date.UTC(+m[1], +m[2] - 1, +m[3], 12) : NaN
  // Date.UTC rolls 2026-02-31 over to March: reject it.
  if (!m || new Date(t).toISOString().slice(0, 10) !== date) return 'Date unknown'
  const d = new Date(t)
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

/**
 * The film added for the next screening: the earliest on or after `today`
 * (Lisbon), lowest day_order first. The easter egg never counts.
 */
export function nextFilm(films: FilmItem[], today: string): FilmItem | undefined {
  return films
    .filter((f) => !f.isEasterEgg && f.screenedOn >= today)
    .sort((a, b) => a.screenedOn.localeCompare(b.screenedOn) || a.dayOrder - b.dayOrder)[0]
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })
// Ignores leading punctuation and an English article, so '"The Thing"' sorts under T.
const sortTitle = (title: string) => title.replace(/^[\p{P}\s]+/u, '').replace(/^(the|an?)\s+/i, '')

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
  /** posters = the list with a poster thumbnail on each row; grid = posters only. */
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
    view: view === 'list' || view === 'grid' ? view : 'posters',
    sort: Object.hasOwn(SORTS, sort) ? (sort as Sort) : 'newest',
    filters,
  }
}

/** The page state as search params, defaults left out (known keys only). */
export function toParams({ view, sort, filters: f }: PageState): URLSearchParams {
  const p = new URLSearchParams()
  if (view !== 'posters') p.set('view', view)
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
