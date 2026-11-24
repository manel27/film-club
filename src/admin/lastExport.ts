import { useEffect, useState } from 'react'
import { fetchLastExport } from '../invites/api'

const DAY = 86_400_000
/** Fired on window after an export, so the banner and the Admin page agree at once. */
const EXPORTED = 'film-club:exported'

/** True when the admin should be reminded: never exported, or 30 days or more ago. */
export function exportOverdue(lastExport: string | null, now = Date.now()): boolean {
  // NaN (never, or unreadable) fails the comparison: overdue.
  return !(now - Date.parse(lastExport ?? '') < 30 * DAY)
}

/** "24 Nov 2026" (Lisbon), for "Last export: …". */
export const exportDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Europe/Lisbon',
  })

/** Tells every useLastExport() an export just happened. */
export const announceExport = (at: string) =>
  window.dispatchEvent(new CustomEvent(EXPORTED, { detail: at }))

/**
 * app_settings.last_export_at, for an admin: undefined while loading (or if
 * it can't be read, so nobody is nagged over a network error), else { at },
 * at null when there has never been an export.
 */
export function useLastExport(enabled: boolean) {
  const [state, setState] = useState<{ at: string | null }>()
  useEffect(() => {
    if (!enabled) return
    let live = true
    fetchLastExport().then(
      (at) => live && setState({ at }),
      () => {},
    )
    const onExport = (e: Event) => setState({ at: (e as CustomEvent<string>).detail })
    window.addEventListener(EXPORTED, onExport)
    return () => {
      live = false
      window.removeEventListener(EXPORTED, onExport)
    }
  }, [enabled])
  return state
}
