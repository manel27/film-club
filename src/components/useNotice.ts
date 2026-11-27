import { useLayoutEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router'

/**
 * A one-time notice passed in navigation state (e.g. "Deleted …"), and a ref for the element
 * that shows it, which gets focus. Kept in component state, then dropped from the history entry
 * (React Router keeps it in `usr`), so a reload or Back doesn't show it again.
 */
export function useNotice<T extends HTMLElement>() {
  const { state } = useLocation()
  const [notice] = useState((state as { notice?: string } | null)?.notice)
  const ref = useRef<T>(null)
  useLayoutEffect(() => {
    if (!notice) return
    ref.current?.focus()
    window.history.replaceState({ ...window.history.state, usr: null }, '')
  }, [notice])
  return [notice, ref] as const
}
