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
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs, parseEnv } from 'node:util'
import { createClient } from '@supabase/supabase-js'

const DEFAULT_NAME = 'Manel'
const MIN_PASSWORD_LENGTH = 8
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const USAGE = `Usage: node scripts/create-admin.mjs --env <file> --email <email> [options]

  --env <file>        git-ignored env file with SUPABASE_URL and SUPABASE_SECRET_KEY
  --email <email>     the admin's login email
  --name <name>       profile to link (default: ${DEFAULT_NAME})
  --colour <#rrggbb>  colour, only used if the profile has to be created
  --reset-password    set a new password on an existing login
  --help              show this help

The password is asked for on a hidden prompt (an interactive terminal is required).`

/** A user-facing failure: printed without a stack trace. */
export class BootstrapError extends Error {}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested)
// ---------------------------------------------------------------------------

/**
 * @param {string[]} argv
 * @returns {{ help: true } | { help: false, envFile: string, email: string, name: string, colour: string | null, resetPassword: boolean }}
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
  return {
    help: false,
    envFile: values.env,
    email,
    name,
    colour,
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
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new BootstrapError('SUPABASE_URL must be an http(s) URL.')
  }
  if (secretKey.startsWith('sb_publishable_')) {
    throw new BootstrapError(
      'SUPABASE_SECRET_KEY is a publishable key; this script needs the secret key.',
    )
  }
  if (!secretKey.startsWith('sb_secret_') && !secretKey.startsWith('eyJ')) {
    throw new BootstrapError('SUPABASE_SECRET_KEY does not look like a Supabase secret key.')
  }
  return { url: parsed.origin, secretKey, isLocal: isLocalHost(parsed.hostname) }
}

/** @param {string} hostname */
export function isLocalHost(hostname) {
  return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname)
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

/** @param {string} value */
function escapeLike(value) {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`)
}

/**
 * Creates or finds the login and links it to the named profile as admin.
 *
 * @param {{
 *   client: Client,
 *   email: string,
 *   name?: string,
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
  colour = null,
  resetPassword = false,
  getPassword,
  log = () => {},
}) {
  // 1. Look before touching anything, so refusals change nothing.
  const { data: candidates, error: profileError } = await client
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .ilike('display_name', escapeLike(name.trim()))
  if (profileError) throw new BootstrapError(`Could not read profiles: ${profileError.message}`)
  /** @type {ProfileRow | null} */
  const target = /** @type {ProfileRow[]} */ (candidates ?? [])[0] ?? null

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
      await client.auth.admin.deleteUser(user.id)
      log('Removed the new login again because linking failed.')
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

/**
 * Reads a line from the terminal without echoing it.
 * @param {string} question
 * @returns {Promise<string>}
 */
export function promptHidden(question) {
  const { stdin, stderr } = process
  if (!stdin.isTTY) {
    return Promise.reject(
      new BootstrapError('The password prompt needs an interactive terminal (stdin is not a TTY).'),
    )
  }
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
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n' || ch === '\u0004') {
          cleanup()
          resolve(value)
          return
        }
        if (ch === '\u0003') {
          cleanup()
          reject(new BootstrapError('Cancelled.'))
          return
        }
        if (ch === '\u007f' || ch === '\b') {
          value = Array.from(value).slice(0, -1).join('')
        } else if (ch >= ' ') {
          value += ch
        }
      }
    }
    stderr.write(question)
    stdin.setRawMode(true)
    stdin.setEncoding('utf8')
    stdin.resume()
    stdin.on('data', onData)
  })
}

/**
 * @param {string} question
 * @returns {Promise<string>}
 */
async function promptVisible(question) {
  const { createInterface } = await import('node:readline/promises')
  const rl = createInterface({ input: process.stdin, output: process.stderr })
  try {
    return (await rl.question(question)).trim()
  } finally {
    rl.close()
  }
}

/**
 * Refuses an env file inside the repo that git would commit.
 * @param {string} file
 */
function assertEnvFileIgnored(file) {
  const absolute = path.resolve(file)
  const relative = path.relative(REPO_ROOT, absolute)
  if (relative.startsWith('..') || path.isAbsolute(relative)) return
  try {
    execFileSync('git', ['check-ignore', '--quiet', '--', relative], {
      cwd: REPO_ROOT,
      stdio: 'ignore',
    })
  } catch (error) {
    if (/** @type {{ status?: number }} */ (error).status === 1) {
      throw new BootstrapError(
        `${relative} is inside the repository and not git-ignored. Use a file ending in .local or under a git-ignored folder.`,
      )
    }
  }
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2))
  if (args.help) {
    console.log(USAGE)
    return
  }

  assertEnvFileIgnored(args.envFile)
  let envText
  try {
    envText = readFileSync(args.envFile, 'utf8')
  } catch {
    throw new BootstrapError(`Could not read the env file ${args.envFile}.`)
  }
  const env = readAdminEnv(envText)
  const host = new URL(env.url).host

  console.log(`Target: ${host}${env.isLocal ? ' (local stack)' : ''}`)
  if (!env.isLocal) {
    // Production is an owner gate: make the target explicit.
    const typed = await promptVisible(`This is NOT a local stack. Type "${host}" to continue: `)
    if (typed !== host) throw new BootstrapError('Cancelled; nothing was changed.')
  }

  const client = createClient(env.url, env.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })

  await bootstrapAdmin({
    client,
    email: args.email,
    name: args.name,
    colour: args.colour,
    resetPassword: args.resetPassword,
    log: (line) => console.log(line),
    async getPassword(isNewUser) {
      const password = await promptHidden(
        isNewUser
          ? `Password for the new login ${args.email}: `
          : `New password for ${args.email}: `,
      )
      const again = await promptHidden('Repeat the password: ')
      if (password !== again) throw new BootstrapError('The passwords do not match.')
      return password
    },
  })
  console.log('Done.')
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
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
