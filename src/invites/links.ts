import type { FunctionError } from '../films/filmForm'

/** Same as auth.minimum_password_length (supabase/config.toml) and the functions. */
export const PASSWORD_MIN = 8
/** bcrypt's limit; Supabase Auth refuses longer passwords. */
export const PASSWORD_MAX = 72

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

/** Why a new password can't be used, or null. */
export function passwordProblem(password: string, confirm: string): string | null {
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`
  if (password.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`
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
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Lisbon',
  })

/** E.g. "Invite open until 6 Dec 2026, 20:10" or "Reset link expired 1 Dec 2026, 09:00". */
export function linkLabel(link: OpenLink, now = new Date()): string {
  const name = link.kind === 'invite' ? 'Invite' : 'Reset link'
  return Date.parse(link.expiresAt) > now.getTime()
    ? `${name} open until ${when(link.expiresAt)}`
    : `${name} expired ${when(link.expiresAt)}`
}
