/**
 * Turns a Supabase Auth sign-in error into a short, friendly message.
 * Duck-typed (name / status / code) so it doesn't depend on supabase-js error
 * classes, and it never echoes the server's raw text or the email.
 */
export function loginErrorMessage(error: unknown): string {
  const { name, status, code } = (error ?? {}) as {
    name?: unknown
    status?: unknown
    code?: unknown
  }

  if (code === 'invalid_credentials' || (status === 400 && code === undefined)) {
    return 'Wrong email or password.'
  }
  if (code === 'over_request_rate_limit' || status === 429) {
    return 'Too many attempts. Wait a few minutes and try again.'
  }
  if (code === 'user_banned') {
    return 'This account is disabled. Ask Manel.'
  }
  if (
    name === 'AuthRetryableFetchError' ||
    status === 0 ||
    error instanceof TypeError ||
    (typeof status === 'number' && status >= 500)
  ) {
    return "Couldn't reach the server. Check your connection and try again."
  }
  return 'Something went wrong while logging in. Try again.'
}
