import type { FunctionError } from '../films/filmForm'

/** Same as auth.minimum_password_length (supabase/config.toml) and the functions. */
export const PASSWORD_MIN = 8
/** bcrypt's limit, in UTF-8 bytes; Supabase Auth refuses longer passwords. */
export const PASSWORD_MAX_BYTES = 72

export const INVALID_LINK_MESSAGE =
  'This link is invalid, has expired or was already used. Ask Manel for a new link.'

/** Friendly text for a failed invite / reset call; the server never says why a link is bad. */
export function linkErrorMessage(e: unknown): string {
  const { status, error } = (e ?? {}) as Partial<FunctionError>
  if (status === 404) return INVALID_LINK_MESSAGE
  if (status === 429) return 'Too many attempts from this network. Wait an hour and try again.'
  if (status === 409 && error === 'email_taken') {
    return 'That email already has an account. Use another one, or ask Manel.'
  }
  if (status === 400 && error === 'invalid_email') return "That email address isn't valid."
  if (status === 400 && error === 'invalid_password') return PASSWORD_RULE
  if (status === 400) return 'Check the email and password and try again.'
  if (!status) return "Couldn't reach the server. Try again."
  return 'Something went wrong. Try again.'
}

/** Friendly text for a failed invite-create / admin-reset-link call. */
export function adminLinkErrorMessage(e: unknown): string {
  const { status } = (e ?? {}) as Partial<FunctionError>
  if (status === 409) return "This person can't get that link (check their colour and login)."
  if (status === 404) return 'This person was removed.'
  if (status === 403) return 'Only the admin can do that.'
  if (status === 401) return 'Your session has ended. Log in again.'
  if (!status) return "Couldn't reach the server. Try again."
  return 'Something went wrong. Try again.'
}

/** Friendly text for a failed admin-remove-login call. */
export function removeLoginErrorMessage(e: unknown): string {
  const { status, error } = (e ?? {}) as Partial<FunctionError>
  if (status === 409 && error === 'self') return "You can't remove your own login."
  if (status === 409) return "This person doesn't have a login any more."
  return adminLinkErrorMessage(e)
}

const PASSWORD_RULE = `Use ${PASSWORD_MIN} or more characters, not only spaces (very long passwords are refused).`

/**
 * Why a new password can't be used, or null. Same rules as the functions
 * (supabase/functions/_shared/links.ts): 8+ characters, not only whitespace,
 * at most 72 UTF-8 bytes.
 */
export function passwordProblem(password: string, confirm: string): string | null {
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`
  if (!/\S/.test(password)) return "A password can't be only spaces."
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES) {
    return 'That password is too long. Use a shorter one.'
  }
  if (password !== confirm) return "The passwords don't match."
  return null
}

/** The invite page's stat line. */
export const watchedLine = (watched: number) =>
  watched === 0
    ? 'Welcome to the club!'
    : `You've been at ${watched} club screening${watched === 1 ? '' : 's'} so far.`

export interface OpenLink {
  id: string
  profileId: string
  kind: 'invite' | 'reset'
  expiresAt: string
}

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Lisbon',
  })

/** Short, for a phone: "Invite until 6 Dec, 20:10" or "Reset link expired 1 Jul, 10:00". */
export function linkLabel(link: OpenLink, now = new Date()): string {
  const name = link.kind === 'invite' ? 'Invite' : 'Reset link'
  return Date.parse(link.expiresAt) > now.getTime()
    ? `${name} until ${when(link.expiresAt)}`
    : `${name} expired ${when(link.expiresAt)}`
}
