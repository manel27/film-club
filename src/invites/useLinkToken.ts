import { useEffect, useState } from 'react'
import { useParams } from 'react-router'

/** Shown when the page has no token: reloaded after it was read, or opened bare. */
export const NO_TOKEN_MESSAGE =
  "This page doesn't have its link any more (it is removed from the address bar once read). Open the link Manel sent you again."

/**
 * The invite or reset token from the URL, kept in memory only: as soon as the
 * page has read it, it is dropped from the address bar and history (security
 * audit S10), so an abandoned link isn't left in the browser. After a reload
 * the token is gone and this returns ''.
 */
export function useLinkToken(path: '/invite' | '/reset'): string {
  const { token = '' } = useParams()
  const [kept, setKept] = useState(token)
  // Another link opened in the same tab replaces the one in memory.
  if (token && token !== kept) setKept(token)
  useEffect(() => {
    if (token) window.history.replaceState(window.history.state, '', `#${path}`)
  }, [token, path])
  return kept
}
