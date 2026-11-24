// Deno tests for tmdb-search, film-save and film-relink-tmdb.
//
// The handlers run in this process against the LOCAL Supabase stack
// (`supabase start`: real Auth, RLS, triggers and the seed logins), with TMDB
// replaced by a stub server below. Real TMDB is never called and the token is
// a fake. Run: npm run functions:test
import { createClient } from 'npm:@supabase/supabase-js@2.119.0'
import { assert, assertEquals } from 'jsr:@std/assert@1.0.14'
import { handler as relink } from '../film-relink-tmdb/handler.ts'
import { handler as save } from '../film-save/handler.ts'
import { handler as search } from '../tmdb-search/handler.ts'

const FAKE_TOKEN = 'fake-tmdb-token-for-tests-0123456789'
const SEED_PASSWORD = 'film-club-local'
const P = (n: string) => `00000000-0000-4000-8000-0000000000${n}` // seed profile ids
const MEMBER2 = P('a4') // Yusuf: used for the rate limit only

// ---------------------------------------------------------------- local stack
const status = new TextDecoder().decode(
  (await new Deno.Command('npx', { args: ['supabase', 'status', '-o', 'env'], stderr: 'null' })
    .output()).stdout,
)
const env = Object.fromEntries(
  [...status.matchAll(/^(\w+)="?([^"\n]*)"?$/gm)].map((m) => [m[1], m[2]]),
)
const apiUrl = env.API_URL
if (!apiUrl || !['127.0.0.1', 'localhost'].includes(new URL(apiUrl).hostname)) {
  throw new Error('These tests need the LOCAL Supabase stack: run `npm run db:start` first.')
}
const noSession = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(apiUrl, env.SECRET_KEY, noSession)

// ---------------------------------------------------------------- TMDB stub
const tmdbCalls: { path: string; params: URLSearchParams; auth: string | null }[] = []
const MOVIES: Record<number, Record<string, unknown>> = {
  // Already in the seed as film 1 (TMDB 900001), shown on 2026-01-10.
  900001: {
    id: 900001,
    title: 'The Quiet Orchard',
    original_title: 'The Quiet Orchard',
    release_date: '2019-03-01',
  },
  // Not in the seed.
  777001: {
    id: 777001,
    title: 'Stub Film One',
    original_title: 'Filme Um',
    release_date: '2011-05-06',
    poster_path: '/stub1.jpg',
    backdrop_path: 'https://evil.test/x.jpg', // not a TMDB path: dropped (films_backdrop_path_tmdb)
    overview: 'A stub.',
    runtime: 95,
    genres: [{ id: 1, name: 'Drama' }],
  },
  777002: {
    id: 777002,
    title: 'Stub Film Two',
    original_title: 'Stub Film Two',
    release_date: '2012-01-01',
  },
}
const credits = (id: number) => ({
  id,
  crew: [
    { job: 'Director', name: `Director ${id}` },
    { job: 'Writer', name: 'Someone Else' },
  ],
})
/** HTTP status of Film Two's broken credits call (5xx or 429). */
let brokenCreditsStatus = 500
const stub = Deno.serve({ hostname: '127.0.0.1', port: 0, onListen() {} }, (req) => {
  const url = new URL(req.url)
  tmdbCalls.push({
    path: url.pathname,
    params: url.searchParams,
    auth: req.headers.get('Authorization'),
  })
  if (req.headers.get('Authorization') !== `Bearer ${FAKE_TOKEN}`) {
    return Response.json({ status_message: 'Invalid API key' }, { status: 401 })
  }
  const q = url.searchParams.get('query')
  if (url.pathname === '/3/search/movie') {
    if (q === 'boom') return new Response('upstream down', { status: 500 })
    const results = Object.values(MOVIES).filter((m) =>
      String(m.title).toLowerCase().includes(String(q).toLowerCase())
    )
    return Response.json({ page: 1, results })
  }
  const m = url.pathname.match(/^\/3\/movie\/(\d+)(\/credits)?$/)
  const movie = m && MOVIES[Number(m[1])]
  if (!movie) return Response.json({ status_message: 'not found' }, { status: 404 })
  if (m[2]) {
    // Film Two's credits are broken: the search must still work.
    if (movie.id === 777002) return new Response('oops', { status: brokenCreditsStatus })
    return Response.json(credits(movie.id as number))
  }
  return Response.json({ ...movie, credits: credits(movie.id as number) })
})

Deno.env.set('SUPABASE_URL', apiUrl)
Deno.env.set('SUPABASE_PUBLISHABLE_KEYS', JSON.stringify({ default: env.PUBLISHABLE_KEY }))
Deno.env.set('TMDB_TOKEN', FAKE_TOKEN)
Deno.env.set('TMDB_BASE_URL', `http://127.0.0.1:${stub.addr.port}`)

// ---------------------------------------------------------------- helpers
const tokens = new Map<string, string>()
async function tokenFor(who: string): Promise<string> {
  if (!tokens.has(who)) {
    const client = createClient(apiUrl, env.PUBLISHABLE_KEY, noSession)
    const { data, error } = await client.auth.signInWithPassword({
      email: `${who}@example.test`,
      password: SEED_PASSWORD,
    })
    if (error) throw error
    tokens.set(who, data.session.access_token)
  }
  return tokens.get(who)!
}

type Handler = (req: Request) => Promise<Response>
/** Calls a handler; checks the TMDB token never appears in the response. */
async function call(fn: Handler, who: string | null, body: unknown, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  if (who) headers.set('Authorization', `Bearer ${await tokenFor(who)}`)
  headers.set('Content-Type', 'application/json')
  const res = await fn(
    new Request('http://localhost/fn', {
      method: 'POST',
      body: JSON.stringify(body),
      ...init,
      headers,
    }),
  )
  const text = await res.text()
  assert(!text.includes(FAKE_TOKEN), 'the TMDB token is in the response body')
  for (const [, v] of res.headers) assert(!v.includes(FAKE_TOKEN), 'the TMDB token is in a header')
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers }
}

const created: number[] = []
const filmRow = (id: number) =>
  admin.from('films').select('*').eq('id', id).single().then(({ data, error }) => {
    if (error) throw error
    return data
  })
const screening = {
  screened_on: '2026-12-12',
  kind: 'normal',
  assigned_id: P('a3'),
}

// Every role that must be refused, for every function.
const outsiders: [string | null, number][] = [[null, 401], ['petra', 403]]

// The stub server outlives single steps, so the resource sanitizers are off.
Deno.test(
  { name: 'film Edge Functions', sanitizeResources: false, sanitizeOps: false },
  async (t) => {
    try {
      await t.step('anonymous and bad tokens are refused (401)', async () => {
        for (const fn of [search, save, relink]) {
          assertEquals((await call(fn, null, { query: 'stub' })).status, 401)
          const anonKey = { headers: { Authorization: `Bearer ${env.PUBLISHABLE_KEY}` } }
          assertEquals((await call(fn, null, { query: 'stub' }, anonKey)).status, 401)
          const forged = { headers: { Authorization: 'Bearer not.a.jwt' } }
          assertEquals((await call(fn, null, { query: 'stub' }, forged)).status, 401)
        }
        assertEquals(tmdbCalls.length, 0, 'TMDB was called for a refused request')
      })

      await t.step('tmdb-search: viewers are refused', async () => {
        assertEquals((await call(search, 'petra', { query: 'stub' })).status, 403)
        assertEquals(tmdbCalls.length, 0)
      })

      await t.step('tmdb-search: a member gets results; watched films are marked', async () => {
        const res = await call(search, 'kwame', { query: 'stub' })
        assertEquals(res.status, 200)
        assertEquals(res.body.results.length, 2)
        const one = res.body.results.find((r: { tmdb_id: number }) => r.tmdb_id === 777001)
        assertEquals(one, {
          tmdb_id: 777001,
          title: 'Stub Film One',
          original_title: 'Filme Um',
          year: 2011,
          poster_path: '/stub1.jpg',
          directors: ['Director 777001'],
          watched: null,
        })
        const two = res.body.results.find((r: { tmdb_id: number }) => r.tmdb_id === 777002)
        assertEquals(two.directors, [], 'a failed credits call loses only the director')
        assertEquals(two.title, 'Stub Film Two')
        const search1 = tmdbCalls.find((c) => c.path === '/3/search/movie')!
        assertEquals(search1.params.get('language'), 'en-US')
        assertEquals(search1.auth, `Bearer ${FAKE_TOKEN}`)

        const watched = await call(search, 'kwame', { query: 'quiet orchard' })
        assertEquals(watched.body.results[0].watched, {
          film_id: 1,
          screened_on: '2026-01-10',
          kind: 'normal',
        })
      })

      await t.step('tmdb-search: a rate-limited (429) credits call also degrades', async () => {
        brokenCreditsStatus = 429
        try {
          const res = await call(search, 'kwame', { query: 'stub' })
          assertEquals(res.status, 200)
          const byId = Object.fromEntries(
            res.body.results.map((r: { tmdb_id: number; directors: string[] }) => [
              r.tmdb_id,
              r.directors,
            ]),
          )
          assertEquals(byId, { 777001: ['Director 777001'], 777002: [] })
        } finally {
          brokenCreditsStatus = 500
        }
      })

      await t.step('tmdb-search: bad input and TMDB failures', async () => {
        assertEquals((await call(search, 'kwame', { query: '  ' })).status, 400)
        assertEquals((await call(search, 'kwame', 'nope')).status, 400)
        const down = await call(search, 'kwame', { query: 'boom' })
        assertEquals(down.status, 502)
        assertEquals(down.body, { error: 'tmdb_unavailable' })
        const get = await search(new Request('http://localhost/fn'))
        assertEquals(get.status, 405)
        await get.body?.cancel()
      })

      await t.step('tmdb-search: rate limited at 60 a minute', async () => {
        // Fill this minute and the next (in case the clock ticks over).
        const minute = 60_000
        const now = Math.floor(Date.now() / minute) * minute
        const { error } = await admin.from('rate_limits').upsert(
          [now, now + minute].map((t) => ({
            bucket: 'tmdb-search',
            subject: MEMBER2,
            window_start: new Date(t).toISOString(),
            count: 60,
          })),
        )
        if (error) throw error
        const before = tmdbCalls.length
        const res = await call(search, 'yusuf', { query: 'stub' })
        assertEquals(res.status, 429)
        assertEquals(res.body, { error: 'rate_limited' })
        assertEquals(tmdbCalls.length, before, 'TMDB was called over the limit')
      })

      await t.step('film-save: members and viewers are refused', async () => {
        const body = { tmdb_id: 777001, ...screening }
        for (const [who, code] of [...outsiders, ['kwame', 403] as [string, number]]) {
          assertEquals((await call(save, who, body)).status, code)
        }
        const { count } = await admin.from('films').select('id', { count: 'exact' }).eq(
          'tmdb_id',
          777001,
        )
        assertEquals(count, 0)
      })

      await t.step('film-save: impossible input is a 400, never a 500', async () => {
        const manual = { tmdb_id: null, title: 'Fine Title', release_year: 2001, ...screening }
        const inTwoYears = new Date()
        inTwoYears.setUTCFullYear(inTwoYears.getUTCFullYear() + 2)
        const tooLate = new Date(inTwoYears.getTime() + 86_400_000).toISOString().slice(0, 10)
        const bad: Record<string, unknown>[] = [
          // Dates: impossible, or outside 1990-01-01 .. today + 2 years.
          ...['2026-02-30', '2026-13-01', '0000-01-01', '1989-12-31', tooLate, '2026-1-1'].map(
            (screened_on) => ({ ...manual, screened_on }),
          ),
          // Titles that normalise to nothing.
          ...['\u200b\u200b', '!!! ...', '\u{1F3AC}', ' \n\t '].map((title) => ({
            ...manual,
            title,
          })),
          // Democrático on add needs a turn-holder, and not the chooser.
          { ...manual, kind: 'democratico' },
          { ...manual, kind: 'democratico', turn_holder_id: P('a3') },
          // System profiles: only Cinema may choose; none may hold a turn.
          { ...manual, assigned_id: P('c2') },
          { ...manual, kind: 'democratico', turn_holder_id: P('c1') },
          { ...manual, assigned_id: '00000000-0000-4000-8000-00000000ffff' },
          { ...manual, assigned_id: 'not-a-uuid' },
        ]
        for (const body of bad) {
          const res = await call(save, 'tamsin', body)
          assertEquals(res.status, 400, JSON.stringify(body))
        }
        assertEquals(
          (await call(save, 'tamsin', {
            ...manual,
            screened_on: inTwoYears.toISOString().slice(0, 10),
            title: '',
          })).status,
          400,
        )
        const { count } = await admin.from('films').select('id', { count: 'exact' }).eq(
          'title',
          'Fine Title',
        )
        assertEquals(count, 0)
      })

      await t.step('film-save: a moderator adds a TMDB film', async () => {
        const res = await call(save, 'tamsin', { tmdb_id: 777001, ...screening })
        assertEquals(res.status, 200)
        created.push(res.body.id)
        const film = await filmRow(res.body.id)
        assertEquals(film.title, 'Stub Film One')
        assertEquals(film.original_title, 'Filme Um')
        assertEquals(film.release_year, 2011)
        assertEquals(film.directors, ['Director 777001'])
        assertEquals(film.genres, ['Drama'])
        assertEquals(film.runtime_min, 95)
        assertEquals([film.poster_path, film.backdrop_path], ['/stub1.jpg', null])
        assertEquals(film.created_by, P('a2'))
        assertEquals(film.day_order, 1)
        const details = tmdbCalls.findLast((c) => c.path === '/3/movie/777001')!
        assertEquals(details.params.get('append_to_response'), 'credits')
      })

      await t.step('film-save: duplicates are refused (409)', async () => {
        const again = await call(save, 'tamsin', { tmdb_id: 777001, ...screening })
        assertEquals(again.status, 409)
        assertEquals(again.body.error, 'duplicate')
        assertEquals(again.body.film.id, created[0])
        // Same title and year without TMDB: the cross-match rule.
        const manual = await call(save, 'orla', {
          tmdb_id: null,
          title: 'the quiet orchard!',
          release_year: 2019,
          ...screening,
        })
        assertEquals(manual.status, 409)
        assertEquals(manual.body.film, { id: 1, screened_on: '2026-01-10', kind: 'normal' })
      })

      await t.step('film-save: without TMDB, then edit, then relink', async () => {
        const bad = await call(save, 'orla', { tmdb_id: null, title: 'No Year', ...screening })
        assertEquals(bad.status, 400)

        const res = await call(save, 'orla', {
          tmdb_id: null,
          title: 'A Home Movie',
          release_year: 2005,
          ...screening,
          kind: 'democratico',
          turn_holder_id: P('a4'),
        })
        assertEquals(res.status, 200)
        const id = res.body.id
        created.push(id)
        let film = await filmRow(id)
        assertEquals([film.tmdb_id, film.title, film.release_year, film.day_order], [
          null,
          'A Home Movie',
          2005,
          2,
        ])
        assertEquals(film.turn_holder_id, P('a4'))

        // Edit: new date and kind; the turn-holder goes with Democrático.
        const edit = await call(save, 'tamsin', {
          id,
          tmdb_id: null,
          title: '  A Home\n Movie \t (cut) ',
          release_year: 2006,
          screened_on: '2026-12-19',
          kind: 'cinema',
          assigned_id: P('c1'),
          turn_holder_id: P('a4'),
        })
        assertEquals(edit.status, 200)
        film = await filmRow(id)
        assertEquals([film.title, film.release_year, film.screened_on, film.kind], [
          'A Home Movie (cut)',
          2006,
          '2026-12-19',
          'cinema',
        ])
        assertEquals(film.turn_holder_id, null)
        // Moved to a day with no other film: day_order is recomputed (it was 2).
        assertEquals(film.day_order, 1)

        // Relink: members refused; staff link it to TMDB; a taken TMDB id is a duplicate.
        for (const [who, code] of [...outsiders, ['kwame', 403] as [string, number]]) {
          assertEquals((await call(relink, who, { id, tmdb_id: 777002 })).status, code)
        }
        assertEquals((await call(relink, 'tamsin', { id, tmdb_id: 777001 })).status, 409)
        assertEquals((await call(relink, 'tamsin', { id, tmdb_id: 123 })).status, 404)
        assertEquals((await call(relink, 'tamsin', { id: 999999, tmdb_id: 777002 })).status, 404)
        const linked = await call(relink, 'tamsin', { id, tmdb_id: 777002 })
        assertEquals(linked.status, 200)
        film = await filmRow(id)
        assertEquals([film.tmdb_id, film.title, film.directors], [777002, 'Stub Film Two', [
          'Director 777002',
        ]])
        assertEquals(film.screened_on, '2026-12-19')

        // Saving it without TMDB again unlinks it and clears the TMDB details.
        await call(save, 'tamsin', {
          id,
          tmdb_id: null,
          title: 'A Home Movie',
          release_year: 2005,
          ...screening,
        })
        film = await filmRow(id)
        assertEquals([film.tmdb_id, film.directors, film.tmdb_fetched_at], [null, [], null])
        // Moved back to a day that has another film: after it, not its old day_order.
        assertEquals([film.screened_on, film.day_order], ['2026-12-12', 2])

        // An edit that keeps the date keeps the day_order.
        const sameDay = await call(save, 'tamsin', {
          id,
          tmdb_id: null,
          title: 'A Home Movie',
          release_year: 2005,
          ...screening,
          kind: 'cinema',
          assigned_id: P('c1'),
        })
        assertEquals(sameDay.status, 200)
        film = await filmRow(id)
        assertEquals([film.kind, film.day_order], ['cinema', 2])
      })

      await t.step('CORS: only the site (and localhost on the local stack)', async () => {
        const preflight = (origin: string) =>
          search(
            new Request('http://localhost/fn', { method: 'OPTIONS', headers: { Origin: origin } }),
          )
        const allow = async (origin: string) =>
          (await preflight(origin)).headers.get('Access-Control-Allow-Origin')
        assertEquals(await allow('https://manel27.github.io'), 'https://manel27.github.io')
        assertEquals(await allow('http://localhost:5173'), 'http://localhost:5173')
        assertEquals(await allow('https://evil.example'), null)
      })

      await t.step('the TMDB token is never sent anywhere but TMDB', () => {
        assert(tmdbCalls.length > 0)
        for (const c of tmdbCalls) {
          assert(![...c.params.values()].some((v) => v.includes(FAKE_TOKEN)), 'token in a query')
        }
      })
    } finally {
      if (created.length) await admin.from('films').delete().in('id', created)
      await admin.from('rate_limits').delete().eq('bucket', 'tmdb-search')
      await stub.shutdown()
    }
  },
)
