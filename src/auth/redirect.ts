// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x1f\x7f]/

function defaultOrigin(): string {
  return globalThis.location?.origin && globalThis.location.origin !== 'null'
    ? globalThis.location.origin
    : 'http://localhost'
}

/**
 * Where to go after logging in. Only in-app paths are accepted ("/films/12"),
 * never another site ("//evil.example", "https://…", "/\t/evil.example"),
 * anything with control characters (raw or percent-encoded), or the login
 * page itself. Anything else falls back to "/".
 */
export function safeNextPath(next: string | null | undefined, origin = defaultOrigin()): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) {
    return '/'
  }
  if (CONTROL_CHARS.test(next)) return '/'
  let decoded: string
  try {
    decoded = decodeURIComponent(next)
  } catch {
    return '/'
  }
  if (CONTROL_CHARS.test(decoded) || decoded.startsWith('//') || decoded.includes('\\')) {
    return '/'
  }
  let url: URL
  try {
    url = new URL(next, origin)
  } catch {
    return '/'
  }
  if (url.origin !== new URL(origin).origin) return '/'
  if (url.pathname === '/login' || url.pathname.startsWith('/login/')) return '/'
  return next
}

/** The login URL that brings the user back to `path` afterwards. */
export function loginPathFor(path: string): string {
  const next = safeNextPath(path)
  return next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`
}
