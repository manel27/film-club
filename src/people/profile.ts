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

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

/** A person's stats. The easter egg counts for nothing (plan 4.4). */
export function profileStats(
  personId: string,
  films: FilmItem[],
  scores: Map<number, number>,
  commentFilmIds: number[],
  easterEggIds: Set<number>,
): ProfileStats {
  const counted = films.filter((f) => !easterEggIds.has(f.id))
  const chosen = counted.filter((f) => f.assignedId === personId)
  const given = [...scores].filter(([id]) => !easterEggIds.has(id)).map(([, s]) => s)
  return {
    watched: counted.filter((f) => f.presentIds.includes(personId)).length,
    chosen: chosen.length,
    scores: given.length,
    avgGiven: mean(given),
    avgChosen: mean(chosen.flatMap((f) => (f.avgScore == null ? [] : [f.avgScore]))),
    comments: commentFilmIds.filter((id) => !easterEggIds.has(id)).length,
  }
}

/** Mirrors the profiles check constraint (1–50 characters after trimming). */
export const NAME_MAX = 50

/** A display name as typed: trimmed, 1–50 characters, nobody else's (ignoring case). */
export function parseName(
  text: string,
  people: Person[],
  me: string,
): { name: string } | { error: string } {
  const name = text.trim()
  if (!name) return { error: 'Enter a name.' }
  // Code points, like char_length (an emoji is one).
  if ([...name].length > NAME_MAX) return { error: `Use at most ${NAME_MAX} characters.` }
  const lower = name.toLowerCase()
  if (people.some((p) => p.id !== me && p.name.trim().toLowerCase() === lower)) {
    return { error: 'Someone already has that name.' }
  }
  return { name }
}

/** Friendly text for a failed rename (the unique index and length check are the real guards). */
export function renameError(error: unknown): string {
  const { code } = (error ?? {}) as { code?: string }
  if (code === '23505') return 'Someone already has that name.'
  if (code === '23514') return `Use 1 to ${NAME_MAX} characters.`
  return errorMessage(error)
}

export const ROLE_NAMES: Record<NonNullable<Person['role']>, string> = {
  admin: 'Admin',
  moderator: 'Moderator',
  member: 'Member',
  viewer: 'Viewer',
}
