import { describe, expect, it } from 'vitest'
import { readSupabaseEnv } from './supabaseEnv'

describe('readSupabaseEnv', () => {
  it('returns the URL and publishable key', () => {
    expect(
      readSupabaseEnv({
        VITE_SUPABASE_URL: 'https://example.supabase.co',
        VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example',
      }),
    ).toEqual({ url: 'https://example.supabase.co', publishableKey: 'sb_publishable_example' })
  })

  it('names every missing variable', () => {
    expect(() => readSupabaseEnv({})).toThrow(/VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY/)
  })

  it('rejects a secret key', () => {
    expect(() =>
      readSupabaseEnv({
        VITE_SUPABASE_URL: 'https://example.supabase.co',
        VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_example',
      }),
    ).toThrow(/secret key/)
  })
})
