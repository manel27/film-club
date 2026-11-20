import { adminClient, E2E_ADMIN, E2E_MEMBER, E2E_UNLINKED, removeLoginAndProfile } from './fixtures'

/** Removes the e2e logins and profiles again, so the local seed stays as it was. */
export default async function globalTeardown() {
  const client = adminClient()
  await removeLoginAndProfile(client, E2E_ADMIN.email, E2E_ADMIN.name)
  await removeLoginAndProfile(client, E2E_MEMBER.email, E2E_MEMBER.name)
  await removeLoginAndProfile(client, E2E_UNLINKED.email)
}
