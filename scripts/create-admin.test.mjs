// @vitest-environment node
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it, vi } from 'vitest'
import {
  assertEnvFileIgnored,
  bootstrapAdmin,
  BootstrapError,
  feedHiddenInput,
  findProfileByName,
  isInside,
  isLocalHost,
  main,
  parseCliArgs,
  readAdminEnv,
} from './create-admin.mjs'

const SCRIPT = fileURLToPath(new URL('./create-admin.mjs', import.meta.url))
const FAKE_SECRET = 'sb_secret_' + 'x'.repeat(8)
const LOCAL_ENV = `SUPABASE_URL=http://127.0.0.1:54321\nSUPABASE_SECRET_KEY=${FAKE_SECRET}\n`
const REMOTE_ENV = `SUPABASE_URL=https://example.supabase.co\nSUPABASE_SECRET_KEY=${FAKE_SECRET}\n`

/** @param {() => unknown} fn */
function messageOf(fn) {
  try {
    fn()
  } catch (error) {
    return /** @type {Error} */ (error).message
  }
  throw new Error('expected an error')
}

// ---------------------------------------------------------------- temp dirs

const scratch = realpathSync(mkdtempSync(path.join(tmpdir(), 'create-admin-test-')))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

/** @param {string} cwd @param {string[]} args */
function git(cwd, ...args) {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}

/** A throwaway repository that ignores `*.local`, with one tracked file. */
function makeRepo(name = 'repo') {
  const root = path.join(scratch, name)
  mkdirSync(root)
  git(root, 'init', '-q')
  git(root, 'config', 'user.email', 'test@example.test')
  git(root, 'config', 'user.name', 'Test')
  writeFileSync(path.join(root, '.gitignore'), '*.local\n')
  writeFileSync(path.join(root, 'tracked.local'), LOCAL_ENV)
  git(root, 'add', '-f', '.gitignore', 'tracked.local')
  git(root, 'commit', '-qm', 'init')
  return root
}

/** @param {string} file @param {string} [text] */
function write(file, text = LOCAL_ENV) {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, text)
  return file
}

// ---------------------------------------------------------------- fakes

/**
 * A fake terminal for main(). Prompts are answered from the given queues.
 * @param {{ isTTY?: boolean, lines?: string[], hidden?: string[], client?: unknown }} [options]
 */
function fakeIo({ isTTY = true, lines = [], hidden = [], client } = {}) {
  /** @type {string[]} */
  const output = []
  const io = {
    isTTY,
    out: (/** @type {string} */ line) => output.push(line),
    promptLine: vi.fn(async (/** @type {string} */ q) => {
      output.push(q)
      return lines.shift() ?? ''
    }),
    promptHidden: vi.fn(async (/** @type {string} */ q) => {
      output.push(q)
      return hidden.shift() ?? ''
    }),
    createClient: vi.fn(() => {
      if (!client) throw new Error('createClient should not have been called')
      return client
    }),
  }
  return { io: /** @type {any} */ (io), output }
}

/**
 * Minimal stand-in for the supabase-js calls the bootstrap makes.
 * @param {{ profiles?: object[], users?: object[], insertError?: object, deleteError?: object }} [options]
 */
function fakeClient({ profiles = [], users = [], insertError, deleteError } = {}) {
  const calls = { createUser: 0, deleteUser: 0, insert: 0 }
  const result = (/** @type {unknown} */ data, /** @type {unknown} */ error = null) =>
    Promise.resolve({ data, error })
  const client = {
    from: () => ({
      select: () => {
        const all = result(profiles)
        return Object.assign(all, {
          eq: () => ({ maybeSingle: () => result(null) }),
        })
      },
      insert: () => {
        calls.insert += 1
        return {
          select: () => ({
            single: () =>
              insertError ? result(null, insertError) : result({ id: 'p-new', display_name: 'X' }),
          }),
        }
      },
    }),
    auth: {
      admin: {
        listUsers: () => result({ users }),
        createUser: (/** @type {{ email: string }} */ { email }) => {
          calls.createUser += 1
          return result({ user: { id: 'u-new', email } })
        },
        deleteUser: () => {
          calls.deleteUser += 1
          return result(null, deleteError ?? null)
        },
      },
    },
  }
  return { client: /** @type {any} */ (client), calls }
}

// ---------------------------------------------------------------- parsing

describe('parseCliArgs', () => {
  it('reads the env file, email (lower-cased) and defaults the name to Manel', () => {
    expect(parseCliArgs(['--env', 'a.env', '--email', ' Manel@Example.TEST '])).toEqual({
      help: false,
      envFile: 'a.env',
      email: 'manel@example.test',
      name: 'Manel',
      colour: null,
      createProfile: false,
      resetPassword: false,
    })
  })

  it('accepts a name, --create-profile with a colour, and --reset-password', () => {
    expect(
      parseCliArgs([
        '--env=a.env',
        '--email=a@b.test',
        '--name',
        'Someone',
        '--create-profile',
        '--colour',
        '#ABCDEF',
        '--reset-password',
      ]),
    ).toMatchObject({
      name: 'Someone',
      colour: '#abcdef',
      createProfile: true,
      resetPassword: true,
    })
  })

  it('refuses a password argument without echoing it', () => {
    const message = messageOf(() =>
      parseCliArgs(['--env', 'a.env', '--email', 'a@b.test', '--password', 'hunter2-secret']),
    )
    expect(message).toMatch(/Never pass the password/)
    expect(message).not.toContain('hunter2-secret')
  })

  it.each([
    [['--email', 'a@b.test'], /Missing --env/],
    [['--env', 'a.env'], /invalid --email/],
    [['--env', 'a.env', '--email', 'not-an-email'], /invalid --email/],
    [['--env', 'a.env', '--email', 'a@b.test', '--create-profile', '--colour', 'red'], /#rrggbb/],
    [['--env', 'a.env', '--email', 'a@b.test', '--colour', '#aabbcc'], /--create-profile/],
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
    expect(readAdminEnv(`# comment\n${LOCAL_ENV}`)).toEqual({
      url: 'http://127.0.0.1:54321',
      secretKey: FAKE_SECRET,
      isLocal: true,
    })
  })

  it('accepts http on IPv6 localhost', () => {
    expect(
      readAdminEnv(`SUPABASE_URL=http://[::1]:54321\nSUPABASE_SECRET_KEY=${FAKE_SECRET}`).isLocal,
    ).toBe(true)
  })

  it('flags a hosted project as not local', () => {
    expect(readAdminEnv(REMOTE_ENV).isLocal).toBe(false)
  })

  it('refuses plain http for anything that is not local', () => {
    expect(() =>
      readAdminEnv(`SUPABASE_URL=http://example.supabase.co\nSUPABASE_SECRET_KEY=${FAKE_SECRET}`),
    ).toThrow(/must be https/)
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
    ].map((text) => messageOf(() => readAdminEnv(text)))
    expect(errors[0]).toMatch(/publishable key/)
    for (const message of errors) {
      expect(message).not.toContain('DONOTECHO')
      expect(message).not.toContain(FAKE_SECRET)
    }
  })
})

describe('isLocalHost / isInside', () => {
  it.each([
    ['127.0.0.1', true],
    ['localhost', true],
    ['[::1]', true],
    ['::1', false], // URL#hostname always brackets IPv6
    ['example.supabase.co', false],
  ])('isLocalHost(%s) is %s', (host, expected) => {
    expect(isLocalHost(host)).toBe(expected)
  })

  it.each([
    ['/r', '/r/a.env', true],
    ['/r', '/r/..env', true],
    ['/r', '/r/..', false],
    ['/r', '/x/a.env', false],
    ['/r', '/r', true],
    ['/r', '/rx/a.env', false],
  ])('isInside(%s, %s) is %s', (parent, child, expected) => {
    expect(isInside(parent, child)).toBe(expected)
  })
})

// ---------------------------------------------------------------- hidden prompt

describe('feedHiddenInput', () => {
  it('collects characters until Enter', () => {
    let state = feedHiddenInput('', 'abc')
    expect(state).toEqual({ value: 'abc', done: false, cancelled: false })
    state = feedHiddenInput(state.value, 'd\r')
    expect(state).toEqual({ value: 'abcd', done: true, cancelled: false })
  })

  it('drops arrow keys and other escape sequences', () => {
    expect(feedHiddenInput('', 'a\u001b[Db\u001b[1;5Cc\u001bOPd\u001bxe').value).toBe('abcde')
  })

  it('drops bracketed-paste markers but keeps the pasted text', () => {
    expect(feedHiddenInput('', '\u001b[200~pasted-pass\u001b[201~\r')).toEqual({
      value: 'pasted-pass',
      done: true,
      cancelled: false,
    })
  })

  it('stops at the first newline of a pasted chunk', () => {
    expect(feedHiddenInput('', 'line-one\nline-two\n')).toEqual({
      value: 'line-one',
      done: true,
      cancelled: false,
    })
  })

  it('handles backspace (including on multi-byte characters) and ignores control keys', () => {
    expect(feedHiddenInput('', 'ab\u007fc\bd\u0001é\u007f\r').value).toBe('ad')
  })

  it('cancels on Ctrl+C and forgets the input', () => {
    expect(feedHiddenInput('secret', 'x\u0003')).toEqual({ value: '', done: true, cancelled: true })
  })
})

// ---------------------------------------------------------------- env file

describe('assertEnvFileIgnored', () => {
  const repo = makeRepo()

  it('accepts an ignored file in the repository', () => {
    const file = write(path.join(repo, 'admin.env.local'))
    expect(assertEnvFileIgnored(file)).toBe(file)
  })

  it('accepts a file outside every repository', () => {
    const outside = write(path.join(scratch, 'outside', 'admin.env'))
    expect(assertEnvFileIgnored(outside)).toBe(outside)
  })

  it('refuses a file git would commit', () => {
    expect(() => assertEnvFileIgnored(write(path.join(repo, 'admin.env')))).toThrow(
      /not git-ignored/,
    )
  })

  it('refuses "..env" at the repository root (not mistaken for a parent path)', () => {
    expect(() => assertEnvFileIgnored(write(path.join(repo, '..env')))).toThrow(/not git-ignored/)
  })

  it('refuses a tracked file even if its name matches an ignore rule', () => {
    expect(() => assertEnvFileIgnored(path.join(repo, 'tracked.local'))).toThrow(/not git-ignored/)
  })

  it('resolves symlinks: an ignored name pointing at a committable file is refused', () => {
    const target = write(path.join(repo, 'real.env'))
    const link = path.join(repo, 'link.local')
    symlinkSync(target, link)
    expect(() => assertEnvFileIgnored(link)).toThrow(/not git-ignored/)
  })

  it('resolves symlinks: a link pointing outside the repository is fine', () => {
    const target = write(path.join(scratch, 'outside2', 'admin.env'))
    const link = path.join(repo, 'outside-link.env')
    symlinkSync(target, link)
    expect(assertEnvFileIgnored(link)).toBe(target)
  })

  it('checks the repository that contains the file (e.g. a worktree)', () => {
    const worktree = path.join(scratch, 'worktree')
    git(repo, 'worktree', 'add', '-q', worktree)
    expect(() => assertEnvFileIgnored(write(path.join(worktree, 'admin.env')))).toThrow(
      /not git-ignored/,
    )
    const ok = write(path.join(worktree, 'admin.env.local'))
    expect(assertEnvFileIgnored(ok)).toBe(ok)
  })

  it('fails closed when git cannot check (broken .git)', () => {
    const broken = path.join(scratch, 'broken')
    write(path.join(broken, '.git'), 'gitdir: /nonexistent/for/this/test\n')
    expect(() => assertEnvFileIgnored(write(path.join(broken, 'admin.env.local')))).toThrow(
      /git could not check/,
    )
  })

  it.each([
    ['git missing', -1],
    ['git error', 128],
  ])('fails closed when check-ignore reports %s', (_, status) => {
    const file = write(path.join(repo, 'failing.env.local'))
    const fakeGit = (/** @type {string[]} */ args) =>
      args[0] === 'rev-parse' ? { status: 0, stdout: `${repo}\n` } : { status, stdout: '' }
    expect(() => assertEnvFileIgnored(file, fakeGit)).toThrow(/git could not check/)
  })

  it('fails closed when git cannot even find the repository', () => {
    const file = write(path.join(repo, 'norepo.env.local'))
    expect(() => assertEnvFileIgnored(file, () => ({ status: -1, stdout: '' }))).toThrow(
      /git could not check/,
    )
  })

  it('refuses a missing file', () => {
    expect(() => assertEnvFileIgnored(path.join(scratch, 'nope.env'))).toThrow(
      /Could not read the env file/,
    )
  })
})

// ---------------------------------------------------------------- profile lookup

describe('findProfileByName', () => {
  const profiles = [
    { id: '1', display_name: 'Manel', role: 'member', is_system: false, auth_user_id: null },
    { id: '2', display_name: 'Orla', role: 'admin', is_system: false, auth_user_id: 'u' },
  ]

  it('matches exactly, ignoring case and spaces', async () => {
    const { client } = fakeClient({ profiles })
    expect((await findProfileByName(client, '  mANEL '))?.id).toBe('1')
  })

  it.each(['M%', 'M*', 'Man_l', '%', '*', 'Mane'])(
    'treats %j literally (no match)',
    async (name) => {
      const { client } = fakeClient({ profiles })
      expect(await findProfileByName(client, name)).toBeNull()
    },
  )

  it('refuses when more than one profile matches', async () => {
    const { client } = fakeClient({
      profiles: [...profiles, { ...profiles[0], id: '3', display_name: ' manel' }],
    })
    await expect(findProfileByName(client, 'Manel')).rejects.toThrow(/More than one profile/)
  })
})

// ---------------------------------------------------------------- rollback

describe('bootstrapAdmin rollback', () => {
  const getPassword = async () => 'long-enough-password'

  it('reports a login that could not be removed, and keeps the original error', async () => {
    const { client, calls } = fakeClient({
      insertError: { message: 'insert broke' },
      deleteError: { message: 'delete broke' },
    })
    /** @type {string[]} */
    const log = []
    await expect(
      bootstrapAdmin({
        client,
        email: 'a@example.test',
        name: 'New',
        createProfile: true,
        getPassword,
        log: (line) => log.push(line),
      }),
    ).rejects.toThrow(/Could not create the profile: insert broke/)
    expect(calls.deleteUser).toBe(1)
    expect(log.join('\n')).toMatch(/left over.*delete broke.*Delete it by hand/s)
  })

  it('says the login was removed when the rollback works', async () => {
    const { client } = fakeClient({ insertError: { message: 'insert broke' } })
    /** @type {string[]} */
    const log = []
    await expect(
      bootstrapAdmin({
        client,
        email: 'a@example.test',
        name: 'New',
        createProfile: true,
        getPassword,
        log: (line) => log.push(line),
      }),
    ).rejects.toThrow(/insert broke/)
    expect(log).toContain('Removed the new login again because linking failed.')
  })
})

// ---------------------------------------------------------------- main()

describe('main() with a fake terminal', () => {
  const localEnv = write(path.join(scratch, 'env', 'local.env'), LOCAL_ENV)
  const remoteEnv = write(path.join(scratch, 'env', 'remote.env'), REMOTE_ENV)
  const args = (/** @type {string} */ env, /** @type {string[]} */ ...more) => [
    '--env',
    env,
    '--email',
    'boss@example.test',
    ...more,
  ]

  it('refuses to run without an interactive terminal (piped stdin)', async () => {
    const { io } = fakeIo({ isTTY: false })
    await expect(main(args(remoteEnv), io)).rejects.toThrow(/interactive terminal/)
    expect(io.promptLine).not.toHaveBeenCalled()
    expect(io.createClient).not.toHaveBeenCalled()
  })

  it('cancels when the typed host does not match', async () => {
    const { io, output } = fakeIo({ lines: ['example.supabase.com'] })
    await expect(main(args(remoteEnv), io)).rejects.toThrow(/Cancelled; nothing was changed/)
    expect(output.join('\n')).toMatch(/NOT a local stack\. Type "example\.supabase\.co"/)
    expect(io.createClient).not.toHaveBeenCalled()
  })

  it('continues when the typed host matches', async () => {
    const { client } = fakeClient({
      profiles: [
        { id: '1', display_name: 'Manel', role: 'member', is_system: false, auth_user_id: null },
      ],
    })
    const { io } = fakeIo({ lines: ['example.supabase.co'], client })
    // The fake client can't link; reaching it is what this test checks.
    await expect(main(args(remoteEnv), io)).rejects.toThrow()
    expect(io.createClient).toHaveBeenCalledWith('https://example.supabase.co', FAKE_SECRET)
  })

  it('does not ask for confirmation on a local stack', async () => {
    const { client } = fakeClient()
    const { io } = fakeIo({ client })
    await expect(main(args(localEnv), io)).rejects.toThrow(/No profile named "Manel"/)
    expect(io.promptLine).not.toHaveBeenCalled()
  })

  it('refuses an env file git would commit before reading it', async () => {
    const repo = makeRepo('main-repo')
    const { io } = fakeIo()
    await expect(main(args(write(path.join(repo, 'admin.env'))), io)).rejects.toThrow(
      /not git-ignored/,
    )
    await expect(main(args(write(path.join(repo, '..env'))), io)).rejects.toThrow(/not git-ignored/)
    expect(io.createClient).not.toHaveBeenCalled()
  })

  it('treats --name wildcards literally and needs --create-profile for a new profile', async () => {
    const { client, calls } = fakeClient({
      profiles: [
        { id: '1', display_name: 'Manel', role: 'member', is_system: false, auth_user_id: null },
      ],
    })
    const { io } = fakeIo({ client })
    await expect(main(args(localEnv, '--name', 'M%'), io)).rejects.toThrow(
      /No profile named "M%"; pass --create-profile/,
    )
    await expect(main(args(localEnv, '--name', 'M*'), io)).rejects.toThrow(/No profile named/)
    expect(calls.createUser).toBe(0)
    expect(io.promptHidden).not.toHaveBeenCalled()
  })

  it('refuses an ambiguous --name', async () => {
    const row = { role: 'member', is_system: false, auth_user_id: null }
    const { client, calls } = fakeClient({
      profiles: [
        { ...row, id: '1', display_name: 'Manel' },
        { ...row, id: '2', display_name: 'MANEL ' },
      ],
    })
    const { io } = fakeIo({ client })
    await expect(main(args(localEnv), io)).rejects.toThrow(/More than one profile/)
    expect(calls.createUser).toBe(0)
  })

  it('creates the profile with --create-profile after asking for the password twice', async () => {
    const { client, calls } = fakeClient()
    const { io, output } = fakeIo({ client, hidden: ['long-enough-pw', 'long-enough-pw'] })
    await main(args(localEnv, '--name', 'Boss', '--create-profile'), io)
    expect(calls.createUser).toBe(1)
    expect(calls.insert).toBe(1)
    expect(io.promptHidden).toHaveBeenCalledTimes(2)
    expect(output).toContain('Done.')
    expect(output.join('\n')).not.toContain('long-enough-pw')
  })

  it('refuses mismatched passwords before creating anything', async () => {
    const { client, calls } = fakeClient()
    const { io } = fakeIo({ client, hidden: ['long-enough-pw', 'different-pw'] })
    await expect(main(args(localEnv, '--create-profile'), io)).rejects.toThrow(/do not match/)
    expect(calls.createUser).toBe(0)
  })
})

// ---------------------------------------------------------------- real terminal

const hasScript = spawnSync('script', ['--version'], { stdio: 'ignore' }).status === 0

// Always runs in CI (util-linux `script` is on the runners), so it can't be skipped silently there.
describe.runIf(hasScript || process.env.CI)(
  'the real CLI in a pseudo-terminal (script -qc)',
  () => {
    const remoteEnv = write(path.join(scratch, 'pty', 'remote.env'), REMOTE_ENV)
    const cli = `"${process.execPath}" "${SCRIPT}" --env "${remoteEnv}" --email boss@example.test`

    it('refuses piped stdin (no terminal)', () => {
      const run = spawnSync(process.execPath, [SCRIPT, '--env', remoteEnv, '--email', 'a@b.test'], {
        input: 'example.supabase.co\n',
        encoding: 'utf8',
      })
      expect(run.status).toBe(1)
      expect(run.stderr).toMatch(/interactive terminal/)
    })

    it('cancels when the typed host does not match', () => {
      const run = spawnSync('script', ['-qec', cli, '/dev/null'], {
        input: 'wrong.example\r',
        encoding: 'utf8',
        timeout: 20_000,
      })
      expect(run.stdout).toMatch(/NOT a local stack/)
      expect(run.stdout).toMatch(/Cancelled; nothing was changed/)
      expect(run.status).toBe(1)
    })
  },
)

describe('BootstrapError', () => {
  it('is an Error', () => {
    expect(new BootstrapError('x')).toBeInstanceOf(Error)
  })
})
