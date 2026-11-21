import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { parseEnv } from 'node:util'

/**
 * A fake TMDB for the e2e tests: the local Edge Functions reach it through
 * TMDB_BASE_URL in supabase/functions/.env, so real TMDB is never called.
 */
export const TMDB_STUB_PORT = 54399
export const TMDB_STUB_URL = `http://host.docker.internal:${TMDB_STUB_PORT}`

const MOVIES = [
  // Already in the seed (film 1, shown on 2026-01-10).
  {
    id: 900001,
    title: 'The Quiet Orchard',
    original_title: 'The Quiet Orchard',
    release_date: '2019-03-01',
  },
  {
    id: 880001,
    title: 'E2E Lighthouse Keeper',
    original_title: 'O Faroleiro',
    release_date: '2014-09-12',
    overview: 'A synthetic film for the e2e tests.',
    runtime: 101,
    genres: [{ id: 18, name: 'Drama' }],
  },
]
const credits = (id: number) => ({ id, crew: [{ job: 'Director', name: 'Stub Director' }] })

/** Refuses to run unless the local functions are pointed at this stub. */
export function assertFunctionsUseStub() {
  let env: Record<string, string | undefined> = {}
  try {
    env = parseEnv(readFileSync('supabase/functions/.env', 'utf8'))
  } catch {
    // Missing file: handled below.
  }
  if (env.TMDB_BASE_URL !== TMDB_STUB_URL) {
    throw new Error(
      `The e2e tests need TMDB_BASE_URL=${TMDB_STUB_URL} in supabase/functions/.env ` +
        '(then restart the local stack), so they never call the real TMDB.',
    )
  }
}

export function startTmdbStub(): Promise<Server> {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://stub')
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    if (url.pathname === '/3/search/movie') {
      const q = (url.searchParams.get('query') ?? '').toLowerCase()
      return send(200, { results: MOVIES.filter((m) => m.title.toLowerCase().includes(q)) })
    }
    const m = url.pathname.match(/^\/3\/movie\/(\d+)(\/credits)?$/)
    const movie = m && MOVIES.find((x) => x.id === Number(m[1]))
    if (!movie) return send(404, { status_message: 'not found' })
    send(200, m[2] ? credits(movie.id) : { ...movie, credits: credits(movie.id) })
  })
  // All interfaces: the Edge Runtime container reaches it via host.docker.internal.
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(TMDB_STUB_PORT, '0.0.0.0', () => resolve(server))
  })
}
