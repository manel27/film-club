// POST -> { id }. Moderators and admins only. Adds a film, or edits one (`id`).
//
// Body: { id?, tmdb_id, title?, release_year?, screened_on, kind, assigned_id, turn_holder_id? }
//  - tmdb_id set: the film's details come from TMDB /3/movie/{id} (fetched on
//    add, or on edit when the TMDB match changes).
//  - tmdb_id null: saved without TMDB; title and release_year are required.
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
    const uuid = (v: unknown) => typeof v === 'string' && v.length > 0
    if (
      !b ||
      (id !== undefined && !isPositiveInt(id)) ||
      (tmdbId !== null && !isPositiveInt(tmdbId)) ||
      typeof b.screened_on !== 'string' ||
      !DATE.test(b.screened_on) ||
      !KINDS.includes(b.kind as string) ||
      !uuid(b.assigned_id) ||
      (b.turn_holder_id != null && !uuid(b.turn_holder_id))
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
      turn_holder_id: b.kind === 'democratico' ? (b.turn_holder_id ?? null) : null,
    }
    if (tmdbId !== null) {
      if (current?.tmdb_id !== tmdbId) {
        const details = await tmdbFilm(tmdbId)
        if (!details) return json(req, 404, { error: 'tmdb_not_found' })
        Object.assign(row, details)
      }
    } else {
      const title = typeof b.title === 'string' ? b.title.trim() : ''
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

    if (id === undefined) {
      // Films shown on the same day keep the order they were added in.
      const { data, error } = await me.db
        .from('films')
        .select('day_order')
        .eq('screened_on', row.screened_on)
        .order('day_order', { ascending: false })
        .limit(1)
      if (error) throw error
      row.day_order = (data[0]?.day_order ?? 0) + 1
    }

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
