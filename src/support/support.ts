import type { MyProfile } from '../auth/backend'
import { errorMessage } from '../films/filmDetail'
import { normaliseReason, normaliseText, reasonLength } from '../films/filmForm'

/** The longest title and text (code points, after normalising); the database checks them too. */
export const TITLE_MAX = 100
export const TEXT_MAX = 2000

export const isStaff = (me: MyProfile | null) => me?.role === 'admin' || me?.role === 'moderator'

/**
 * Text as stored, or what is wrong with it. Titles are one line (normaliseReason, checked by
 * app.is_tidy_text); suggestion text and replies keep line breaks (`multiline`: normaliseText,
 * checked by app.is_tidy_multiline).
 */
export function checkText(
  text: string,
  max: number,
  empty: string,
  multiline = false,
): { value: string } | { error: string } {
  const value = (multiline ? normaliseText : normaliseReason)(text)
  if (!value) return { error: empty }
  if (reasonLength(value) > max) return { error: `Keep it to ${max} characters or fewer.` }
  return { value }
}

/** Who may delete a suggestion: the admin; its author while only they have replied. Mirrors the delete guard. */
export function canDelete(
  me: MyProfile | null,
  s: { author_id: string; suggestion_replies: { author_id: string }[] },
): boolean {
  if (me?.role === 'admin') return true
  return s.author_id === me?.id && s.suggestion_replies.every((r) => r.author_id === s.author_id)
}

/** Characters as saved, for the counters. */
export const savedLength = (text: string, multiline = false) =>
  reasonLength((multiline ? normaliseText : normaliseReason)(text))

/**
 * Friendly text for a failed suggestion write. A refused reply means the suggestion is gone
 * (or no longer yours to see): RLS answers before the foreign key does.
 */
export function supportError(error: unknown, write?: 'reply' | 'delete'): string {
  const { code, message } = (error ?? {}) as { code?: string; message?: string }
  if (write === 'reply' && code === '42501') return 'This suggestion was deleted.'
  if (code === '42501' && message?.includes('has a reply')) {
    return 'Someone has replied, so this suggestion can no longer be deleted.'
  }
  if (code === '23503') return 'This suggestion was deleted.'
  return errorMessage(error)
}

/** "27 Nov 2026, 14:05" in Lisbon time. */
export const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', {
    timeZone: 'Europe/Lisbon',
    dateStyle: 'medium',
    timeStyle: 'short',
  })
