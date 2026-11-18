// Integration tests for scripts/create-admin.mjs against the LOCAL stack
// (no browser). Every test uses its own synthetic names and cleans up.
import { expect, test } from '@playwright/test'
import { bootstrapAdmin, findUserByEmail } from '../scripts/create-admin.mjs'
import { adminClient } from './fixtures'

const PASSWORD = 'bootstrap-test-password'
const password = async () => PASSWORD

test.describe('admin bootstrap script', () => {
  const client = adminClient()
  const emails: string[] = []
  const names: string[] = []

  test.afterEach(async () => {
    for (const email of emails.splice(0)) {
      const user = await findUserByEmail(client, email)
      if (user) await client.auth.admin.deleteUser(user.id)
    }
    for (const name of names.splice(0)) {
      await client.from('profiles').delete().eq('display_name', name)
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

    const first = await bootstrapAdmin({ client, email, name, getPassword: password })
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
      bootstrapAdmin({ client, email: 'kwame@example.test', name, getPassword: password }),
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
      bootstrapAdmin({ client, email, name, colour: 'not-a-colour', getPassword: password }),
    ).rejects.toThrow(/Could not create the profile/)
    expect(await findUserByEmail(client, email)).toBeNull()
    expect(await profileByName(name)).toBeNull()
  })

  test('only changes the password of an existing login when asked to', async () => {
    const email = 'boot-reset@example.test'
    const name = 'Boot Reset'
    emails.push(email)
    names.push(name)
    await bootstrapAdmin({ client, email, name, getPassword: password })

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
      bootstrapAdmin({ client, email, name: 'Boot Short', getPassword: async () => 'short' }),
    ).rejects.toThrow(/at least 8 characters/)
    expect(await findUserByEmail(client, email)).toBeNull()
  })
})
