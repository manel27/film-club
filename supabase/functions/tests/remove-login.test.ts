// Deno tests for admin-remove-login (decision A2, supabase/functions/_shared/links.ts).
//
// Runs the handler in this process against the LOCAL Supabase stack (real
// Auth, RLS, triggers, seed logins). Run: npm run functions:test
import { createClient } from 'npm:@supabase/supabase-js@2.119.0'
import { assert, assertEquals } from 'jsr:@std/assert@1.0.14'
import { inviteClaim, issueLink, removeLogin } from '../_shared/links.ts'

const SEED_PASSWORD = 'film-club-local'
const P = (n: string) => `00000000-0000-4000-8000-0000000000${n}` // seed profile ids

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

Deno.env.set('SUPABASE_URL', apiUrl)
Deno.env.set('SUPABASE_PUBLISHABLE_KEYS', JSON.stringify({ default: env.PUBLISHABLE_KEY }))
Deno.env.set('SUPABASE_SECRET_KEYS', JSON.stringify({ default: env.SECRET_KEY }))

async function signIn(email: string, password = SEED_PASSWORD) {
  return await createClient(apiUrl, env.PUBLISHABLE_KEY, noSession).auth
    .signInWithPassword({ email, password })
}
async function tokenFor(who: string) {
  const { data, error } = await signIn(`${who}@example.test`)
  if (error) throw error
  return data.session.access_token
}
/** A browser's database client with this access token. */
const browser = (token: string) =>
  createClient(apiUrl, env.PUBLISHABLE_KEY, {
    ...noSession,
    global: { headers: { Authorization: `Bearer ${token}` } },
  })

type Handler = (req: Request) => Promise<Response>
async function call(fn: Handler, token: string | null, body: unknown) {
  const headers = new Headers({ 'Content-Type': 'application/json' })
  if (token) headers.set('Authorization', `Bearer ${token}`)
  const res = await fn(
    new Request('http://localhost/fn', { method: 'POST', body: JSON.stringify(body), headers }),
  )
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}
const remove = (token: string | null, profile_id: unknown) =>
  call(removeLogin, token, { profile_id })

async function profileOf(id: string) {
  const { data, error } = await admin.from('profiles')
    .select('auth_user_id, claimed_at, is_claimed').eq('id', id).single()
  if (error) throw error
  return data
}
async function history(id: string) {
  const counts = await Promise.all([
    admin.from('films').select('id', { count: 'exact', head: true }).eq('assigned_id', id),
    admin.from('scores').select('film_id', { count: 'exact', head: true }).eq('profile_id', id),
    admin.from('attendance').select('film_id', { count: 'exact', head: true }).eq('profile_id', id),
    admin.from('comments').select('id', { count: 'exact', head: true }).eq('author_id', id),
  ])
  return counts.map((c) => c.count)
}

const EMAIL = 'deno-leaver@example.test'
const PASSWORD = 'leaver-password'

Deno.test(
  { name: 'admin-remove-login', sanitizeResources: false, sanitizeOps: false },
  async (t) => {
    let leaver = ''
    let film = 0
    try {
      // A person with a login and some history.
      const made = await admin.auth.admin.createUser({
        email: EMAIL,
        password: PASSWORD,
        email_confirm: true,
      })
      if (made.error) throw made.error
      const p = await admin.from('profiles').insert({
        display_name: 'Deno Leaver',
        colour: '#336699',
        auth_user_id: made.data.user.id,
        claimed_at: new Date().toISOString(),
      }).select('id').single()
      if (p.error) throw p.error
      leaver = p.data.id
      const f = await admin.from('films').insert({
        title: 'Deno Leaver Film',
        release_year: 1999,
        screened_on: '2026-03-07',
        kind: 'normal',
        assigned_id: leaver,
      }).select('id').single()
      if (f.error) throw f.error
      film = f.data.id
      for (
        const [table, row] of [
          ['attendance', { film_id: film, profile_id: leaver }],
          ['scores', { film_id: film, profile_id: leaver, score: 7 }],
          ['comments', { film_id: film, author_id: leaver, body: 'Bye for now.' }],
        ] as const
      ) {
        const { error } = await admin.from(table).insert(row)
        if (error) throw error
      }
      const before = await history(leaver)
      assertEquals(before, [1, 1, 1, 1])
      const orla = await tokenFor('orla')

      await t.step('non-admins are refused and nothing changes', async () => {
        assertEquals((await remove(null, leaver)).status, 401, 'anon')
        assertEquals(
          (await call(removeLogin, 'not.a.jwt', { profile_id: leaver })).status,
          401,
          'forged',
        )
        for (const who of ['tamsin', 'kwame', 'petra']) {
          assertEquals((await remove(await tokenFor(who), leaver)).status, 403, who)
        }
        assert((await profileOf(leaver)).is_claimed)
        assertEquals((await signIn(EMAIL, PASSWORD)).error, null)
      })

      await t.step('bad input, people without a login, and the admin themselves', async () => {
        assertEquals((await remove(orla, 'x')).status, 400)
        assertEquals((await remove(orla, undefined)).status, 400)
        assertEquals((await remove(orla, '00000000-0000-4000-8000-00000000ffff')).status, 404)
        assertEquals((await remove(orla, P('b1'))).body, { error: 'no_login' }, 'unclaimed')
        assertEquals((await remove(orla, P('c1'))).body, { error: 'no_login' }, 'system')
        // Orla is the only admin: refusing her own login also protects the last admin.
        const self = await remove(orla, P('a1'))
        assertEquals([self.status, self.body], [409, { error: 'self' }])
        assertEquals((await signIn('orla@example.test')).error, null)
      })

      await t.step('if Auth fails, nothing is lost and it can be retried', async () => {
        const realFetch = globalThis.fetch
        globalThis.fetch = (input, init) =>
          /\/auth\/v1\/admin\/users\/[\w-]+/.test(String(input)) && init?.method === 'DELETE'
            ? Promise.resolve(Response.json({ msg: 'down' }, { status: 500 }))
            : realFetch(input, init)
        try {
          assertEquals((await remove(orla, leaver)).status, 500)
        } finally {
          globalThis.fetch = realFetch
        }
        assert((await profileOf(leaver)).is_claimed, 'still claimed')
      })

      await t.step('removes the login; history stays; old sessions get nothing', async () => {
        const old = await signIn(EMAIL, PASSWORD)
        if (old.error) throw old.error
        const oldDb = browser(old.data.session.access_token)
        assert(((await oldDb.from('profiles').select('id')).data ?? []).length > 0)
        const reset = await call((r) => issueLink(r, 'reset'), orla, { profile_id: leaver })
        assertEquals(reset.status, 200)

        const res = await remove(orla, leaver)
        assertEquals([res.status, res.body], [200, { ok: true }])

        assertEquals(await profileOf(leaver), {
          auth_user_id: null,
          claimed_at: null,
          is_claimed: false,
        })
        assertEquals(await history(leaver), before, 'films, scores, attendance, comments')
        const { count } = await admin.from('invites').select('id', { count: 'exact', head: true })
          .eq('profile_id', leaver).is('used_at', null).is('revoked_at', null)
        assertEquals(count, 0, 'the open reset link was revoked')
        assert((await signIn(EMAIL, PASSWORD)).error, 'they can still log in')
        const after = await oldDb.from('profiles').select('id')
        assertEquals([after.error, after.data], [null, []], 'the old access token reads people')
        const comment = await oldDb.from('comments')
          .insert({ film_id: film, author_id: leaver, body: 'still here?' })
        assertEquals(comment.error?.code, '42501', 'the old access token can comment')

        assertEquals((await remove(orla, leaver)).body, { error: 'no_login' }, 'twice')
      })

      await t.step('they can be invited again and claim with the same email', async () => {
        const inv = await call((r) => issueLink(r, 'invite'), orla, { profile_id: leaver })
        assertEquals(inv.status, 200)
        const token = inv.body.link.split('/').pop()
        const claimed = await call(inviteClaim, null, { token, email: EMAIL, password: PASSWORD })
        assertEquals([claimed.status, claimed.body], [200, { ok: true }])
        assert((await profileOf(leaver)).is_claimed)
        assertEquals(await history(leaver), before)
      })
    } finally {
      const { data } = await admin.auth.admin.listUsers({ perPage: 1000 })
      const user = data?.users.find((u) => u.email === EMAIL)
      if (user) await admin.auth.admin.deleteUser(user.id)
      if (film) await admin.from('films').delete().eq('id', film)
      if (leaver) await admin.from('profiles').delete().eq('id', leaver)
    }
  },
)
