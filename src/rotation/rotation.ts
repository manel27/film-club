// The chooser rotation (plan 6). Points and owed turns are computed, never
// stored. computeStandings is mirrored by the SQL view rotation_standings
// (app.rotation_replay); a Deno test checks both agree on the same data.
// No imports on purpose: the Deno test imports this file as it is.

export type RotationFilmKind = 'normal' | 'democratico' | 'cinema' | 'maratona'

export interface RotationFilm {
  id: number
  screenedOn: string // YYYY-MM-DD
  dayOrder: number
  kind: RotationFilmKind
  assignedId: string
  turnHolderId: string | null
  presentIds: string[]
}

export interface RotationAdjustment {
  id: number
  profileId: string
  delta: number | null
  setTo: number | null
  clearOwedTurn: boolean
  effectiveAt: string // ISO timestamp
}

export interface RotationPass {
  weekStart: string // a Monday, YYYY-MM-DD
  profileId: string
}

export interface RotationInput {
  /** app_settings.rotation_epoch (go-live date); null = not started. */
  epoch: string | null
  /** Today in Europe/Lisbon, YYYY-MM-DD. */
  today: string
  /** Who is in the rotation: profiles that aren't viewers or system profiles. */
  people: string[]
  films: RotationFilm[]
  adjustments: RotationAdjustment[]
  passes: RotationPass[]
}

export interface Standing {
  profileId: string
  points: number
  /** 1 = first in line among owed turns; null = no owed turn. */
  owedRank: number | null
  /** Date of the Democrático they missed. */
  owedSince: string | null
}

export interface Standings {
  /** Monday of the week the next chooser is for. */
  weekStart: string
  /** In `people` order. */
  standings: Standing[]
}

const DAY_MS = 86_400_000

/** 2026-11-14 → 2026/11/14, as dates are shown everywhere. */
export const ymd = (date: string) => date.replaceAll('-', '/')
const lisbon = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon' })

/** The Europe/Lisbon calendar date (YYYY-MM-DD) of an instant. */
export const lisbonDate = (at: Date | string = new Date()) => lisbon.format(new Date(at))

/** The Monday of the Mon–Sun week holding `date` (same as films.ts weekStart). */
export function mondayOf(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const t = Date.UTC(y, m - 1, d, 12)
  return new Date(t - ((new Date(t).getUTCDay() + 6) % 7) * DAY_MS).toISOString().slice(0, 10)
}

const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T12:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)

const counts = (kind: RotationFilmKind) => kind === 'normal' || kind === 'democratico'

/**
 * The week "who's next" is for: this week, unless a normal or Democrático
 * screening has already happened in it (on or after the epoch), then next week.
 */
export function comingWeek(today: string, epoch: string, films: RotationFilm[]): string {
  const monday = mondayOf(today)
  const from = monday > epoch ? monday : epoch
  const done = films.some((f) => counts(f.kind) && f.screenedOn >= from && f.screenedOn <= today)
  return done ? addDays(monday, 7) : monday
}

type Event =
  | { key: [string, number, number, number]; type: 'pass'; pass: RotationPass }
  | { key: [string, number, number, number]; type: 'adjustment'; adj: RotationAdjustment }
  | { key: [string, number, number, number]; type: 'film'; film: RotationFilm }

/**
 * Replays everything since the epoch (plan 6.2). Events run in date order; on
 * the same date passes (placed on their Monday) come first, then adjustments
 * (by time), then films (by day_order). Counted: normal and Democrático films
 * from the epoch to today, adjustments from the epoch to today, passes from
 * the epoch up to the coming week. Null when there is no epoch or it is still
 * in the future.
 */
export function computeStandings(input: RotationInput): Standings | null {
  const { epoch, today } = input
  if (!epoch || today < epoch) return null
  const weekStart = comingWeek(today, epoch, input.films)

  const events: Event[] = [
    ...input.passes
      .filter((p) => p.weekStart >= epoch && p.weekStart <= weekStart)
      .map((pass): Event => ({ key: [pass.weekStart, 0, 0, 0], type: 'pass', pass })),
    ...input.adjustments
      .map((adj) => ({ adj, date: lisbonDate(adj.effectiveAt) }))
      .filter(({ date }) => date >= epoch && date <= today)
      .map(({ adj, date }): Event => ({
        key: [date, 1, Date.parse(adj.effectiveAt), adj.id],
        type: 'adjustment',
        adj,
      })),
    ...input.films
      .filter((f) => counts(f.kind) && f.screenedOn >= epoch && f.screenedOn <= today)
      .map((film): Event => ({
        key: [film.screenedOn, 2, film.dayOrder, film.id],
        type: 'film',
        film,
      })),
  ]
  events.sort((a, b) => {
    if (a.key[0] !== b.key[0]) return a.key[0] < b.key[0] ? -1 : 1
    for (let i = 1; i < 4; i++) {
      const diff = (a.key[i] as number) - (b.key[i] as number)
      if (diff) return diff
    }
    return 0
  })

  const points = new Map<string, number>()
  const owed: { id: string; since: string }[] = [] // oldest first
  const unOwe = (id: string) => {
    const i = owed.findIndex((o) => o.id === id)
    if (i >= 0) owed.splice(i, 1)
  }
  for (const e of events) {
    if (e.type === 'pass') {
      unOwe(e.pass.profileId) // passing clears an owed turn
    } else if (e.type === 'adjustment') {
      const { profileId, setTo, delta } = e.adj
      if (setTo != null) points.set(profileId, setTo)
      else if (delta != null) points.set(profileId, (points.get(profileId) ?? 0) + delta)
      if (e.adj.clearOwedTurn) unOwe(profileId)
    } else {
      const { film } = e
      for (const id of film.presentIds) points.set(id, (points.get(id) ?? 0) + 1)
      if (film.kind === 'normal') {
        points.set(film.assignedId, 0) // after the +1, even if absent
        unOwe(film.assignedId) // they took their turn
      } else if (film.turnHolderId && !owed.some((o) => o.id === film.turnHolderId)) {
        owed.push({ id: film.turnHolderId, since: film.screenedOn }) // nobody resets
      }
    }
  }

  return {
    weekStart,
    standings: input.people.map((id) => {
      const i = owed.findIndex((o) => o.id === id)
      return {
        profileId: id,
        points: points.get(id) ?? 0,
        owedRank: i >= 0 ? i + 1 : null,
        owedSince: i >= 0 ? owed[i].since : null,
      }
    }),
  }
}

/** Owed turns first (oldest first), then points (highest first), then name. */
export function orderStandings<T extends Standing>(rows: T[], name: (id: string) => string): T[] {
  return [...rows].sort(
    (a, b) =>
      (a.owedRank ?? Infinity) - (b.owedRank ?? Infinity) ||
      b.points - a.points ||
      name(a.profileId).localeCompare(name(b.profileId)),
  )
}

export type NextUp =
  | { kind: 'decided' | 'owed' | 'points'; ids: [string] }
  | { kind: 'tie'; ids: string[] }
  | { kind: 'none'; ids: [] }

/**
 * Who chooses in the coming week (plan 6.2): a staff decision (rotation_next)
 * wins; else the oldest owed turn; else the most points. People passing that
 * week are skipped. Equal top points with no owed turn is a tie.
 */
export function nextUp(rows: Standing[], passing: Set<string>, decided: string | null): NextUp {
  if (decided) return { kind: 'decided', ids: [decided] }
  const free = rows.filter((r) => !passing.has(r.profileId))
  const owed = free.filter((r) => r.owedRank != null).sort((a, b) => a.owedRank! - b.owedRank!)
  if (owed.length > 0) return { kind: 'owed', ids: [owed[0].profileId] }
  if (free.length === 0) return { kind: 'none', ids: [] }
  const top = Math.max(...free.map((r) => r.points))
  const ids = free.filter((r) => r.points === top).map((r) => r.profileId)
  return ids.length === 1 ? { kind: 'points', ids: [ids[0]] } : { kind: 'tie', ids }
}
