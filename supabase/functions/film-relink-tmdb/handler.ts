// POST { id, tmdb_id } -> { id }. Moderators and admins only. Links a film
// (e.g. one saved without TMDB, or a wrong match) to a TMDB film, or refreshes
// its details, replacing title, year, poster, genres, director etc. with
// TMDB's. Screening fields are left alone. Duplicates are refused (409).
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

export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders(req) })
  if (req.method !== 'POST') return json(req, 405, { error: 'method_not_allowed' })
  try {
    const me = await getCaller(req)
    if (!me) return json(req, 401, { error: 'unauthorized' })
    if (!isStaff(me.role)) return json(req, 403, { error: 'forbidden' })

    const b = await readBody(req)
    if (!isPositiveInt(b?.id) || !isPositiveInt(b?.tmdb_id)) {
      return json(req, 400, { error: 'invalid' })
    }
    const { data: film, error } = await me.db
      .from('films')
      .select('id')
      .eq('id', b.id)
      .maybeSingle()
    if (error) throw error
    if (!film) return json(req, 404, { error: 'not_found' })

    const details = await tmdbFilm(b.tmdb_id)
    if (!details) return json(req, 404, { error: 'tmdb_not_found' })
    const saved = await me.db.from('films').update(details).eq('id', b.id).select('id')
      .maybeSingle()
    if (saved.error) return await writeError(req, me.db, saved.error, details, b.id)
    if (!saved.data) return json(req, 404, { error: 'not_found' })
    return json(req, 200, { id: saved.data.id })
  } catch (e) {
    return fail(req, e)
  }
}
