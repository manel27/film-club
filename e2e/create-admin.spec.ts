// Integration tests for scripts/create-admin.mjs against the LOCAL stack
// (no browser). Every test uses its own synthetic names and cleans up.
import { createClient } from '@supabase/supabase-js'
import { expect, test } from '@playwright/test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { bootstrapAdmin, findUserByEmail, main } from '../scripts/create-admin.mjs'
import { adminClient } from './fixtures'
import { localSupabase } from './localSupabase'

const PASSWORD = 'bootstrap-test-password'
const password = async () => PASSWORD

test.describe('admin bootstrap script', () => {
  const client = adminClient()
  const emails: string[] = []
  const names: string[] = []

  // Cleanup failures fail the test: leftovers would break later runs and pgTAP.
  test.afterEach(async () => {
    for (const email of emails.splice(0)) {
      const user = await findUserByEmail(client, email)
      if (user) {
        const { error } = await client.auth.admin.deleteUser(user.id)
        if (error) throw new Error(`cleanup: could not delete login ${email}: ${error.message}`)
      }
    }
    for (const name of names.splice(0)) {
      const { error } = await client.from('profiles').delete().eq('display_name', name)
      if (error) throw new Error(`cleanup: could not delete profile ${name}: ${error.message}`)
    }
  })

  async function profileByName(name: string) {
    const { data, error } = await client
      .from('profiles')
      .select('id, role, auth_user_id, is_claimed, claimed_at')
      .eq('display_name', name)
      .maybeSingle()
    if (error) throw error
    return data
  }

  test('creates the admin profile when it does not exist yet, then is a no-op', async () => {
    const email = 'boot-new@example.test'
    const name = 'Boot New'
    emails.push(email)
    names.push(name)

    const first = await bootstrapAdmin({
      client,
      email,
      name,
      createProfile: true,
      getPassword: password,
    })
    expect(first).toMatchObject({ userAction: 'created', profileAction: 'created' })
    const profile = await profileByName(name)
    expect(profile).toMatchObject({ role: 'admin', auth_user_id: first.userId, is_claimed: true })
    expect(profile?.claimed_at).not.toBeNull()

    const user = await findUserByEmail(client, email)
    expect(user?.email_confirmed_at).toBeTruthy()

    let asked = false
    const second = await bootstrapAdmin({
      client,
      email,
      name,
      getPassword: async () => {
        asked = true
        return PASSWORD
      },
    })
    expect(second).toEqual({
      userId: first.userId,
      userAction: 'found',
      profileId: first.profileId,
      profileAction: 'already-linked',
    })
    expect(asked).toBe(false)
  })

  test('links an existing unclaimed placeholder and makes it admin', async () => {
    const email = 'boot-link@example.test'
    const name = 'Boot Placeholder'
    emails.push(email)
    names.push(name)
    const { error } = await client
      .from('profiles')
      .insert({ display_name: name, colour: '#123456', role: 'member' })
    expect(error).toBeNull()

    const result = await bootstrapAdmin({ client, email, name, getPassword: password })
    expect(result).toMatchObject({ userAction: 'created', profileAction: 'linked' })
    expect(await profileByName(name)).toMatchObject({
      id: result.profileId,
      role: 'admin',
      auth_user_id: result.userId,
      is_claimed: true,
    })

    // The new login works with the chosen password.
    const { error: signInError } = await adminClient().auth.signInWithPassword({
      email,
      password: PASSWORD,
    })
    expect(signInError).toBeNull()
  })

  test('matches the profile name ignoring case', async () => {
    const email = 'boot-case@example.test'
    const name = 'Boot Case'
    emails.push(email)
    names.push(name)
    await client.from('profiles').insert({ display_name: name })
    const result = await bootstrapAdmin({
      client,
      email,
      name: 'boot case',
      getPassword: password,
    })
    expect(result.profileAction).toBe('linked')
  })

  test('refuses a profile already claimed by a different login, changing nothing', async () => {
    const email = 'boot-intruder@example.test'
    emails.push(email)
    await expect(
      bootstrapAdmin({ client, email, name: 'Orla', getPassword: password }),
    ).rejects.toThrow(/already claimed by a different login/)
    expect(await findUserByEmail(client, email)).toBeNull()
  })

  test('refuses a login that is already linked to another profile', async () => {
    const name = 'Boot Other'
    names.push(name)
    await expect(
      bootstrapAdmin({
        client,
        email: 'kwame@example.test',
        name,
        createProfile: true,
        getPassword: password,
      }),
    ).rejects.toThrow(/already linked to another profile/)
    expect(await profileByName(name)).toBeNull()
  })

  test('refuses system profiles', async () => {
    const email = 'boot-system@example.test'
    emails.push(email)
    await expect(
      bootstrapAdmin({ client, email, name: 'Cinema', getPassword: password }),
    ).rejects.toThrow(/system profile/)
    expect(await findUserByEmail(client, email)).toBeNull()
  })

  test('removes a newly created login again when linking fails', async () => {
    const email = 'boot-rollback@example.test'
    const name = 'Boot Rollback'
    emails.push(email)
    names.push(name)
    await expect(
      bootstrapAdmin({
        client,
        email,
        name,
        createProfile: true,
        colour: 'not-a-colour',
        getPassword: password,
      }),
    ).rejects.toThrow(/Could not create the profile/)
    expect(await findUserByEmail(client, email)).toBeNull()
    expect(await profileByName(name)).toBeNull()
  })

  test('only changes the password of an existing login when asked to', async () => {
    const email = 'boot-reset@example.test'
    const name = 'Boot Reset'
    emails.push(email)
    names.push(name)
    await bootstrapAdmin({ client, email, name, createProfile: true, getPassword: password })

    const result = await bootstrapAdmin({
      client,
      email,
      name,
      resetPassword: true,
      getPassword: async () => 'a-brand-new-password',
    })
    expect(result.userAction).toBe('found-password-reset')
    const { error } = await adminClient().auth.signInWithPassword({
      email,
      password: 'a-brand-new-password',
    })
    expect(error).toBeNull()
  })

  test('rejects short passwords', async () => {
    const email = 'boot-short@example.test'
    emails.push(email)
    names.push('Boot Short')
    await expect(
      bootstrapAdmin({
        client,
        email,
        name: 'Boot Short',
        createProfile: true,
        getPassword: async () => 'short',
      }),
    ).rejects.toThrow(/at least 8 characters/)
    expect(await findUserByEmail(client, email)).toBeNull()
  })

  test('refuses a missing profile unless --create-profile is given, creating nothing', async () => {
    const email = 'boot-missing@example.test'
    emails.push(email)
    await expect(
      bootstrapAdmin({ client, email, name: 'Boot Missing', getPassword: password }),
    ).rejects.toThrow(/No profile named "Boot Missing"; pass --create-profile/)
    expect(await findUserByEmail(client, email)).toBeNull()
  })

  test.describe('the command line (main) with a fake terminal', () => {
    let dir: string
    let envFile: string

    test.beforeAll(() => {
      // Outside the repository, as the README recommends.
      const { apiUrl, secretKey } = localSupabase()
      dir = mkdtempSync(path.join(tmpdir(), 'create-admin-e2e-'))
      envFile = path.join(dir, 'admin.env')
      writeFileSync(envFile, `SUPABASE_URL=${apiUrl}\nSUPABASE_SECRET_KEY=${secretKey}\n`)
    })
    test.afterAll(() => rmSync(dir, { recursive: true, force: true }))

    function terminal(hidden: string[] = []) {
      const output: string[] = []
      return {
        output,
        io: {
          isTTY: true,
          out: (line: string) => output.push(line),
          promptLine: async () => {
            throw new Error('a local stack must not ask for confirmation')
          },
          promptHidden: async () => hidden.shift() ?? '',
          createClient: (url: string, key: string) =>
            createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }),
        },
      }
    }

    test('treats wildcards in --name literally', async () => {
      const email = 'boot-wild@example.test'
      emails.push(email)
      for (const name of ['O%', 'Orl_', 'O*', '%']) {
        const { io } = terminal()
        await expect(
          main(['--env', envFile, '--email', email, '--name', name], io),
        ).rejects.toThrow(/No profile named/)
      }
      expect(await findUserByEmail(client, email)).toBeNull()
    })

    test('creates the profile with --create-profile, then a re-run is a no-op', async () => {
      const email = 'boot-cli@example.test'
      const name = 'Boot Cli'
      emails.push(email)
      names.push(name)
      const argv = ['--env', envFile, '--email', email, '--name', name, '--create-profile']

      const first = terminal([PASSWORD, PASSWORD])
      await main([...argv, '--colour', '#336699'], first.io)
      expect(first.output.join('\n')).toMatch(/Created the admin profile "Boot Cli"/)
      expect(first.output.join('\n')).not.toContain(PASSWORD)
      expect(await profileByName(name)).toMatchObject({ role: 'admin', is_claimed: true })

      const second = terminal()
      await main(argv, second.io)
      expect(second.output.join('\n')).toMatch(/Already linked to "Boot Cli" as admin/)
    })
  })
})
