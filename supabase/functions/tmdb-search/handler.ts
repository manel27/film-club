// POST { query } -> { results: [...] }. Logged-in members and staff only
// (not viewers), rate-limited per profile. Each result says whether the film
// is already in the club's list ("Already watched on <date>").
import {
  clashes,
  corsHeaders,
  directorsOf,
  fail,
  getCaller,
  json,
  readBody,
  tmdb,
  yearOf,
} from '../_shared/common.ts'

/** Results shown per search; each one costs a TMDB credits call for the director. */
const MAX_RESULTS = 8

export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders(req) })
  if (req.method !== 'POST') return json(req, 405, { error: 'method_not_allowed' })
  try {
    const me = await getCaller(req)
    if (!me) return json(req, 401, { error: 'unauthorized' })
    if (me.role === 'viewer') return json(req, 403, { error: 'forbidden' })

    const query = (await readBody(req))?.query
    if (typeof query !== 'string' || !query.trim() || query.length > 200) {
      return json(req, 400, { error: 'invalid' })
    }

    const { data: allowed, error } = await me.db.rpc('tmdb_search_hit')
    if (error) throw error
    if (!allowed) return json(req, 429, { error: 'rate_limited' })

    const found = await tmdb('/search/movie', {
      query: query.trim(),
      language: 'en-US',
      include_adult: 'false',
    })
    const movies = ((found?.results ?? []) as Record<string, unknown>[]).slice(0, MAX_RESULTS)
    const results = await Promise.all(
      movies.map(async (m) => {
        const film = {
          tmdb_id: m.id as number,
          title: String(m.title ?? m.original_title ?? ''),
          original_title: typeof m.original_title === 'string' ? m.original_title : null,
          year: yearOf(m.release_date),
          poster_path: typeof m.poster_path === 'string' ? m.poster_path : null,
        }
        const [credits, watched] = await Promise.all([
          // A failed credits call only loses that result's director.
          tmdb(`/movie/${film.tmdb_id}/credits`).catch((e) => {
            console.warn('credits unavailable', e instanceof Error ? e.message : String(e))
            return null
          }),
          clashes(me.db, { ...film, release_year: film.year }),
        ])
        const w = watched[0]
        return {
          ...film,
          directors: directorsOf(credits),
          watched: w ? { film_id: w.id, screened_on: w.screened_on, kind: w.kind } : null,
        }
      }),
    )
    return json(req, 200, { results })
  } catch (e) {
    return fail(req, e)
  }
}
