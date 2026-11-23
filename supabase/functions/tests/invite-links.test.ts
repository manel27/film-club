// Deno tests for invite-create, admin-reset-link, invite-preview, invite-claim
// and reset-claim (supabase/functions/_shared/links.ts).
//
// The handlers run in this process against the LOCAL Supabase stack (real
// Auth, RLS, triggers, seed logins). Run: npm run functions:test
import { createClient } from 'npm:@supabase/supabase-js@2.119.0'
import { assert, assertEquals, assertMatch } from 'jsr:@std/assert@1.0.14'
import {
  inviteClaim as claim,
  invitePreview as preview,
  issueLink,
  resetClaim,
  tokenHash,
} from '../_shared/links.ts'

const SEED_PASSWORD = 'film-club-local'
const P = (n: string) => `00000000-0000-4000-8000-0000000000${n}` // seed profile ids

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

Deno.env.set('SUPABASE_URL', apiUrl)
Deno.env.set('SUPABASE_PUBLISHABLE_KEYS', JSON.stringify({ default: env.PUBLISHABLE_KEY }))
Deno.env.set('SUPABASE_SECRET_KEYS', JSON.stringify({ default: env.SECRET_KEY }))

// ---------------------------------------------------------------- helpers
const invite = (req: Request) => issueLink(req, 'invite')
const reset = (req: Request) => issueLink(req, 'reset')

async function signIn(email: string, password: string) {
  const client = createClient(apiUrl, env.PUBLISHABLE_KEY, noSession)
  return await client.auth.signInWithPassword({ email, password })
}

const tokens = new Map<string, string>()
async function tokenFor(who: string): Promise<string> {
  if (!tokens.has(who)) {
    const { data, error } = await signIn(`${who}@example.test`, SEED_PASSWORD)
    if (error) throw error
    tokens.set(who, data.session.access_token)
  }
  return tokens.get(who)!
}

let ipCount = 0
type Handler = (req: Request) => Promise<Response>
/** Calls a handler, each call from its own IP unless one is given (the rate limit has its own step). */
async function call(fn: Handler, who: string | null, body: unknown, headers: HeadersInit = {}) {
  const h = new Headers(headers)
  if (who) h.set('Authorization', `Bearer ${await tokenFor(who)}`)
  if (!h.has('cf-connecting-ip')) h.set('cf-connecting-ip', `192.0.2.${++ipCount % 250}`)
  h.set('Content-Type', 'application/json')
  const res = await fn(
    new Request('http://localhost/fn', { method: 'POST', body: JSON.stringify(body), headers: h }),
  )
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers }
}

const tokenOf = (link: string) => link.split('/').pop()!
const LOCAL = { Origin: 'http://localhost:4317' }

async function addPerson(name: string, colour = '#123456') {
  const { data, error } = await admin.from('profiles').insert({ display_name: name, colour })
    .select('id').single()
  if (error) throw error
  people.push(data.id)
  return data.id as string
}
async function linkRow(token: string) {
  const { data, error } = await admin.from('invites')
    .select('id, kind, expires_at, used_at, revoked_at, created_by')
    .eq('token_hash', await tokenHash(token)).single()
  if (error) throw error
  return data
}
async function userIdOf(email: string): Promise<string | null> {
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 })
  if (error) throw error
  return data.users.find((u) => u.email === email)?.id ?? null
}

const people: string[] = []
const emails: string[] = []
const INVALID = { error: 'invalid_link' }

Deno.test(
  { name: 'invite and reset link Edge Functions', sanitizeResources: false, sanitizeOps: false },
  async (t) => {
    try {
      const ana = await addPerson('Deno Ana')

      await t.step('invite-create and admin-reset-link: admins only', async () => {
        for (const fn of [invite, reset]) {
          assertEquals((await call(fn, null, { profile_id: ana })).status, 401)
          const forged = { Authorization: 'Bearer not.a.jwt' }
          assertEquals((await call(fn, null, { profile_id: ana }, forged)).status, 401)
          for (const who of ['tamsin', 'kwame', 'petra']) {
            assertEquals((await call(fn, who, { profile_id: ana })).status, 403, who)
          }
        }
        const { count } = await admin.from('invites').select('id', { count: 'exact', head: true })
          .eq('profile_id', ana)
        assertEquals(count, 0, 'a refused call created a link')
      })

      await t.step('invite-create: refused people and bad input', async () => {
        assertEquals((await call(invite, 'orla', { profile_id: 'x' })).status, 400)
        assertEquals((await call(invite, 'orla', {})).status, 400)
        assertEquals(
          (await call(invite, 'orla', { profile_id: '00000000-0000-4000-8000-00000000ffff' }))
            .status,
          404,
        )
        assertEquals((await call(invite, 'orla', { profile_id: P('a3') })).body, {
          error: 'not_allowed',
        }, 'claimed')
        assertEquals((await call(invite, 'orla', { profile_id: P('c1') })).status, 409, 'system')
        assertEquals((await call(invite, 'orla', { profile_id: P('b2') })).status, 409, 'no colour')
        assertEquals((await call(reset, 'orla', { profile_id: ana })).status, 409, 'unclaimed')
        assertEquals((await call(reset, 'orla', { profile_id: P('c1') })).status, 409, 'system')
      })

      let anaToken = ''
      await t.step('invite-create: a link for 14 days; only the hash is stored', async () => {
        const res = await call(invite, 'orla', { profile_id: ana }, LOCAL)
        assertEquals(res.status, 200)
        assertMatch(res.body.link, /^http:\/\/localhost:4317\/film-club\/#\/invite\/[\w-]{43}$/)
        anaToken = tokenOf(res.body.link)
        const row = await linkRow(anaToken)
        assertEquals([row.kind, row.created_by, row.used_at, row.revoked_at], [
          'invite',
          P('a1'),
          null,
          null,
        ])
        const days = (Date.parse(row.expires_at) - Date.now()) / 86_400_000
        assert(days > 13.99 && days <= 14, `expires in ${days} days`)
        const { data } = await admin.from('invites').select('*').eq('id', row.id).single()
        assert(!JSON.stringify(data).includes(anaToken), 'the raw token is stored')

        // Not the site or localhost: the link is for the real site.
        const other = await call(invite, 'orla', { profile_id: ana }, { Origin: 'https://x.test' })
        assertMatch(other.body.link, /^https:\/\/manel27\.github\.io\/film-club\/#\/invite\//)
        assert(
          (await linkRow(anaToken)).revoked_at,
          'regenerating revokes the old link',
        )
        assertEquals((await call(preview, null, { token: anaToken })).body, INVALID)
        anaToken = tokenOf(other.body.link)
      })

      await t.step('invite-preview: name, colour and films watched only', async () => {
        const res = await call(preview, null, { token: anaToken })
        assertEquals([res.status, res.body], [200, {
          name: 'Deno Ana',
          colour: '#123456',
          watched: 0,
        }])
        for (const token of [undefined, 'garbage', 'x'.repeat(43), anaToken + 'x']) {
          const bad = await call(preview, null, { token })
          assertEquals([bad.status, bad.body], [404, INVALID])
        }
      })

      await t.step('invite-preview: expired and revoked links get the same answer', async () => {
        const bob = await addPerson('Deno Bob')
        const t1 = tokenOf((await call(invite, 'orla', { profile_id: bob })).body.link)
        const row = await linkRow(t1)
        const past = new Date(Date.now() - 86_400_000).toISOString()
        const { error } = await admin.from('invites').update({
          created_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
          expires_at: past,
        }).eq('id', row.id)
        if (error) throw error
        assertEquals((await call(preview, null, { token: t1 })).body, INVALID, 'expired')
        const claimed = await call(claim, null, {
          token: t1,
          email: 'deno-bob@example.test',
          password: 'long-enough',
        })
        assertEquals([claimed.status, claimed.body], [404, INVALID], 'claim an expired link')
        assertEquals(await userIdOf('deno-bob@example.test'), null)

        // An expired link is replaced when the admin regenerates it.
        const t2 = tokenOf((await call(invite, 'orla', { profile_id: bob })).body.link)
        assertEquals((await call(preview, null, { token: t2 })).status, 200)
        const r2 = await linkRow(t2)
        // Revoked by the admin from the browser (RLS: admins may revoke).
        const orla = createClient(apiUrl, env.PUBLISHABLE_KEY, {
          ...noSession,
          global: { headers: { Authorization: `Bearer ${await tokenFor('orla')}` } },
        })
        const revoked = await orla.from('invites').update({ revoked_at: new Date().toISOString() })
          .eq('id', r2.id).select('id')
        assertEquals(revoked.data?.length, 1)
        assertEquals((await call(preview, null, { token: t2 })).body, INVALID, 'revoked')
        const claimRevoked = await call(claim, null, {
          token: t2,
          email: 'deno-bob@example.test',
          password: 'long-enough',
        })
        assertEquals(
          [claimRevoked.status, claimRevoked.body],
          [404, INVALID],
          'claim a revoked link',
        )
        assertEquals(await userIdOf('deno-bob@example.test'), null)
      })

      await t.step('invite-claim: bad email or short password keeps the link open', async () => {
        const ok = 'deno-ana@example.test'
        for (
          const [body, error] of [
            [{ email: 'not-an-email', password: 'long-enough' }, 'invalid_email'],
            [{ email: ok, password: 'short' }, 'invalid_password'],
            [{ email: ok }, 'invalid_password'],
            [{ email: ok, password: ' \t'.repeat(5) }, 'invalid_password'],
            // 37 characters but 74 UTF-8 bytes: over bcrypt's 72.
            [{ email: ok, password: 'é'.repeat(37) }, 'invalid_password'],
          ] as const
        ) {
          const res = await call(claim, null, { token: anaToken, ...body })
          assertEquals([res.status, res.body], [400, { error }], JSON.stringify(body))
        }
        assertEquals(await userIdOf(ok), null)
        // An email that already has a login: refused, and the link stays open.
        const taken = await call(claim, null, {
          token: anaToken,
          email: 'kwame@example.test',
          password: 'long-enough',
        })
        assertEquals([taken.status, taken.body], [409, { error: 'email_taken' }])
        assertEquals((await call(preview, null, { token: anaToken })).status, 200)
      })

      await t.step('invite-claim: creates the login and links it; single use', async () => {
        emails.push('deno-ana@example.test')
        const res = await call(claim, null, {
          token: anaToken,
          email: ' Deno-Ana@Example.test ',
          password: 'ana-password',
        })
        assertEquals([res.status, res.body], [200, { ok: true }])
        const { data, error } = await signIn('deno-ana@example.test', 'ana-password')
        if (error) throw error
        const { data: profile } = await admin.from('profiles')
          .select('auth_user_id, claimed_at').eq('id', ana).single()
        assertEquals(profile!.auth_user_id, data.user.id)
        assert(profile!.claimed_at)
        assert((await linkRow(anaToken)).used_at, 'the invite is used')

        assertEquals((await call(preview, null, { token: anaToken })).body, INVALID, 'used')
        const again = await call(claim, null, {
          token: anaToken,
          email: 'deno-ana-2@example.test',
          password: 'ana-password',
        })
        assertEquals([again.status, again.body], [404, INVALID])
        assertEquals(await userIdOf('deno-ana-2@example.test'), null)
        // Now claimed: no more invites.
        assertEquals((await call(invite, 'orla', { profile_id: ana })).status, 409)
      })

      await t.step('invite-claim: two claims at once, one wins, no stray login', async () => {
        const cy = await addPerson('Deno Cy')
        const token = tokenOf((await call(invite, 'orla', { profile_id: cy })).body.link)
        const a = 'deno-cy-a@example.test'
        const b = 'deno-cy-b@example.test'
        emails.push(a, b)
        const results = await Promise.all(
          [a, b].map((email) => call(claim, null, { token, email, password: 'cy-password' })),
        )
        assertEquals(results.map((r) => r.status).sort(), [200, 404])
        const winner = results[0].status === 200 ? a : b
        const loser = winner === a ? b : a
        assert(await userIdOf(winner))
        assertEquals(await userIdOf(loser), null, 'the losing login was deleted')
      })

      await t.step('invite-claim: person claimed meanwhile, the new login is deleted', async () => {
        const dee = await addPerson('Deno Dee')
        const token = tokenOf((await call(invite, 'orla', { profile_id: dee })).body.link)
        const other = 'deno-dee-other@example.test'
        const email = 'deno-dee@example.test'
        emails.push(other, email)
        const { data: made } = await admin.auth.admin.createUser({
          email: other,
          password: 'x-12345678',
        })
        // Right after the function creates its login, Dee gets a login some other way.
        const realFetch = globalThis.fetch
        globalThis.fetch = async (input, init) => {
          const res = await realFetch(input, init)
          if (String(input).endsWith('/auth/v1/admin/users') && init?.method === 'POST') {
            globalThis.fetch = realFetch
            const { error } = await admin.from('profiles')
              .update({ auth_user_id: made.user!.id, claimed_at: new Date().toISOString() })
              .eq('id', dee)
            if (error) throw error
          }
          return res
        }
        try {
          const res = await call(claim, null, { token, email, password: 'dee-password' })
          assertEquals([res.status, res.body], [404, INVALID])
        } finally {
          globalThis.fetch = realFetch
        }
        assertEquals(await userIdOf(email), null, 'the new login was deleted')
        assertEquals((await linkRow(token)).used_at, null, 'the invite was left as it was')
      })

      await t.step(
        'admin-reset-link + reset-claim: new password, 24 hours, single use',
        async () => {
          const res = await call(reset, 'orla', { profile_id: ana }, LOCAL)
          assertEquals(res.status, 200)
          assertMatch(res.body.link, /^http:\/\/localhost:4317\/film-club\/#\/reset\/[\w-]{43}$/)
          const token = tokenOf(res.body.link)
          const row = await linkRow(token)
          assertEquals(row.kind, 'reset')
          const hours = (Date.parse(row.expires_at) - Date.now()) / 3_600_000
          assert(hours > 23.9 && hours <= 24, `expires in ${hours} hours`)

          // A reset link is not an invite.
          assertEquals((await call(preview, null, { token })).body, INVALID)
          // An invite token is not a reset link.
          assertEquals(
            (await call(resetClaim, null, { token: anaToken, password: 'whatever1' })).body,
            INVALID,
          )

          // Ana is logged in elsewhere: that session must end (decision I3).
          const old = await signIn('deno-ana@example.test', 'ana-password')
          if (old.error) throw old.error
          // Her old access token, as a browser would use it against the database.
          const oldDb = createClient(apiUrl, env.PUBLISHABLE_KEY, {
            ...noSession,
            global: { headers: { Authorization: `Bearer ${old.data.session!.access_token}` } },
          })
          const before = await oldDb.from('profiles').select('id')
          assert((before.data ?? []).length > 0, 'the old session reads people before the reset')

          for (const password of ['short', ' '.repeat(10), 'é'.repeat(37)]) {
            const bad = await call(resetClaim, null, { token, password })
            assertEquals([bad.status, bad.body], [400, { error: 'invalid_password' }])
          }
          // The reset page checks the link first.
          assertEquals((await call(preview, null, { token, kind: 'reset' })).body, {
            name: 'Deno Ana',
            colour: '#123456',
            watched: 0,
          })
          assertEquals(
            (await call(resetClaim, null, { token: 'nope', password: 'short' })).body,
            INVALID,
          )
          const done = await call(resetClaim, null, { token, password: 'new-ana-password' })
          assertEquals([done.status, done.body], [200, { email: 'deno-ana@example.test' }])
          assertEquals((await signIn('deno-ana@example.test', 'new-ana-password')).error, null)
          assert(
            (await signIn('deno-ana@example.test', 'ana-password')).error,
            'old password works',
          )

          const again = await call(resetClaim, null, { token, password: 'third-password' })
          assertEquals([again.status, again.body], [404, INVALID], 'used')

          const client = createClient(apiUrl, env.PUBLISHABLE_KEY, noSession)
          const refreshed = await client.auth.refreshSession({
            refresh_token: old.data.session!.refresh_token,
          })
          assert(refreshed.error, 'the old session can still be refreshed')
          const user = await client.auth.getUser(old.data.session!.access_token)
          assert(user.error, 'the old access token still works')
          // Still signed and unexpired, but its session is gone: the database gives it nothing (S1).
          const after = await oldDb.from('profiles').select('id')
          assertEquals([after.error, after.data], [null, []], 'the old access token reads people')
          const comment = await oldDb.from('comments')
            .insert({ film_id: 8, author_id: ana, body: 'written after the reset' })
          assertEquals(comment.error?.code, '42501', 'the old access token can comment')
        },
      )

      await t.step('reset-claim: revoked and expired links are refused', async () => {
        const t1 = tokenOf((await call(reset, 'orla', { profile_id: ana })).body.link)
        const t2 = tokenOf((await call(reset, 'orla', { profile_id: ana })).body.link)
        assertEquals(
          (await call(resetClaim, null, { token: t1, password: 'revoked-pass' })).body,
          INVALID,
          'regenerated (revoked)',
        )
        const row = await linkRow(t2)
        const now = Date.now()
        const { error } = await admin.from('invites').update({
          created_at: new Date(now - 3_600_000 * 25).toISOString(),
          expires_at: new Date(now - 3_600_000).toISOString(),
        }).eq('id', row.id)
        if (error) throw error
        assertEquals(
          (await call(resetClaim, null, { token: t2, password: 'expired-pass' })).body,
          INVALID,
          'expired',
        )
        assertEquals((await signIn('deno-ana@example.test', 'new-ana-password')).error, null)
      })

      await t.step('reset-claim: if the password cannot be set, the link stays open', async () => {
        const token = tokenOf((await call(reset, 'orla', { profile_id: ana })).body.link)
        const realFetch = globalThis.fetch
        globalThis.fetch = (input, init) =>
          /\/auth\/v1\/admin\/users\/[\w-]+$/.test(String(input)) && init?.method === 'PUT'
            ? Promise.resolve(Response.json({ msg: 'down' }, { status: 500 }))
            : realFetch(input, init)
        try {
          const res = await call(resetClaim, null, { token, password: 'never-set-pass' })
          assertEquals(res.status, 500)
        } finally {
          globalThis.fetch = realFetch
        }
        assertEquals((await linkRow(token)).used_at, null, 'the link was reopened')
        const done = await call(resetClaim, null, { token, password: 'final-ana-password' })
        assertEquals(done.status, 200)
        assertEquals((await signIn('deno-ana@example.test', 'final-ana-password')).error, null)
      })

      await t.step('public links: only failures count, per IP and overall', async () => {
        await admin.from('rate_limits').delete().eq('bucket', 'invite-link')
        const ip = { 'cf-connecting-ip': '198.51.100.23' }
        for (let i = 0; i < 10; i++) {
          const fn = [preview, claim, resetClaim][i % 3]
          assertEquals((await call(fn, null, { token: 'guess' }, ip)).status, 404)
        }
        for (const fn of [preview, claim, resetClaim]) {
          assertEquals((await call(fn, null, { token: 'guess' }, ip)).status, 429)
        }

        // Reloading a good link never uses up the allowance.
        const eve = await addPerson('Deno Eve')
        const token = tokenOf((await call(invite, 'orla', { profile_id: eve })).body.link)
        const home = { 'cf-connecting-ip': '198.51.100.24' }
        for (let i = 0; i < 15; i++) {
          assertEquals((await call(preview, null, { token }, home)).status, 200)
        }

        // A new (spoofed) address for every guess still hits the overall cap of 100.
        let n = 0
        while (
          n < 200 &&
          (await call(preview, null, { token: 'guess' }, { 'cf-connecting-ip': `x-${n}` }))
              .status === 404
        ) n++
        assertEquals(n, 90, 'failures allowed before the overall cap (10 already used)')
        assertEquals(
          (await call(preview, null, { token: 'guess' }, { 'cf-connecting-ip': 'fresh' })).status,
          429,
          'once the overall cap is reached, junk is refused from every address',
        )
        // ...but an open link is still served, even from a capped address (S3).
        assertEquals((await call(preview, null, { token }, ip)).status, 200)
        const claimed = await call(claim, null, {
          token,
          email: 'deno-eve@example.test',
          password: 'eve-password',
        }, ip)
        emails.push('deno-eve@example.test')
        assertEquals([claimed.status, claimed.body], [200, { ok: true }], 'a capped claim')

        // A huge header is clipped, not stored whole.
        await admin.from('rate_limits').delete().eq('bucket', 'invite-link')
        await call(preview, null, { token: 'guess' }, { 'cf-connecting-ip': 'z'.repeat(500) })
        const { data } = await admin.from('rate_limits').select('subject').eq(
          'bucket',
          'invite-link',
        )
        assertEquals(data!.map((r) => r.subject.length).sort(), [1, 64])

        // An open link's own cap: 10 failed claims an hour, from anywhere, then that link is refused.
        await admin.from('rate_limits').delete().eq('bucket', 'invite-link')
        const fay = await addPerson('Deno Fay')
        const fayToken = tokenOf((await call(invite, 'orla', { profile_id: fay })).body.link)
        const taken = { email: 'kwame@example.test', password: 'long-enough' }
        for (let i = 0; i < 10; i++) {
          assertEquals((await call(claim, null, { token: fayToken, ...taken })).status, 409)
        }
        assertEquals((await call(claim, null, { token: fayToken, ...taken })).status, 429)
        assertEquals((await call(preview, null, { token: fayToken })).status, 429)
        // Other links are untouched.
        const gus = await addPerson('Deno Gus')
        const gusToken = tokenOf((await call(invite, 'orla', { profile_id: gus })).body.link)
        assertEquals((await call(preview, null, { token: gusToken })).status, 200)
      })
    } finally {
      for (const email of emails) {
        const id = await userIdOf(email)
        if (id) await admin.auth.admin.deleteUser(id)
      }
      if (people.length) await admin.from('profiles').delete().in('id', people)
      await admin.from('rate_limits').delete().eq('bucket', 'invite-link')
    }
  },
)
