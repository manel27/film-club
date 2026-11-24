import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchLastExport } from './api'

const row = vi.hoisted(() => ({ value: null as unknown }))
vi.mock('../lib/supabase', () => {
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => ({ data: row.value === undefined ? null : row, error: null }),
  }
  return { supabase: { from: () => query } }
})

describe('fetchLastExport', () => {
  beforeEach(() => {
    row.value = undefined
  })

  it('returns a real, past date as stored', async () => {
    row.value = '2026-11-01T10:00:00.000Z'
    expect(await fetchLastExport()).toBe('2026-11-01T10:00:00.000Z')
  })

  it('is null when there has never been an export', async () => {
    expect(await fetchLastExport()).toBeNull()
  })

  it('is null for something that is not a date', async () => {
    row.value = 'not a date'
    expect(await fetchLastExport()).toBeNull()
    row.value = 42
    expect(await fetchLastExport()).toBeNull()
  })

  it('is null for a date far in the future (it would hide the reminder)', async () => {
    row.value = '2999-01-01T00:00:00Z'
    expect(await fetchLastExport()).toBeNull()
  })
})
