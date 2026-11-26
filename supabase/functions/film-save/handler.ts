// POST -> { id }. Moderators and admins only. Adds a film, or edits one (`id`).
//
// Body: { id?, tmdb_id, title?, release_year?, screened_on, kind, assigned_id, turn_holder_id?,
//         democratico_reason? }
//  - tmdb_id set: the film's details come from TMDB /3/movie/{id} (fetched on
//    add, or on edit when the TMDB match changes).
//  - tmdb_id null: saved without TMDB; title and release_year are required.
//  - democratico_reason: why a Democrático was chosen (normalised, at most 200
//    characters, else 400 reason_too_long). Saved as null for every other kind.
// The database refuses duplicates (films_no_duplicate); that becomes a 409
// with the film it clashes with.
import {
  corsHeaders,
  fail,
  getCaller,
  isPositiveInt,
  isStaff,
  json,
  readBody,
  tmdbFilm,
  writeError,
} from '../_shared/common.ts'

const KINDS = ['normal', 'democratico', 'cinema', 'maratona']
const DATE = /^\d{4}-\d{2}-\d{2}$/
/** Same range as the form's date input (src/films/filmForm.ts). */
const FIRST_SCREENING = '1990-01-01'

/** A real calendar date from 1990-01-01 to two years from today. */
export function validScreeningDate(v: unknown, now = new Date()): v is string {
  if (typeof v !== 'string' || !DATE.test(v)) return false
  const [y, m, d] = v.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d))
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return false
  const last = new Date(now)
  last.setUTCFullYear(last.getUTCFullYear() + 2)
  return v >= FIRST_SCREENING && v <= last.toISOString().slice(0, 10)
}
const REASON_MAX = 200

/**
 * A Democrático's reason as stored: invisible format characters (zero-width
 * spaces, joiners, bidi marks, BOM) removed, whitespace runs made one space,
 * trimmed; '' becomes null. Not a string (or null): undefined.
 */
function normaliseReason(v: unknown): string | null | undefined {
  if (v == null) return null
  if (typeof v !== 'string') return undefined
  return v.replace(/\p{Cf}/gu, '').replace(/\s+/g, ' ').trim() || null
}

/** Cleared when a film is unlinked from TMDB, so no stale poster or synopsis remains. */
const TMDB_COLUMNS = {
  original_title: null,
  release_date: null,
  poster_path: null,
  backdrop_path: null,
  overview: null,
  runtime_min: null,
  genres: [],
  directors: [],
  tmdb_fetched_at: null,
}

export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders(req) })
  if (req.method !== 'POST') return json(req, 405, { error: 'method_not_allowed' })
  try {
    const me = await getCaller(req)
    if (!me) return json(req, 401, { error: 'unauthorized' })
    if (!isStaff(me.role)) return json(req, 403, { error: 'forbidden' })

    const b = await readBody(req)
    const id = b?.id
    const tmdbId = b?.tmdb_id ?? null
    const uuid = (v: unknown) =>
      typeof v === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v)
    if (
      !b ||
      (id !== undefined && !isPositiveInt(id)) ||
      (tmdbId !== null && !isPositiveInt(tmdbId)) ||
      !validScreeningDate(b.screened_on) ||
      !KINDS.includes(b.kind as string) ||
      !uuid(b.assigned_id) ||
      (b.turn_holder_id != null && !uuid(b.turn_holder_id))
    ) {
      return json(req, 400, { error: 'invalid' })
    }
    const turnHolder = b.kind === 'democratico' ? (b.turn_holder_id ?? null) : null
    // Only a Democrático keeps a reason, whatever the client sent.
    const reason = b.kind === 'democratico' ? normaliseReason(b.democratico_reason) : null
    if (reason === undefined) return json(req, 400, { error: 'invalid' })
    // Code points, as the database's char_length counts them.
    if (reason && [...reason].length > REASON_MAX) {
      return json(req, 400, { error: 'reason_too_long' })
    }
    // On add, a Democrático needs whose turn it was (historic films may have none).
    if (
      (id === undefined && b.kind === 'democratico' && !turnHolder) || turnHolder === b.assigned_id
    ) {
      return json(req, 400, { error: 'invalid' })
    }
    // System profiles can't choose or miss a turn; only "Cinema" may stand in as chooser.
    const { data: people, error: peopleError } = await me.db
      .from('profile_directory')
      .select('id, display_name, is_system')
      .in('id', turnHolder ? [b.assigned_id, turnHolder] : [b.assigned_id])
    if (peopleError) throw peopleError
    const person = (pid: unknown) => people.find((p) => p.id === pid)
    const chooser = person(b.assigned_id)
    if (
      !chooser ||
      (chooser.is_system && chooser.display_name !== 'Cinema') ||
      (turnHolder && (!person(turnHolder) || person(turnHolder)!.is_system))
    ) {
      return json(req, 400, { error: 'invalid' })
    }

    let current: { tmdb_id: number | null } | null = null
    if (id !== undefined) {
      const { data, error } = await me.db.from('films').select('tmdb_id').eq('id', id).maybeSingle()
      if (error) throw error
      if (!data) return json(req, 404, { error: 'not_found' })
      current = data
    }

    const row: Record<string, unknown> = {
      screened_on: b.screened_on,
      kind: b.kind,
      assigned_id: b.assigned_id,
      turn_holder_id: turnHolder,
      democratico_reason: reason,
    }
    if (tmdbId !== null) {
      if (current?.tmdb_id !== tmdbId) {
        const details = await tmdbFilm(tmdbId)
        if (!details) return json(req, 404, { error: 'tmdb_not_found' })
        Object.assign(row, details)
      }
    } else {
      // Newlines, tabs and runs of spaces become one space.
      const title = typeof b.title === 'string' ? b.title.replace(/\s+/g, ' ').trim() : ''
      const year = b.release_year
      if (!title || title.length > 300 || !isPositiveInt(year) || year < 1870 || year > 2100) {
        return json(req, 400, { error: 'invalid' })
      }
      Object.assign(row, current?.tmdb_id ? TMDB_COLUMNS : {}, {
        tmdb_id: null,
        title,
        release_year: year,
      })
    }

    // null: the films_day_order trigger puts it after the day's other films.
    if (id === undefined) row.day_order = null

    const saved = id === undefined
      ? await me.db.from('films').insert(row).select('id').single()
      : await me.db.from('films').update(row).eq('id', id).select('id').maybeSingle()
    if (saved.error) return await writeError(req, me.db, saved.error, row, id)
    if (!saved.data) return json(req, 404, { error: 'not_found' })
    return json(req, 200, { id: saved.data.id })
  } catch (e) {
    return fail(req, e)
  }
}
