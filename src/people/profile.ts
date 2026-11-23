import { errorMessage } from '../films/filmDetail'
import type { FilmItem, Person } from '../films/films'

export interface ProfileStats {
  watched: number
  chosen: number
  scores: number
  /** Null when there is nothing to average. */
  avgGiven: number | null
  /** Mean of the averages of the films they chose (films with no scores left out). */
  avgChosen: number | null
  comments: number
}

/**
 * The mean rounded to two decimals like Postgres round(avg(x), 2): values
 * (at most two decimals) are summed in whole hundredths, so there is no float
 * error, and a half rounds away from zero. Null for no values.
 */
export function mean(xs: number[]): number | null {
  if (!xs.length) return null
  const hundredths = xs.reduce((sum, x) => sum + Math.round(x * 100), 0) / xs.length
  return (Math.sign(hundredths) * Math.round(Math.abs(hundredths))) / 100
}

/** A person's stats. The easter egg counts for nothing (plan 4.4). */
export function profileStats(
  personId: string,
  films: FilmItem[],
  scores: Map<number, number>,
  commentFilmIds: number[],
): ProfileStats {
  const egg = new Set(films.filter((f) => f.isEasterEgg).map((f) => f.id))
  // Every film assigned to them, future and Maratona included (decision P4).
  const chosen = films.filter((f) => !egg.has(f.id) && f.assignedId === personId)
  const given = [...scores].filter(([id]) => !egg.has(id)).map(([, s]) => s)
  return {
    watched: films.filter((f) => !egg.has(f.id) && f.presentIds.includes(personId)).length,
    chosen: chosen.length,
    scores: given.length,
    avgGiven: mean(given),
    avgChosen: mean(chosen.flatMap((f) => (f.avgScore == null ? [] : [f.avgScore]))),
    comments: commentFilmIds.filter((id) => !egg.has(id)).length,
  }
}

/**
 * The profile tabs: films they were present at, and every other film. The
 * easter egg and films screened after `today` (YYYY-MM-DD) are in neither
 * (decisions P3, P4).
 */
export function profileTabs(personId: string, films: FilmItem[], today: string) {
  const shown = films.filter((f) => !f.isEasterEgg && f.screenedOn <= today)
  return {
    watched: shown.filter((f) => f.presentIds.includes(personId)),
    'not-watched': shown.filter((f) => !f.presentIds.includes(personId)),
  }
}

/** Mirrors the profiles check constraints (1–50 characters after trimming). */
export const NAME_MAX = 50

/**
 * A name as the club sees it: zero-width and other format characters (Unicode
 * Cf) removed, any run of whitespace (tabs, newlines, no-break spaces…) made
 * one space, then trimmed.
 */
export const normaliseName = (text: string) =>
  text
    .replace(/\p{Cf}/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()

/**
 * A display name as typed, normalised, then checked like the database:
 * 1–50 characters, no control characters, at least one letter or digit, and
 * nobody else's (ignoring case).
 */
export function parseName(
  text: string,
  people: Person[],
  me: string,
): { name: string } | { error: string } {
  const name = normaliseName(text)
  if (!name) return { error: 'Enter a name.' }
  // Code points, like char_length (an emoji is one).
  if ([...name].length > NAME_MAX) return { error: `Use at most ${NAME_MAX} characters.` }
  if (/\p{Cc}/u.test(name)) return { error: "Names can't contain control characters." }
  if (!/[\p{L}\p{N}]/u.test(name)) return { error: 'Use at least one letter or digit.' }
  const lower = name.toLowerCase()
  if (people.some((p) => p.id !== me && normaliseName(p.name).toLowerCase() === lower)) {
    return { error: 'Someone already has that name.' }
  }
  return { name }
}

/** Friendly text for a failed rename (the unique index and checks are the real guards). */
export function renameError(error: unknown): string {
  const { code } = (error ?? {}) as { code?: string }
  if (code === '23505') return 'Someone already has that name.'
  if (code === '23514') return `Use 1 to ${NAME_MAX} characters, with a letter or digit.`
  return errorMessage(error)
}

/** Friendly text for a failed admin edit of someone (profiles_guard's refusals, then as a rename). */
export function personSaveError(error: unknown): string {
  const { message } = (error ?? {}) as { message?: string }
  if (message?.includes('last admin')) return 'The club needs at least one admin.'
  if (message?.includes('own role')) return "You can't change your own role."
  return renameError(error)
}

export const ROLE_NAMES: Record<NonNullable<Person['role']>, string> = {
  admin: 'Admin',
  moderator: 'Moderator',
  member: 'Member',
  viewer: 'Viewer',
}
