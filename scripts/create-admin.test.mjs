// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { BootstrapError, isLocalHost, parseCliArgs, readAdminEnv } from './create-admin.mjs'

const FAKE_SECRET = 'sb_secret_' + 'x'.repeat(8)

describe('parseCliArgs', () => {
  it('reads the env file, email (lower-cased) and defaults the name to Manel', () => {
    expect(parseCliArgs(['--env', 'a.env', '--email', ' Manel@Example.TEST '])).toEqual({
      help: false,
      envFile: 'a.env',
      email: 'manel@example.test',
      name: 'Manel',
      colour: null,
      resetPassword: false,
    })
  })

  it('accepts a name, colour and --reset-password', () => {
    expect(
      parseCliArgs([
        '--env=a.env',
        '--email=a@b.test',
        '--name',
        'Someone',
        '--colour',
        '#ABCDEF',
        '--reset-password',
      ]),
    ).toMatchObject({ name: 'Someone', colour: '#abcdef', resetPassword: true })
  })

  it('refuses a password argument without echoing it', () => {
    let message = ''
    try {
      parseCliArgs(['--env', 'a.env', '--email', 'a@b.test', '--password', 'hunter2-secret'])
    } catch (error) {
      expect(error).toBeInstanceOf(BootstrapError)
      message = /** @type {Error} */ (error).message
    }
    expect(message).toMatch(/Never pass the password/)
    expect(message).not.toContain('hunter2-secret')
  })

  it.each([
    [['--email', 'a@b.test'], /Missing --env/],
    [['--env', 'a.env'], /invalid --email/],
    [['--env', 'a.env', '--email', 'not-an-email'], /invalid --email/],
    [['--env', 'a.env', '--email', 'a@b.test', '--colour', 'red'], /#rrggbb/],
    [['--env', 'a.env', '--email', 'a@b.test', '--name', '  '], /1 to 50/],
    [['--env', 'a.env', '--email', 'a@b.test', 'stray'], /Unexpected argument/],
    [['--env', 'a.env', '--email', 'a@b.test', '--nope'], /Unknown option/],
  ])('rejects %j', (argv, message) => {
    expect(() => parseCliArgs(argv)).toThrow(message)
  })

  it('shows help', () => {
    expect(parseCliArgs(['--help'])).toEqual({ help: true })
  })
})

describe('readAdminEnv', () => {
  it('reads the URL and secret key', () => {
    expect(
      readAdminEnv(
        `# comment\nSUPABASE_URL="http://127.0.0.1:54321"\nSUPABASE_SECRET_KEY=${FAKE_SECRET}\n`,
      ),
    ).toEqual({ url: 'http://127.0.0.1:54321', secretKey: FAKE_SECRET, isLocal: true })
  })

  it('flags a hosted project as not local', () => {
    expect(
      readAdminEnv(`SUPABASE_URL=https://example.supabase.co\nSUPABASE_SECRET_KEY=${FAKE_SECRET}`)
        .isLocal,
    ).toBe(false)
  })

  it('names missing variables', () => {
    expect(() => readAdminEnv('')).toThrow(/SUPABASE_URL and SUPABASE_SECRET_KEY/)
    expect(() => readAdminEnv('SUPABASE_URL=http://localhost:54321')).toThrow(
      /missing SUPABASE_SECRET_KEY\./,
    )
  })

  it('refuses a publishable key and junk, without echoing values', () => {
    const errors = [
      'SUPABASE_URL=http://localhost\nSUPABASE_SECRET_KEY=sb_publishable_DONOTECHO',
      'SUPABASE_URL=http://localhost\nSUPABASE_SECRET_KEY=DONOTECHO',
      `SUPABASE_URL=ftp://DONOTECHO\nSUPABASE_SECRET_KEY=${FAKE_SECRET}`,
      `SUPABASE_URL=DONOTECHO\nSUPABASE_SECRET_KEY=${FAKE_SECRET}`,
    ].map((text) => {
      try {
        readAdminEnv(text)
      } catch (error) {
        return /** @type {Error} */ (error).message
      }
      throw new Error('expected an error')
    })
    expect(errors[0]).toMatch(/publishable key/)
    for (const message of errors) {
      expect(message).not.toContain('DONOTECHO')
      expect(message).not.toContain(FAKE_SECRET)
    }
  })
})

describe('isLocalHost', () => {
  it.each([
    ['127.0.0.1', true],
    ['localhost', true],
    ['example.supabase.co', false],
  ])('%s -> %s', (host, expected) => {
    expect(isLocalHost(host)).toBe(expected)
  })
})
