import { KIND_LABELS, type FilmKind, type Person } from './films'

/** A TMDB search result from the tmdb-search Edge Function. */
export interface TmdbResult {
  tmdb_id: number
  title: string
  original_title: string | null
  year: number | null
  poster_path: string | null
  directors: string[]
  /** Set when the film is already in the club's list. */
  watched: { film_id: number; screened_on: string; kind: FilmKind } | null
}

/** What film-save takes (see supabase/functions/film-save). */
export interface FilmSaveBody {
  id?: number
  tmdb_id: number | null
  title?: string
  release_year?: number
  screened_on: string
  kind: FilmKind
  assigned_id: string
  turn_holder_id: string | null
}

/** The form's fields. `picked` = the chosen TMDB film; `manual` = saving without TMDB. */
export interface FilmFormState {
  picked: Pick<TmdbResult, 'tmdb_id' | 'title' | 'original_title' | 'year'> | null
  manual: boolean
  title: string
  year: string
  screenedOn: string
  kind: FilmKind
  assignedId: string
  turnHolderId: string
}

/** Today in Europe/Lisbon if it's a Saturday, else the next Saturday (YYYY-MM-DD). */
export function comingSaturday(now = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  const today = now.toLocaleDateString('en-CA', { timeZone: 'Europe/Lisbon' })
  const [y, m, d] = today.split('-').map(Number)
  const t = Date.UTC(y, m - 1, d, 12)
  const days = (6 - new Date(t).getUTCDay() + 7) % 7
  return new Date(t + days * 86_400_000).toISOString().slice(0, 10)
}

/** The "Cinema" system profile: the chooser for cinema trips with no proposer. */
export const cinemaProfile = (people: Person[]) =>
  people.find((p) => p.isSystem && p.name === 'Cinema')

/**
 * Who a kind is assigned to by default: Manel for a Maratona, the Cinema
 * profile for Cinema; '' otherwise.
 * shortcut: finds Manel by name; switch to an app_settings key if he is ever renamed.
 */
export function defaultChooser(kind: FilmKind, people: Person[]): string {
  if (kind === 'maratona') {
    return people.find((p) => !p.isSystem && p.name.trim().toLowerCase() === 'manel')?.id ?? ''
  }
  if (kind === 'cinema') return cinemaProfile(people)?.id ?? ''
  return ''
}

/** The chooser after the kind changes: a default replaces an empty choice or the old kind's default. */
export function chooserForKind(
  assignedId: string,
  from: FilmKind,
  to: FilmKind,
  people: Person[],
): string {
  return !assignedId || assignedId === defaultChooser(from, people)
    ? defaultChooser(to, people)
    : assignedId
}

/** "Already watched on 2026/01/10 (Cinema)". */
export function alreadyWatched(screenedOn: string, kind: FilmKind): string {
  const label = KIND_LABELS[kind]
  return `Already watched on ${screenedOn.replaceAll('-', '/')}${label ? ` (${label})` : ''}`
}

/** A release year as typed, or null if it isn't one. */
export function parseYear(text: string): number | null {
  const year = Number(text.trim())
  return /^\d{4}$/.test(text.trim()) && year >= 1870 && year <= 2100 ? year : null
}

/** The film-save body (an edit when `filmId` is given), or the first problem to show. */
export function toSaveBody(
  s: FilmFormState,
  filmId?: number,
): { body: FilmSaveBody } | { error: string } {
  let film: Pick<FilmSaveBody, 'tmdb_id' | 'title' | 'release_year'>
  if (s.manual) {
    const title = s.title.trim()
    const year = parseYear(s.year)
    if (!title) return { error: 'Enter the title.' }
    if (year === null) return { error: 'Enter the release year (e.g. 1999).' }
    film = { tmdb_id: null, title, release_year: year }
  } else if (s.picked) {
    film = { tmdb_id: s.picked.tmdb_id }
  } else {
    return { error: 'Pick the film from TMDB, or save without TMDB.' }
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.screenedOn)) return { error: 'Enter the screening date.' }
  if (!s.assignedId) return { error: 'Choose who chose the film.' }
  const democratico = s.kind === 'democratico'
  if (democratico && !s.turnHolderId && filmId === undefined) {
    return { error: 'Choose whose turn it was.' }
  }
  return {
    body: {
      ...(filmId === undefined ? {} : { id: filmId }),
      ...film,
      screened_on: s.screenedOn,
      kind: s.kind,
      assigned_id: s.assignedId,
      turn_holder_id: democratico && s.turnHolderId ? s.turnHolderId : null,
    },
  }
}

/** An Edge Function's refusal, as thrown by api.ts. */
export interface FunctionError {
  status: number
  error?: string
  film?: { id: number; screened_on: string; kind: FilmKind } | null
}

/** Friendly text for a failed search or save; raw server messages are never shown. */
export function functionErrorMessage(e: unknown): string {
  const { status, error, film } = (e ?? {}) as Partial<FunctionError>
  if (status === 409) {
    return film ? `${alreadyWatched(film.screened_on, film.kind)}.` : 'This film is already listed.'
  }
  if (status === 401) return 'Your session has ended. Log in again.'
  if (status === 403) return 'Only moderators and admins can do that.'
  if (status === 429) return 'Too many searches. Wait a minute and try again.'
  if (status === 404 && error === 'tmdb_not_found')
    return "TMDB doesn't have that film. Search again."
  if (status === 404) return 'This film was removed elsewhere.'
  if (status === 502) return "TMDB isn't answering. Try again, or save without TMDB."
  if (status === 400) return "That value isn't allowed."
  if (!status) return "Couldn't reach the server. Try again."
  return 'Something went wrong. Try again.'
}
