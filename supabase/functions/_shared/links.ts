// Invite and reset links (plan 7; decisions I1, I2). Shared by invite-create,
// admin-reset-link, invite-preview, invite-claim and reset-claim.
//
// These are the only functions that use the secret key (supabase/README.md):
// invites can't be inserted or claimed from a browser. The admin ones check
// the caller's JWT and re-read their role from the database first; the public
// ones are rate-limited per IP and every token failure gets the same answer.
// Raw tokens are never stored or logged: only their SHA-256 hash.
import { createClient } from 'npm:@supabase/supabase-js@2.119.0'
import { corsHeaders, fail, getCaller, json, readBody, SITE_ORIGIN } from './common.ts'

export type LinkKind = 'invite' | 'reset'

/** Same minimum as auth.minimum_password_length in config.toml; 72 is bcrypt's limit. */
export const PASSWORD_MIN = 8
const PASSWORD_MAX = 72
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
 * shortcut: trusts cf-connecting-ip / the first x-forwarded-for entry; if the hosted
 * proxy turns out to pass a client-set value through, key on the proxy-appended entry.
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

type Public = (
  req: Request,
  db: ReturnType<typeof serviceClient>,
  body: Record<string, unknown>,
  hash: string,
) => Promise<Response>

/** Public endpoint: POST, rate limit (10 per IP per hour, plan 7.5), a well-formed token. */
function publicLink(handle: Public) {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders(req) })
    if (req.method !== 'POST') return json(req, 405, { error: 'method_not_allowed' })
    try {
      const db = serviceClient()
      const { data: allowed, error } = await db.rpc('invite_rate_hit', { p_ip: clientIp(req) })
      if (error) throw error
      if (!allowed) return json(req, 429, { error: 'rate_limited' })
      const body = await readBody(req)
      if (!body || typeof body.token !== 'string' || !TOKEN.test(body.token)) {
        return json(req, 404, INVALID)
      }
      return await handle(req, db, body, await tokenHash(body.token))
    } catch (e) {
      return fail(req, e)
    }
  }
}

const validPassword = (v: unknown): v is string =>
  typeof v === 'string' && v.length >= PASSWORD_MIN && v.length <= PASSWORD_MAX

/** POST { token } -> { name, colour, watched }: only who the invite is for. */
export const invitePreview = publicLink(async (req, db, _body, hash) => {
  const { data, error } = await db.rpc('invite_peek', { p_token_hash: hash, p_kind: 'invite' })
    .maybeSingle<{ display_name: string; colour: string; watched: number }>()
  if (error) throw error
  if (!data) return json(req, 404, INVALID)
  return json(req, 200, { name: data.display_name, colour: data.colour, watched: data.watched })
})

/**
 * POST { token, email, password } -> { ok }. Creates the login (confirmed, no
 * email sent) and links it to the invite's profile. If linking fails (the
 * link was used or revoked meanwhile, e.g. a second simultaneous claim), the
 * new login is deleted again. The page then signs in.
 */
export const inviteClaim = publicLink(async (req, db, body, hash) => {
  const peek = await db.rpc('invite_peek', { p_token_hash: hash, p_kind: 'invite' }).maybeSingle()
  if (peek.error) throw peek.error
  if (!peek.data) return json(req, 404, INVALID)
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!EMAIL.test(email) || email.length > 254 || !validPassword(body.password)) {
    return json(req, 400, { error: 'invalid' })
  }

  const created = await db.auth.admin.createUser({
    email,
    password: body.password,
    email_confirm: true,
  })
  if (created.error) {
    if (created.error.code === 'email_exists') return json(req, 409, { error: 'email_taken' })
    if (created.error.code === 'weak_password') return json(req, 400, { error: 'invalid' })
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
    if (linked.error) throw linked.error
    return json(req, 404, INVALID)
  }
  return json(req, 200, { ok: true })
})

/**
 * POST { token, password } -> { email }. Sets a new password for the reset
 * link's person and uses the link up. If the password can't be set, the link
 * stays usable. The page then signs in with the returned email.
 */
export const resetClaim = publicLink(async (req, db, body, hash) => {
  if (!validPassword(body.password)) {
    // Same answer as a bad link unless the link is good, so it can't be probed.
    const peek = await db.rpc('invite_peek', { p_token_hash: hash, p_kind: 'reset' })
      .maybeSingle()
    if (peek.error) throw peek.error
    return peek.data ? json(req, 400, { error: 'invalid' }) : json(req, 404, INVALID)
  }
  const used = await db.rpc('invite_redeem', { p_token_hash: hash, p_kind: 'reset' })
    .maybeSingle<{ invite_id: string; auth_user_id: string }>()
  if (used.error) throw used.error
  if (!used.data) return json(req, 404, INVALID)
  const updated = await db.auth.admin.updateUserById(used.data.auth_user_id, {
    password: body.password,
  })
  if (updated.error) {
    const undo = await db.from('invites').update({ used_at: null }).eq('id', used.data.invite_id)
    if (undo.error) console.error('reset-claim: could not reopen the link', undo.error.code)
    if (updated.error.code === 'weak_password') return json(req, 400, { error: 'invalid' })
    throw updated.error
  }
  return json(req, 200, { email: updated.data.user.email })
})
