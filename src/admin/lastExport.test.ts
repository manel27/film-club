import { describe, expect, it, vi } from 'vitest'
import { exportDate, exportOverdue } from './lastExport'

vi.mock('../invites/api', () => ({}))

const NOW = Date.parse('2026-11-24T12:00:00Z')
const DAY = 86_400_000

describe('exportOverdue', () => {
  it('is overdue when there has never been an export', () => {
    expect(exportOverdue(null, NOW)).toBe(true)
  })

  it('is not overdue within 30 days', () => {
    expect(exportOverdue(new Date(NOW).toISOString(), NOW)).toBe(false)
    expect(exportOverdue(new Date(NOW - 30 * DAY + 1).toISOString(), NOW)).toBe(false)
    // A clock a little ahead of this one: still recent.
    expect(exportOverdue(new Date(NOW + DAY).toISOString(), NOW)).toBe(false)
  })

  it('is overdue from 30 days on', () => {
    expect(exportOverdue(new Date(NOW - 30 * DAY).toISOString(), NOW)).toBe(true)
    expect(exportOverdue('2026-01-01T00:00:00Z', NOW)).toBe(true)
  })

  it('treats an unreadable date as never', () => {
    expect(exportOverdue('not a date', NOW)).toBe(true)
  })
})

describe('exportDate', () => {
  it('is a short date in Lisbon', () => {
    expect(exportDate('2026-11-23T23:30:00Z')).toBe('23 Nov 2026')
    expect(exportDate('2026-07-31T23:30:00Z')).toBe('1 Aug 2026')
  })
})
