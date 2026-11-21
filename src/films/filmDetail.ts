import type { MyProfile } from '../auth/backend'

/** A score as typed: 0–10, at most two decimals ("7,5" works too). */
export function parseScore(text: string): { score: number } | { error: string } {
  const value = text.trim().replace(',', '.')
  if (!/^\d+(\.\d+)?$/.test(value)) return { error: 'Enter a number from 0 to 10.' }
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return { error: 'Use at most two decimals.' }
  const score = Number(value)
  if (score > 10) return { error: 'Scores go from 0 to 10.' }
  return { score }
}

/**
 * What the logged-in profile may change on a film page. Mirrors the RLS
 * policies (plan 5), which remain the real guard: the UI only hides controls.
 */
export function permissions(me: MyProfile | null, scoresLocked: boolean) {
  const role = me?.role
  const canWrite = role === 'admin' || role === 'moderator' || role === 'member'
  const isStaff = role === 'admin' || role === 'moderator'
  const ownOrStaff = (profileId: string) => isStaff || (canWrite && profileId === me?.id)
  return {
    canWrite,
    isStaff,
    attendance: ownOrStaff,
    score: (profileId: string) => !scoresLocked && ownOrStaff(profileId),
    // Moderators can't touch others' comments; only the admin can (decision N3).
    comment: (authorId: string) => role === 'admin' || (canWrite && authorId === me?.id),
  }
}
