import { findUserByEmail } from '../scripts/create-admin.mjs'
import { adminClient, E2E_ADMIN, E2E_UNLINKED } from './fixtures'

/** Removes the e2e logins and profile again, so the local seed stays as it was. */
export default async function globalTeardown() {
  const client = adminClient()
  for (const email of [E2E_ADMIN.email, E2E_UNLINKED.email]) {
    const user = await findUserByEmail(client, email)
    if (user) {
      const { error } = await client.auth.admin.deleteUser(user.id)
      if (error) throw error
    }
  }
  const { error } = await client.from('profiles').delete().eq('display_name', E2E_ADMIN.name)
  if (error) throw error
}
