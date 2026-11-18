#!/usr/bin/env node
// Admin bootstrap: creates (or finds) Manel's login and links it to his
// profile as admin. Run it on your own machine; see README "Admin bootstrap".
//
//   node scripts/create-admin.mjs --env <path/to/ignored.env> --email <email>
//
// The env file holds SUPABASE_URL and SUPABASE_SECRET_KEY. The secret key
// bypasses RLS, so it is only ever read from that (git-ignored) file and is
// never printed. The password is asked for on a hidden prompt: it is never a
// command-line argument and never logged.
//
// Idempotent: running it again changes nothing (pass --reset-password to set
// a new password on an existing login). It refuses to link a profile that is
// already claimed by a different login.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs, parseEnv } from 'node:util'
import { createClient } from '@supabase/supabase-js'

const DEFAULT_NAME = 'Manel'
const MIN_PASSWORD_LENGTH = 8

const USAGE = `Usage: node scripts/create-admin.mjs --env <file> --email <email> [options]

  --env <file>        git-ignored env file with SUPABASE_URL and SUPABASE_SECRET_KEY
  --email <email>     the admin's login email
  --name <name>       profile to link (default: ${DEFAULT_NAME}; exact name, case-insensitive)
  --create-profile    create the profile if there is none with that name yet
  --colour <#rrggbb>  colour, only used with --create-profile
  --reset-password    set a new password on an existing login
  --help              show this help

The password is asked for on a hidden prompt (an interactive terminal is required).`

/** A user-facing failure: printed without a stack trace. */
export class BootstrapError extends Error {}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested)
// ---------------------------------------------------------------------------

/**
 * @typedef {{
 *   help: false, envFile: string, email: string, name: string,
 *   colour: string | null, createProfile: boolean, resetPassword: boolean,
 * }} CliArgs
 */

/**
 * @param {string[]} argv
 * @returns {{ help: true } | CliArgs}
 */
export function parseCliArgs(argv) {
  let values
  try {
    ;({ values } = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: false,
      options: {
        env: { type: 'string' },
        email: { type: 'string' },
        name: { type: 'string', default: DEFAULT_NAME },
        colour: { type: 'string' },
        'create-profile': { type: 'boolean', default: false },
        'reset-password': { type: 'boolean', default: false },
        password: { type: 'string' },
        help: { type: 'boolean', default: false },
      },
    }))
  } catch (error) {
    throw new BootstrapError(`${/** @type {Error} */ (error).message}\n\n${USAGE}`)
  }
  if (values.password !== undefined) {
    throw new BootstrapError(
      'Never pass the password as an argument (it would end up in your shell history). ' +
        'The script asks for it on a hidden prompt.',
    )
  }
  if (values.help) return { help: true }
  if (!values.env) throw new BootstrapError(`Missing --env <file>.\n\n${USAGE}`)
  const email = values.email?.trim().toLowerCase()
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new BootstrapError(`Missing or invalid --email.\n\n${USAGE}`)
  }
  const name = values.name.trim()
  if (name.length < 1 || name.length > 50) {
    throw new BootstrapError('--name must be 1 to 50 characters.')
  }
  const colour = values.colour?.trim().toLowerCase() ?? null
  if (colour !== null && !/^#[0-9a-f]{6}$/.test(colour)) {
    throw new BootstrapError('--colour must look like #rrggbb.')
  }
  if (colour !== null && !values['create-profile']) {
    throw new BootstrapError('--colour is only used together with --create-profile.')
  }
  return {
    help: false,
    envFile: values.env,
    email,
    name,
    colour,
    createProfile: values['create-profile'],
    resetPassword: values['reset-password'],
  }
}

/**
 * Reads SUPABASE_URL and SUPABASE_SECRET_KEY from env-file text. Error
 * messages name the variable but never echo a value.
 * @param {string} text
 */
export function readAdminEnv(text) {
  const env = parseEnv(text)
  const url = env.SUPABASE_URL?.trim() ?? ''
  const secretKey = env.SUPABASE_SECRET_KEY?.trim() ?? ''
  const missing = []
  if (!url) missing.push('SUPABASE_URL')
  if (!secretKey) missing.push('SUPABASE_SECRET_KEY')
  if (missing.length) throw new BootstrapError(`The env file is missing ${missing.join(' and ')}.`)

  let parsed
  try {
    parsed = new URL(url)
  } catch {
    throw new BootstrapError('SUPABASE_URL is not a valid URL.')
  }
  const isLocal = isLocalHost(parsed.hostname)
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLocal)) {
    throw new BootstrapError(
      'SUPABASE_URL must be https (plain http is only allowed for a local stack).',
    )
  }
  if (secretKey.startsWith('sb_publishable_')) {
    throw new BootstrapError(
      'SUPABASE_SECRET_KEY is a publishable key; this script needs the secret key.',
    )
  }
  if (!secretKey.startsWith('sb_secret_') && !secretKey.startsWith('eyJ')) {
    throw new BootstrapError('SUPABASE_SECRET_KEY does not look like a Supabase secret key.')
  }
  return { url: parsed.origin, secretKey, isLocal }
}

/**
 * @param {string} hostname  as given by URL#hostname (IPv6 keeps its brackets)
 */
export function isLocalHost(hostname) {
  return ['localhost', '127.0.0.1', '[::1]'].includes(hostname)
}

/**
 * Same rule as the database's unique index: lower(btrim(display_name)).
 * @param {string} name
 */
function normaliseName(name) {
  return name.trim().toLowerCase()
}

/**
 * True when `child` is `parent` itself or inside it (`..env` is inside).
 * @param {string} parent
 * @param {string} child
 */
export function isInside(parent, child) {
  const relative = path.relative(parent, child)
  if (relative === '') return true
  if (relative === '..' || relative.startsWith(`..${path.sep}`)) return false
  return !path.isAbsolute(relative)
}

// ---------------------------------------------------------------------------
// Env file safety: never read secrets from a file git would commit.
// ---------------------------------------------------------------------------

/**
 * @typedef {(args: string[], cwd: string) => { status: number, stdout: string }} RunGit
 * @type {RunGit}
 */
function runGit(args, cwd) {
  try {
    const stdout = execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return { status: 0, stdout }
  } catch (error) {
    const { status } = /** @type {{ status?: number | null }} */ (error)
    // status is null/undefined when git couldn't be run at all (e.g. not installed).
    return { status: typeof status === 'number' ? status : -1, stdout: '' }
  }
}

/** @param {string} dir */
function nearestGitDir(dir) {
  for (let current = dir; ; current = path.dirname(current)) {
    if (existsSync(path.join(current, '.git'))) return current
    if (path.dirname(current) === current) return null
  }
}

/**
 * Refuses an env file that git would commit. Symlinks are resolved first.
 * Fails closed: if the file is inside a git working tree (any `.git` above
 * it, including a worktree's), git must positively confirm that the file is
 * ignored by the repository that actually contains it. A file outside every
 * repository is fine (that's the recommended place).
 *
 * @param {string} file
 * @param {RunGit} [git]
 * @returns {string} the resolved path to read
 */
export function assertEnvFileIgnored(file, git = runGit) {
  let real
  try {
    real = realpathSync(file)
  } catch {
    throw new BootstrapError(`Could not read the env file ${file}.`)
  }
  const dir = path.dirname(real)
  if (!nearestGitDir(dir)) return real

  const top = git(['rev-parse', '--show-toplevel'], dir)
  if (top.status !== 0 || !top.stdout.trim()) {
    throw new BootstrapError(
      `${file} is inside a git working tree, but git could not check it. ` +
        'Move the env file outside the repository.',
    )
  }
  const root = realpathSync(top.stdout.trim())
  if (!isInside(root, real)) {
    throw new BootstrapError(`Could not work out which repository contains ${file}.`)
  }
  // Without --no-index: a tracked file is never "ignored", so it is refused.
  const check = git(['check-ignore', '--quiet', '--', path.relative(root, real)], root)
  if (check.status === 0) return real
  if (check.status === 1) {
    throw new BootstrapError(
      `${file} is inside the repository and not git-ignored. ` +
        'Use a file ending in .local, or keep it outside the repository.',
    )
  }
  throw new BootstrapError(
    `git could not check whether ${file} is ignored. Move the env file outside the repository.`,
  )
}

// ---------------------------------------------------------------------------
// The bootstrap itself (integration-tested against the local stack)
// ---------------------------------------------------------------------------

/**
 * @typedef {import('@supabase/supabase-js').SupabaseClient} Client
 * @typedef {{ id: string, display_name: string, role: string, is_system: boolean, auth_user_id: string | null }} ProfileRow
 * @typedef {{
 *   userId: string,
 *   userAction: 'created' | 'found' | 'found-password-reset',
 *   profileId: string,
 *   profileAction: 'linked' | 'created' | 'already-linked',
 * }} BootstrapResult
 */

const PROFILE_COLUMNS = 'id, display_name, role, is_system, auth_user_id'

/**
 * @param {Client} client  a client created with the SECRET key
 * @param {string} email
 */
export async function findUserByEmail(client, email) {
  const wanted = email.toLowerCase()
  for (let page = 1; ; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw new BootstrapError(`Could not list logins: ${error.message}`)
    const match = data.users.find((u) => u.email?.toLowerCase() === wanted)
    if (match) return match
    if (data.users.length < 200) return null
  }
}

/**
 * The profile whose name equals `name` ignoring case and surrounding spaces.
 * Compared in JavaScript (the club has a few dozen profiles), so no
 * characters in the name act as wildcards. More than one match is refused.
 *
 * @param {Pick<Client, 'from'>} client
 * @param {string} name
 * @returns {Promise<ProfileRow | null>}
 */
export async function findProfileByName(client, name) {
  const { data, error } = await client.from('profiles').select(PROFILE_COLUMNS)
  if (error) throw new BootstrapError(`Could not read profiles: ${error.message}`)
  const wanted = normaliseName(name)
  const matches = /** @type {ProfileRow[]} */ (data ?? []).filter(
    (p) => normaliseName(p.display_name) === wanted,
  )
  if (matches.length > 1) {
    throw new BootstrapError(
      `More than one profile is named "${name}". Nothing was changed; fix the names first.`,
    )
  }
  return matches[0] ?? null
}

/**
 * Creates or finds the login and links it to the named profile as admin.
 *
 * @param {{
 *   client: Client,
 *   email: string,
 *   name?: string,
 *   createProfile?: boolean,
 *   colour?: string | null,
 *   resetPassword?: boolean,
 *   getPassword: (isNewUser: boolean) => Promise<string>,
 *   log?: (line: string) => void,
 * }} options
 * @returns {Promise<BootstrapResult>}
 */
export async function bootstrapAdmin({
  client,
  email,
  name = DEFAULT_NAME,
  createProfile = false,
  colour = null,
  resetPassword = false,
  getPassword,
  log = () => {},
}) {
  // 1. Look before touching anything, so refusals change nothing.
  const target = await findProfileByName(client, name)

  if (!target && !createProfile) {
    throw new BootstrapError(
      `No profile named "${name}"; pass --create-profile to create one. Nothing was changed.`,
    )
  }
  if (target?.is_system) {
    throw new BootstrapError(`"${target.display_name}" is a system profile and can't log in.`)
  }

  let user = await findUserByEmail(client, email)

  if (target?.auth_user_id && target.auth_user_id !== user?.id) {
    throw new BootstrapError(
      `"${target.display_name}" is already claimed by a different login. Nothing was changed.`,
    )
  }

  if (user) {
    const { data: linked, error } = await client
      .from('profiles')
      .select(PROFILE_COLUMNS)
      .eq('auth_user_id', user.id)
      .maybeSingle()
    if (error) throw new BootstrapError(`Could not read profiles: ${error.message}`)
    if (linked && linked.id !== target?.id) {
      throw new BootstrapError(
        `${email} is already linked to another profile ("${linked.display_name}"). Nothing was changed.`,
      )
    }
  }

  // 2. The login.
  /** @type {BootstrapResult['userAction']} */
  let userAction
  if (!user) {
    const password = await getPassword(true)
    assertPassword(password)
    const { data, error } = await client.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })
    if (error || !data.user) {
      throw new BootstrapError(
        `Could not create the login: ${error?.message ?? 'no user returned'}`,
      )
    }
    user = data.user
    userAction = 'created'
    log(`Created the login ${email} (email confirmed).`)
  } else {
    /** @type {{ email_confirm?: boolean, password?: string }} */
    const changes = {}
    if (!user.email_confirmed_at) changes.email_confirm = true
    if (resetPassword) {
      const password = await getPassword(false)
      assertPassword(password)
      changes.password = password
    }
    if (Object.keys(changes).length) {
      const { error } = await client.auth.admin.updateUserById(user.id, changes)
      if (error) throw new BootstrapError(`Could not update the login: ${error.message}`)
    }
    userAction = resetPassword ? 'found-password-reset' : 'found'
    log(
      `Found the existing login ${email}` +
        (changes.email_confirm ? ' (email now confirmed)' : '') +
        (resetPassword ? '; password changed.' : '; password unchanged.'),
    )
  }

  // 3. The profile. If this fails for a login we just created, remove the
  // login again so a re-run starts clean.
  try {
    const profile = await linkProfile(client, { target, userId: user.id, name, colour })
    log(
      {
        linked: `Linked it to the profile "${profile.display_name}" as admin.`,
        created: `Created the admin profile "${profile.display_name}" and linked it.`,
        'already-linked': `Already linked to "${profile.display_name}" as admin. Nothing to do.`,
      }[profile.action],
    )
    return { userId: user.id, userAction, profileId: profile.id, profileAction: profile.action }
  } catch (error) {
    if (userAction === 'created') {
      const { error: deleteError } = await client.auth.admin.deleteUser(user.id)
      if (deleteError) {
        log(
          `WARNING: the new login ${email} was left over (removing it failed: ${deleteError.message}). ` +
            'Delete it by hand in the Supabase dashboard (Authentication > Users) before running this again.',
        )
      } else {
        log('Removed the new login again because linking failed.')
      }
    }
    throw error
  }
}

/**
 * @param {Client} client
 * @param {{ target: ProfileRow | null, userId: string, name: string, colour: string | null }} args
 * @returns {Promise<{ id: string, display_name: string, action: BootstrapResult['profileAction'] }>}
 */
async function linkProfile(client, { target, userId, name, colour }) {
  if (target?.auth_user_id === userId) {
    if (target.role !== 'admin') {
      const { error } = await client.from('profiles').update({ role: 'admin' }).eq('id', target.id)
      if (error) throw new BootstrapError(`Could not make the profile admin: ${error.message}`)
      return { id: target.id, display_name: target.display_name, action: 'linked' }
    }
    return { id: target.id, display_name: target.display_name, action: 'already-linked' }
  }

  if (target) {
    // Only claims it if it is still unclaimed (guards against a concurrent claim).
    const { data, error } = await client
      .from('profiles')
      .update({ auth_user_id: userId, claimed_at: new Date().toISOString(), role: 'admin' })
      .eq('id', target.id)
      .is('auth_user_id', null)
      .select('id, display_name')
    if (error) throw new BootstrapError(`Could not link the profile: ${error.message}`)
    if (!data?.length) {
      throw new BootstrapError(`"${target.display_name}" was claimed by someone else meanwhile.`)
    }
    return { ...data[0], action: 'linked' }
  }

  const { data, error } = await client
    .from('profiles')
    .insert({
      display_name: name,
      colour,
      role: 'admin',
      auth_user_id: userId,
      claimed_at: new Date().toISOString(),
    })
    .select('id, display_name')
    .single()
  if (error) throw new BootstrapError(`Could not create the profile: ${error.message}`)
  return { ...data, action: 'created' }
}

/** @param {string} password */
function assertPassword(password) {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new BootstrapError(`The password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
  }
}

// ---------------------------------------------------------------------------
// Terminal I/O
// ---------------------------------------------------------------------------

// Terminal escape sequences: CSI (arrows, bracketed-paste markers, ...),
// SS3 (some function keys), and any other ESC + one character.
// eslint-disable-next-line no-control-regex
const ESCAPE_SEQUENCE = /\u001b(?:\[[0-?]*[ -/]*[@-~]|O.|[^[O])?/gs

/**
 * Feeds one chunk of raw-mode terminal input into a hidden-input state.
 * Escape sequences are dropped, backspace deletes, Enter finishes (anything
 * after it in the same pasted chunk is ignored), Ctrl+C cancels.
 *
 * @param {string} value  what has been typed so far
 * @param {string} chunk
 * @returns {{ value: string, done: boolean, cancelled: boolean }}
 */
export function feedHiddenInput(value, chunk) {
  let current = value
  for (const ch of chunk.replace(ESCAPE_SEQUENCE, '')) {
    if (ch === '\r' || ch === '\n' || ch === '\u0004')
      return { value: current, done: true, cancelled: false }
    if (ch === '\u0003') return { value: '', done: true, cancelled: true }
    if (ch === '\u007f' || ch === '\b') {
      current = Array.from(current).slice(0, -1).join('')
    } else if (ch >= ' ') {
      current += ch
    }
  }
  return { value: current, done: false, cancelled: false }
}

/**
 * @typedef {{
 *   isTTY: boolean,
 *   promptHidden: (question: string) => Promise<string>,
 *   promptLine: (question: string) => Promise<string>,
 *   out: (line: string) => void,
 *   createClient: (url: string, key: string) => Client,
 *   runGit?: RunGit,
 * }} Io
 */

/** @returns {Io} */
function processIo() {
  const { stdin, stderr } = process
  return {
    isTTY: Boolean(stdin.isTTY),
    out: (line) => console.log(line),
    promptHidden(question) {
      return new Promise((resolve, reject) => {
        let value = ''
        const cleanup = () => {
          stdin.off('data', onData)
          stdin.setRawMode(false)
          stdin.pause()
          stderr.write('\n')
        }
        /** @param {string} chunk */
        const onData = (chunk) => {
          const next = feedHiddenInput(value, chunk)
          value = next.value
          if (!next.done) return
          cleanup()
          if (next.cancelled) reject(new BootstrapError('Cancelled.'))
          else resolve(value)
        }
        stderr.write(question)
        stdin.setRawMode(true)
        stdin.setEncoding('utf8')
        stdin.resume()
        stdin.on('data', onData)
      })
    },
    async promptLine(question) {
      const { createInterface } = await import('node:readline/promises')
      const rl = createInterface({ input: stdin, output: stderr })
      try {
        return (await rl.question(question)).trim()
      } finally {
        rl.close()
      }
    },
    createClient: (url, key) =>
      createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      }),
  }
}

/**
 * The command line. Exported (with injectable I/O) so the interactive paths
 * can be tested with a fake terminal.
 *
 * @param {string[]} argv
 * @param {Io} [io]
 */
export async function main(argv, io = processIo()) {
  const args = parseCliArgs(argv)
  if (args.help) {
    io.out(USAGE)
    return
  }
  if (!io.isTTY) {
    throw new BootstrapError(
      'Run this in an interactive terminal: it asks for confirmation and the password ' +
        '(stdin is not a TTY).',
    )
  }

  const envPath = assertEnvFileIgnored(args.envFile, io.runGit)
  let envText
  try {
    envText = readFileSync(envPath, 'utf8')
  } catch {
    throw new BootstrapError(`Could not read the env file ${args.envFile}.`)
  }
  const env = readAdminEnv(envText)
  const host = new URL(env.url).host

  io.out(`Target: ${host}${env.isLocal ? ' (local stack)' : ''}`)
  if (!env.isLocal) {
    // Production is an owner gate: make the target explicit.
    const typed = await io.promptLine(`This is NOT a local stack. Type "${host}" to continue: `)
    if (typed !== host) throw new BootstrapError('Cancelled; nothing was changed.')
  }

  await bootstrapAdmin({
    client: io.createClient(env.url, env.secretKey),
    email: args.email,
    name: args.name,
    createProfile: args.createProfile,
    colour: args.colour,
    resetPassword: args.resetPassword,
    log: io.out,
    async getPassword(isNewUser) {
      const password = await io.promptHidden(
        isNewUser
          ? `Password for the new login ${args.email}: `
          : `New password for ${args.email}: `,
      )
      const again = await io.promptHidden('Repeat the password: ')
      if (password !== again) throw new BootstrapError('The passwords do not match.')
      return password
    },
  })
  io.out('Done.')
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    if (error instanceof BootstrapError) {
      console.error(`Error: ${error.message}`)
    } else {
      // Unexpected: show the message only (no request details that could
      // include headers).
      console.error(`Unexpected error: ${error instanceof Error ? error.message : String(error)}`)
    }
    process.exitCode = 1
  })
}
