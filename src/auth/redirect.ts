/**
 * Where to go after logging in. Only in-app paths are accepted ("/films/12"),
 * never another site ("//evil.example", "https://…") or the login page itself.
 */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) {
    return '/'
  }
  if (next === '/login' || next.startsWith('/login?') || next.startsWith('/login/')) {
    return '/'
  }
  return next
}

/** The login URL that brings the user back to `path` afterwards. */
export function loginPathFor(path: string): string {
  const next = safeNextPath(path)
  return next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`
}
