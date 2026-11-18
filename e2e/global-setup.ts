import { bootstrapAdmin, findUserByEmail } from '../scripts/create-admin.mjs'
import { adminClient, E2E_ADMIN, E2E_PASSWORD, E2E_UNLINKED } from './fixtures'

/**
 * Seeds the e2e logins on the local stack. Uses the admin bootstrap script for
 * the admin (so every run also exercises it), and a bare login with no profile
 * for the "not linked" page. Safe to re-run.
 */
export default async function globalSetup() {
  const client = adminClient()

  await bootstrapAdmin({
    client,
    email: E2E_ADMIN.email,
    name: E2E_ADMIN.name,
    colour: E2E_ADMIN.colour,
    resetPassword: true,
    getPassword: async () => E2E_PASSWORD,
  })

  const unlinked = await findUserByEmail(client, E2E_UNLINKED.email)
  const { error } = unlinked
    ? await client.auth.admin.updateUserById(unlinked.id, { password: E2E_PASSWORD })
    : await client.auth.admin.createUser({
        email: E2E_UNLINKED.email,
        password: E2E_PASSWORD,
        email_confirm: true,
      })
  if (error) throw error
}
