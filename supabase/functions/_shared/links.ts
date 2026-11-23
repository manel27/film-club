// Invite and reset links (plan 7; decisions I1, I2). Shared by invite-create,
// admin-reset-link, invite-preview, invite-claim and reset-claim.
//
// These are the only functions that use the secret key (supabase/README.md):
// invites can't be inserted or claimed from a browser. The admin ones check
// the caller's JWT and re-read their role from the database first; the public
// ones are rate-limited (failures only) and every bad link gets the same answer.
// Raw tokens are never stored or logged: only their SHA-256 hash.
import { createClient } from 'npm:@supabase/supabase-js@2.119.0'
import { corsHeaders, fail, getCaller, json, readBody, SITE_ORIGIN } from './common.ts'

export type LinkKind = 'invite' | 'reset'

/** Same minimum as auth.minimum_password_length in config.toml; 72 bytes is bcrypt's limit. */
export const PASSWORD_MIN = 8
const PASSWORD_MAX_BYTES = 72
const TOKEN = /^[A-Za-z0-9_-]{43}$/
const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
/** The one answer for an invalid, expired, used or revoked link (never says which). */
const INVALID = { error: 'invalid_link' }

/** Client with the project's secret key (new key system), else the legacy service role key. */
function serviceClient() {
  let keys: { default?: string } | null = null
  try {
    keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '')
  } catch {
    // Not set (older runtimes)
  }
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    keys?.default ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  )
}

/** 32 random bytes, base64url (43 characters). */
function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(
    /=+$/,
    '',
  )
}

/** SHA-256 of the token, as Postgres bytea hex input. */
export async function tokenHash(token: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)),
  )
  return '\\x' + Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * The visitor's IP, as the platform's proxy reports it.
 * shortcut: cf-connecting-ip / the first x-forwarded-for entry may be client-set (unverified
 * on the hosted proxy); the global cap of 100 failures an hour (invite_rate_fail) bounds
 * spoofing, and open links skip both caps, so a flood can't lock invitees out. Once the
 * hosted headers are confirmed, key on the proxy-set one only.
 */
export function clientIp(req: Request): string {
  return req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
}

/**
 * POST { profile_id } -> { link, expires_at }. Admins only. Revokes the
 * person's open link (expired or not) and issues a new one: an invite (14
 * days, unclaimed people with a colour) or a reset link (24 hours, people
 * with a login). The raw link is returned once and never stored.
 */
export async function issueLink(req: Request, kind: LinkKind): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders(req) })
  if (req.method !== 'POST') return json(req, 405, { error: 'method_not_allowed' })
  try {
    const me = await getCaller(req)
    if (!me) return json(req, 401, { error: 'unauthorized' })
    if (me.role !== 'admin') return json(req, 403, { error: 'forbidden' })

    const b = await readBody(req)
    if (typeof b?.profile_id !== 'string' || !UUID.test(b.profile_id)) {
      return json(req, 400, { error: 'invalid' })
    }
    const token = newToken()
    const { data, error } = await serviceClient().rpc('invite_issue', {
      p_profile_id: b.profile_id,
      p_kind: kind,
      p_token_hash: await tokenHash(token),
      p_created_by: me.id,
    })
    // invites_guard: system profile, no colour, claimed (invite) / unclaimed (reset).
    if (error?.code === '23514') return json(req, 409, { error: 'not_allowed' })
    if (error?.code === '23503') return json(req, 404, { error: 'not_found' })
    if (error) throw error
    // The page's own origin (the site, or localhost on the local stack): never a secret.
    const origin = corsHeaders(req)['Access-Control-Allow-Origin'] ?? SITE_ORIGIN
    return json(req, 200, { link: `${origin}/film-club/#/${kind}/${token}`, expires_at: data })
  } catch (e) {
    return fail(req, e)
  }
}

interface Person {
  display_name: string
  colour: string
  watched: number
}

type Public = (
  req: Request,
  db: ReturnType<typeof serviceClient>,
  body: Record<string, unknown>,
  hash: string,
  person: Person,
) => Promise<Response>

/** Answers that count against the rate limit: a bad link or a refused claim. */
const FAILED = new Set([400, 404, 409])

/**
 * Public endpoint: POST, then the link is looked up first (plan 7.5, audit
 * S3). An open link is always served: the caps never refuse it, so nobody
 * can lock real invitees out by flooding junk. Anything else is refused once
 * the caps are reached: 10 failures an hour per IP and 100 an hour overall
 * (invite_rate_ok / invite_rate_fail). Only failed attempts count.
 * `kindOf` says which kind of link the endpoint takes.
 */
function publicLink(kindOf: (body: Record<string, unknown>) => LinkKind, handle: Public) {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders(req) })
    if (req.method !== 'POST') return json(req, 405, { error: 'method_not_allowed' })
    try {
      const db = serviceClient()
      const ip = clientIp(req)
      const body = await readBody(req)
      const hash = body && typeof body.token === 'string' && TOKEN.test(body.token)
        ? await tokenHash(body.token)
        : null
      let person: Person | null = null
      if (hash) {
        const peek = await db.rpc('invite_peek', { p_token_hash: hash, p_kind: kindOf(body!) })
          .maybeSingle<Person>()
        if (peek.error) throw peek.error
        person = peek.data
      }
      if (!person) {
        const { data: allowed, error } = await db.rpc('invite_rate_ok', { p_ip: ip })
        if (error) throw error
        if (!allowed) return json(req, 429, { error: 'rate_limited' })
      }
      const res = person ? await handle(req, db, body!, hash!, person) : json(req, 404, INVALID)
      if (FAILED.has(res.status)) {
        const counted = await db.rpc('invite_rate_fail', { p_ip: ip })
        if (counted.error) throw counted.error
      }
      return res
    } catch (e) {
      return fail(req, e)
    }
  }
}

/** Same rules as the pages (src/invites/links.ts): 8+ characters, at most 72 UTF-8 bytes, not only whitespace. */
const validPassword = (v: unknown): v is string =>
  typeof v === 'string' && v.length >= PASSWORD_MIN && /\S/.test(v) &&
  new TextEncoder().encode(v).length <= PASSWORD_MAX_BYTES

/** Supabase Auth refused the email or password: a 400 the page can explain, or null. */
function authRefusal(req: Request, code: string | undefined): Response | null {
  if (code === 'email_address_invalid') return json(req, 400, { error: 'invalid_email' })
  if (code === 'weak_password' || code === 'validation_failed') {
    return json(req, 400, { error: 'invalid_password' })
  }
  return null
}

/**
 * POST { token, kind? } -> { name, colour, watched }: only who an open link is
 * for. kind 'reset' checks a reset link (the reset page), else an invite.
 */
export const invitePreview = publicLink(
  (body) => body.kind === 'reset' ? 'reset' : 'invite',
  (req, _db, _body, _hash, person) =>
    Promise.resolve(
      json(req, 200, { name: person.display_name, colour: person.colour, watched: person.watched }),
    ),
)

/**
 * POST { token, email, password } -> { ok }. Creates the login (confirmed, no
 * email sent) and links it to the invite's profile. If linking fails (the
 * link was used or revoked meanwhile, a second simultaneous claim, or the
 * person got a login some other way), the new login is deleted again. If the
 * function dies between the two steps, see supabase/README.md (orphaned
 * login). The page then signs in.
 */
export const inviteClaim = publicLink(() => 'invite', async (req, db, body, hash) => {
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!EMAIL.test(email) || email.length > 254) return json(req, 400, { error: 'invalid_email' })
  if (!validPassword(body.password)) return json(req, 400, { error: 'invalid_password' })

  const created = await db.auth.admin.createUser({
    email,
    password: body.password,
    email_confirm: true,
  })
  if (created.error) {
    if (created.error.code === 'email_exists') return json(req, 409, { error: 'email_taken' })
    const refused = authRefusal(req, created.error.code)
    if (refused) return refused
    throw created.error
  }
  const userId = created.data.user.id
  const linked = await db.rpc('invite_redeem', {
    p_token_hash: hash,
    p_kind: 'invite',
    p_auth_user_id: userId,
  }).maybeSingle()
  if (linked.error || !linked.data) {
    const undo = await db.auth.admin.deleteUser(userId)
    if (undo.error) console.error('invite-claim: could not delete the new login', undo.error.code)
    // 23514: the person can no longer take this invite (claimed meanwhile).
    if (linked.error && linked.error.code !== '23514') throw linked.error
    return json(req, 404, INVALID)
  }
  return json(req, 200, { ok: true })
})

/**
 * POST { token, password } -> { email }. Sets a new password for the reset
 * link's person, uses the link up and ends the person's sessions on every
 * device (decision I3; tokens of ended sessions get nothing from the
 * database, migration 20261123120000). If the password can't be set, the
 * link stays usable. The page then signs in with the returned email.
 */
export const resetClaim = publicLink(() => 'reset', async (req, db, body, hash) => {
  if (!validPassword(body.password)) return json(req, 400, { error: 'invalid_password' })
  const used = await db.rpc('invite_redeem', { p_token_hash: hash, p_kind: 'reset' })
    .maybeSingle<{ invite_id: string; auth_user_id: string }>()
  if (used.error && used.error.code !== '23514') throw used.error
  if (!used.data) return json(req, 404, INVALID)
  const updated = await db.auth.admin.updateUserById(used.data.auth_user_id, {
    password: body.password,
  })
  if (updated.error) {
    const undo = await db.from('invites').update({ used_at: null }).eq('id', used.data.invite_id)
    if (undo.error) console.error('reset-claim: could not reopen the link', undo.error.code)
    const refused = authRefusal(req, updated.error.code)
    if (refused) return refused
    throw updated.error
  }
  return json(req, 200, { email: updated.data.user.email })
})
