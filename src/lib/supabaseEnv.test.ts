import { describe, expect, it } from 'vitest'
import { assertBuildEnv, readSupabaseEnv } from './supabaseEnv'

const URL = 'https://example.supabase.co'
const KEY = 'sb_publishable_example123'

function errorOf(fn: () => unknown): string {
  try {
    fn()
  } catch (e) {
    return (e as Error).message
  }
  throw new Error('expected an error')
}

describe('readSupabaseEnv', () => {
  it('returns the URL and publishable key', () => {
    expect(readSupabaseEnv({ VITE_SUPABASE_URL: URL, VITE_SUPABASE_PUBLISHABLE_KEY: KEY })).toEqual(
      { url: URL, publishableKey: KEY },
    )
  })

  it('trims surrounding whitespace', () => {
    expect(
      readSupabaseEnv({
        VITE_SUPABASE_URL: `  ${URL}\n`,
        VITE_SUPABASE_PUBLISHABLE_KEY: ` ${KEY} `,
      }),
    ).toEqual({ url: URL, publishableKey: KEY })
  })

  it('names both variables when both are missing', () => {
    expect(() => readSupabaseEnv({})).toThrow(/VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY/)
  })

  it('names only the URL when only the URL is missing', () => {
    const message = errorOf(() => readSupabaseEnv({ VITE_SUPABASE_PUBLISHABLE_KEY: KEY }))
    expect(message).toMatch(/Missing Supabase configuration: VITE_SUPABASE_URL\./)
    expect(message).not.toMatch(/VITE_SUPABASE_PUBLISHABLE_KEY/)
  })

  it('names only the key when only the key is missing', () => {
    const message = errorOf(() => readSupabaseEnv({ VITE_SUPABASE_URL: URL }))
    expect(message).toMatch(/Missing Supabase configuration: VITE_SUPABASE_PUBLISHABLE_KEY\./)
  })

  it('treats whitespace-only values as missing', () => {
    expect(() =>
      readSupabaseEnv({ VITE_SUPABASE_URL: '   ', VITE_SUPABASE_PUBLISHABLE_KEY: '\t\n' }),
    ).toThrow(/Missing Supabase configuration: VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY/)
  })

  it('rejects a URL that is not http(s)', () => {
    expect(() =>
      readSupabaseEnv({ VITE_SUPABASE_URL: 'not a url', VITE_SUPABASE_PUBLISHABLE_KEY: KEY }),
    ).toThrow(/VITE_SUPABASE_URL is not a valid/)
  })

  it('rejects a legacy JWT key', () => {
    expect(() =>
      readSupabaseEnv({
        VITE_SUPABASE_URL: URL,
        VITE_SUPABASE_PUBLISHABLE_KEY: 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.fake',
      }),
    ).toThrow(/must be a publishable key/)
  })

  it('rejects a secret key, even with surrounding spaces', () => {
    expect(() =>
      readSupabaseEnv({
        VITE_SUPABASE_URL: URL,
        VITE_SUPABASE_PUBLISHABLE_KEY: '  sb_secret_fake  ',
      }),
    ).toThrow(/must be a publishable key/)
  })

  it('never echoes the offending values in error messages', () => {
    const badKey = 'sb_secret_DO_NOT_ECHO_ME'
    const badUrl = 'ftp://do-not-echo.example'
    const keyMessage = errorOf(() =>
      readSupabaseEnv({ VITE_SUPABASE_URL: URL, VITE_SUPABASE_PUBLISHABLE_KEY: badKey }),
    )
    const urlMessage = errorOf(() =>
      readSupabaseEnv({ VITE_SUPABASE_URL: badUrl, VITE_SUPABASE_PUBLISHABLE_KEY: KEY }),
    )
    expect(keyMessage).not.toContain('DO_NOT_ECHO_ME')
    expect(urlMessage).not.toContain('do-not-echo')
    expect(urlMessage).not.toContain(KEY)
  })
})

describe('assertBuildEnv', () => {
  it('fails a production build with no env', () => {
    expect(() => assertBuildEnv('build', 'production', {})).toThrow(/Missing Supabase/)
  })

  it('fails a production build with a secret key', () => {
    expect(() =>
      assertBuildEnv('build', 'production', {
        VITE_SUPABASE_URL: URL,
        VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_fake',
      }),
    ).toThrow(/must be a publishable key/)
  })

  it('passes a production build with valid env', () => {
    expect(() =>
      assertBuildEnv('build', 'production', {
        VITE_SUPABASE_URL: URL,
        VITE_SUPABASE_PUBLISHABLE_KEY: KEY,
      }),
    ).not.toThrow()
  })

  it('does not check the dev server or test mode', () => {
    expect(() => assertBuildEnv('serve', 'development', {})).not.toThrow()
    expect(() => assertBuildEnv('serve', 'test', {})).not.toThrow()
  })
})
