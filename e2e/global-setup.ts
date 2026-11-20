import { bootstrapAdmin } from '../scripts/create-admin.mjs'
import {
  adminClient,
  E2E_ADMIN,
  E2E_MEMBER,
  E2E_PASSWORD,
  E2E_UNLINKED,
  ensureLinkedLogin,
  ensureLogin,
} from './fixtures'

/**
 * Seeds the e2e logins on the local stack: an admin (through the bootstrap
 * script, so every run also exercises it), a member, and a bare login with no
 * profile for the "not linked" page. Safe to re-run.
 */
export default async function globalSetup() {
  const client = adminClient()

  await bootstrapAdmin({
    client,
    email: E2E_ADMIN.email,
    name: E2E_ADMIN.name,
    colour: E2E_ADMIN.colour,
    createProfile: true,
    resetPassword: true,
    getPassword: async () => E2E_PASSWORD,
  })
  await ensureLinkedLogin(client, { ...E2E_MEMBER, role: 'member' })
  await ensureLogin(client, E2E_UNLINKED.email)
}
