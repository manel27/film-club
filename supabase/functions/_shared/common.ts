// Shared by the film Edge Functions (plan 2.2, 3.2). Every function:
//  - verifies the caller's JWT with Supabase Auth and re-reads their role
//    from the database (my_profile()), never from the token;
//  - talks to the database with the CALLER's JWT, so RLS and the guard
//    triggers apply (supabase/README.md: never the secret key here);
//  - calls TMDB with the server-side TMDB_TOKEN, which is never returned or
//    logged.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.119.0'

export const SITE_ORIGIN = 'https://manel27.github.io'
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/

/** CORS for the site only (plus localhost when this is the local stack). */
export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? ''
  const local = !new URL(Deno.env.get('SUPABASE_URL') ?? SITE_ORIGIN).hostname.endsWith(
    '.supabase.co',
  )
  const allowed = origin === SITE_ORIGIN || (local && LOCAL_ORIGIN.test(origin))
  return {
    ...(allowed ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
}

export function json(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
  })
}

export type Role = 'admin' | 'moderator' | 'member' | 'viewer'

export interface Caller {
  db: SupabaseClient
  /** Their profile id. */
  id: string
  role: Role
}

/** The project's publishable key (new key system), else the legacy anon key. */
function publishableKey(): string {
  let keys: { default?: string } | null = null
  try {
    keys = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') ?? '')
  } catch {
    // Not set (older runtimes)
  }
  return keys?.default ?? Deno.env.get('SUPABASE_ANON_KEY')!
}

/** The logged-in caller with their role from the DB, or null (no/invalid session, no profile). */
export async function getCaller(req: Request): Promise<Caller | null> {
  const auth = req.headers.get('Authorization') ?? ''
  const token = auth.match(/^Bearer (\S+)$/)?.[1]
  if (!token) return null
  const db = createClient(Deno.env.get('SUPABASE_URL')!, publishableKey(), {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const { data, error } = await db.auth.getUser(token)
  if (error || !data.user) return null
  const me = await db.rpc('my_profile').maybeSingle<{ id: string; role: Role }>()
  if (me.error) throw me.error
  return me.data ? { db, id: me.data.id, role: me.data.role } : null
}

export const isStaff = (role: Role) => role === 'admin' || role === 'moderator'

/** The request's JSON object body, or null. */
export async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  const body = await req.json().catch(() => null)
  return body && typeof body === 'object' && !Array.isArray(body) ? body : null
}

/** TMDB failed or isn't configured. Its message never contains the token. */
export class TmdbError extends Error {}

/** GET from TMDB v3; null on 404. TMDB_BASE_URL is only overridden by tests (a local stub). */
export async function tmdb(
  path: string,
  params: Record<string, string> = {},
): Promise<Record<string, unknown> | null> {
  const token = Deno.env.get('TMDB_TOKEN')
  if (!token) throw new TmdbError('TMDB_TOKEN is not set')
  const url = new URL(`/3${path}`, Deno.env.get('TMDB_BASE_URL') || 'https://api.themoviedb.org')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  let res: Response
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    })
  } catch {
    throw new TmdbError(`TMDB ${path}: network error`)
  }
  if (res.status === 404) {
    await res.body?.cancel()
    return null
  }
  if (!res.ok) {
    await res.body?.cancel()
    throw new TmdbError(`TMDB ${path}: HTTP ${res.status}`)
  }
  return await res.json()
}

export const yearOf = (date: unknown) =>
  typeof date === 'string' && /^\d{4}/.test(date) ? Number(date.slice(0, 4)) : null

export const directorsOf = (credits: unknown): string[] =>
  ((credits as { crew?: { job?: string; name?: string }[] } | null)?.crew ?? [])
    .filter((c) => c.job === 'Director' && c.name)
    .map((c) => c.name!)

/** A film's metadata columns from TMDB /3/movie/{id}, or null if TMDB has no such film. */
export async function tmdbFilm(tmdbId: number): Promise<Record<string, unknown> | null> {
  const m = await tmdb(`/movie/${tmdbId}`, { language: 'en-US', append_to_response: 'credits' })
  if (!m) return null
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null)
  // Same rule as the films_*_path_tmdb CHECKs: anything else is dropped, not saved.
  const imagePath = (v: unknown) =>
    typeof v === 'string' && /^\/[A-Za-z0-9._-]+$/.test(v) ? v : null
  return {
    tmdb_id: tmdbId,
    title: text(m.title) ?? text(m.original_title) ?? `TMDB ${tmdbId}`,
    original_title: text(m.original_title),
    release_year: yearOf(m.release_date),
    release_date: text(m.release_date),
    poster_path: imagePath(m.poster_path),
    backdrop_path: imagePath(m.backdrop_path),
    overview: text(m.overview),
    runtime_min: typeof m.runtime === 'number' && m.runtime > 0 ? m.runtime : null,
    genres: ((m.genres ?? []) as { name?: string }[]).map((g) => g.name).filter(Boolean),
    directors: directorsOf(m.credits),
    tmdb_fetched_at: new Date().toISOString(),
  }
}

/** Films that would clash with this title/year/TMDB id (the UI's duplicate warning, same RPC). */
export async function clashes(
  db: SupabaseClient,
  film: { title?: unknown; release_year?: unknown; tmdb_id?: unknown; original_title?: unknown },
  exceptId?: number,
) {
  const { data, error } = await db.rpc('film_duplicate_check', {
    p_title: film.title,
    p_release_year: film.release_year ?? null,
    p_tmdb_id: film.tmdb_id ?? null,
    p_original_title: film.original_title ?? null,
  })
  if (error) throw error
  return (data as { id: number; title: string; screened_on: string; kind: string }[]).filter(
    (f) => f.id !== exceptId,
  )
}

/** Logs without request data, so neither tokens nor user input reach the logs. */
export function fail(req: Request, e: unknown): Response {
  if (e instanceof TmdbError) {
    console.error(e.message)
    return json(req, 502, { error: 'tmdb_unavailable' })
  }
  // The error's own message only: never the request, its headers or the TMDB token.
  const { code, message } = (e ?? {}) as { code?: string; message?: string }
  console.error('unexpected error', code ?? '', message ?? String(e))
  return json(req, 500, { error: 'server_error' })
}

export const isPositiveInt = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v > 0

/** Maps a refused write to a status; a duplicate names the film it clashes with. */
export async function writeError(
  req: Request,
  db: SupabaseClient,
  error: { code?: string },
  row: Record<string, unknown>,
  id?: number,
): Promise<Response> {
  if (error.code === '23505') {
    const [film] = row.title ? await clashes(db, row, id) : []
    return json(req, 409, {
      error: 'duplicate',
      film: film ? { id: film.id, screened_on: film.screened_on, kind: film.kind } : null,
    })
  }
  if (error.code === '42501') return json(req, 403, { error: 'forbidden' })
  if (['23503', '23514', '22P02', '22007', '22008'].includes(error.code ?? '')) {
    return json(req, 400, { error: 'invalid' })
  }
  throw error
}
