import { expect, test, type Browser, type Page } from '@playwright/test'
import {
  adminClient,
  E2E_ADMIN,
  E2E_PASSWORD,
  ensureLinkedLogin,
  removeLoginAndProfile,
  SEED_MEMBER,
} from './fixtures'

// Adds people (as viewers, so the rotation is untouched) and logins to the
// shared local database, so this file runs in the writes project
// (playwright.config.ts). Everything it adds is removed afterwards.
const SCREENSHOTS = 'test-results/screenshots'
const INVITEE = { name: 'E2E Invitee', email: 'e2e-invitee@example.test' }
const STALE = { name: 'E2E Stale Invite' }
const RESETTER = { name: 'E2E Resetter', email: 'e2e-resetter@example.test', colour: '#8e7cc3' }
const NEW_PASSWORD = 'e2e-new-password'
const BAD_LINK = 'This link is invalid, has expired or was already used. Ask Manel for a new link.'

async function cleanUp() {
  const client = adminClient()
  await removeLoginAndProfile(client, INVITEE.email, INVITEE.name)
  await removeLoginAndProfile(client, RESETTER.email, RESETTER.name)
  await removeLoginAndProfile(client, 'nobody@example.test', STALE.name)
}
// One worker, in order: the clean-up hooks would remove the other tests' people.
test.describe.configure({ mode: 'default' })
test.beforeAll(cleanUp)
test.afterAll(cleanUp)
// Every e2e run comes from the same address: start each test with a fresh allowance.
test.beforeEach(async () => {
  const { error } = await adminClient().from('rate_limits').delete().eq('bucket', 'invite-link')
  if (error) throw error
})

async function logIn(page: Page, email: string, password: string) {
  await page.goto('./#/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page.getByRole('heading', { name: 'Films', exact: true })).toBeVisible()
}

async function openAdmin(page: Page) {
  await logIn(page, E2E_ADMIN.email, E2E_PASSWORD)
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Admin' }).click()
  await expect(page.getByRole('heading', { name: 'Admin', level: 1 })).toBeVisible()
}

/** Clicks a create / regenerate button and returns the link shown once. */
async function newLink(page: Page, button: string): Promise<string> {
  await page.getByRole('button', { name: button }).click()
  const link = page.getByLabel('Link', { exact: true })
  await expect(link).toHaveValue(/#\/(invite|reset)\/[\w-]{43}$/)
  await expect(page.getByText(/shown only this once/)).toBeVisible()
  return link.inputValue()
}

/** Opens a link in a fresh browser (the invitee's), logged out. */
async function openFresh(browser: Browser, link: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage()
  await page.goto(link)
  return page
}

test('admin adds a person and invites them; they claim it and log in', async ({
  page,
  browser,
}) => {
  await openAdmin(page)
  await page.getByLabel('Name').fill(`  ${INVITEE.name} `)
  await page.getByLabel('Colour').fill('#76a5af')
  await page.getByLabel('Role').selectOption('viewer')
  await page.getByRole('button', { name: 'Add person' }).click()
  await expect(page.getByText(`${INVITEE.name} added.`)).toBeVisible()
  const row = page.getByRole('row').filter({ hasText: INVITEE.name })
  await expect(row).toContainText('Not claimed yet')

  const link = await newLink(page, `Create invite for ${INVITEE.name}`)
  expect(link.startsWith('http://localhost:4317/film-club/#/invite/')).toBe(true)
  await expect(row).toContainText('Invite until')
  await page.screenshot({ path: `${SCREENSHOTS}/admin-people.png`, fullPage: true })

  const invitee = await openFresh(browser, link)
  await expect(invitee.getByRole('heading', { name: `Welcome, ${INVITEE.name}` })).toBeVisible()
  await expect(invitee.getByText('Welcome to the club!')).toBeVisible()
  await invitee.screenshot({ path: `${SCREENSHOTS}/invite.png` })
  await invitee.getByLabel('Email').fill(INVITEE.email)
  await invitee.getByLabel(/^Password/).fill(E2E_PASSWORD)
  await invitee.getByLabel('Confirm password').fill(E2E_PASSWORD)
  await invitee.getByRole('button', { name: 'Create account' }).click()
  await expect(invitee.getByRole('heading', { name: 'Films', exact: true })).toBeVisible()
  await expect(invitee.getByRole('banner').getByText(INVITEE.name)).toBeVisible()

  // Log out and back in with the new login.
  await invitee.getByRole('button', { name: 'Log out' }).click()
  await logIn(invitee, INVITEE.email, E2E_PASSWORD)

  // The link was single use.
  const again = await openFresh(browser, link)
  await expect(again.getByRole('alert')).toHaveText(BAD_LINK)

  await page.reload()
  await expect(row).toContainText('Has a login')

  // On a phone each person is a card: nothing scrolls sideways.
  await page.setViewportSize({ width: 375, height: 800 })
  await expect(row.getByRole('link', { name: INVITEE.name })).toBeInViewport()
  const region = page.getByRole('region', { name: 'People' })
  expect(await region.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
  await page.screenshot({ path: `${SCREENSHOTS}/admin-people-phone.png`, fullPage: true })
  await expect(
    page.getByRole('button', { name: `Create reset link for ${INVITEE.name}` }),
  ).toBeVisible()
})

test('expired, revoked and made-up invite links are refused', async ({ page, browser }) => {
  const client = adminClient()
  const { error } = await client
    .from('profiles')
    .insert({ display_name: STALE.name, colour: '#c27ba0', role: 'viewer' })
  if (error) throw error

  await openAdmin(page)
  const revoked = await newLink(page, `Create invite for ${STALE.name}`)
  await page.getByRole('button', { name: `Revoke invite for ${STALE.name}` }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Yes, revoke' }).click()
  await expect(page.getByRole('button', { name: `Create invite for ${STALE.name}` })).toBeFocused()
  await expect(page.getByRole('row').filter({ hasText: STALE.name })).toContainText(
    '—Create invite',
  )
  await expect((await openFresh(browser, revoked)).getByRole('alert')).toHaveText(BAD_LINK)

  const expired = await newLink(page, `Create invite for ${STALE.name}`)
  const now = Date.now()
  const { data: who } = await client
    .from('profiles')
    .select('id')
    .eq('display_name', STALE.name)
    .single()
  const update = await client
    .from('invites')
    .update({
      created_at: new Date(now - 3 * 86_400_000).toISOString(),
      expires_at: new Date(now - 86_400_000).toISOString(),
    })
    .eq('profile_id', who!.id)
    .is('revoked_at', null)
    .select('id')
  expect(update.data).toHaveLength(1)
  await expect((await openFresh(browser, expired)).getByRole('alert')).toHaveText(BAD_LINK)
  await page.reload()
  await expect(page.getByRole('row').filter({ hasText: STALE.name })).toContainText(
    'Invite expired',
  )

  const madeUp = await openFresh(browser, './#/invite/not-a-real-token')
  await expect(madeUp.getByRole('alert')).toHaveText(BAD_LINK)
  await madeUp.screenshot({ path: `${SCREENSHOTS}/invite-invalid.png` })
})

test('a reset link sets a new password once', async ({ page, browser }) => {
  await ensureLinkedLogin(adminClient(), { ...RESETTER, role: 'viewer' })
  await openAdmin(page)
  const link = await newLink(page, `Create reset link for ${RESETTER.name}`)
  await expect(page.getByText(/for 24 hours/)).toBeVisible()

  const resetter = await openFresh(browser, link)
  await expect(
    resetter.getByRole('heading', { name: `Set a new password for ${RESETTER.name}` }),
  ).toBeVisible()
  await resetter.getByLabel(/^New password/).fill(NEW_PASSWORD)
  await resetter.getByLabel('Confirm new password').fill('typo-password')
  await resetter.getByRole('button', { name: 'Save and log in' }).click()
  await expect(resetter.getByRole('alert')).toHaveText("The passwords don't match.")
  await resetter.getByLabel('Confirm new password').fill(NEW_PASSWORD)
  await resetter.getByRole('button', { name: 'Save and log in' }).click()
  await expect(resetter.getByRole('heading', { name: 'Films', exact: true })).toBeVisible()
  await expect(resetter.getByRole('banner').getByText(RESETTER.name)).toBeVisible()

  await resetter.getByRole('button', { name: 'Log out' }).click()
  await logIn(resetter, RESETTER.email, NEW_PASSWORD)

  // Used: the reset page says so before any typing.
  const again = await openFresh(browser, link)
  await expect(again.getByRole('alert')).toHaveText(BAD_LINK)
  await expect(again.getByLabel(/^New password/)).toHaveCount(0)
})

test('only the admin reaches the admin page', async ({ page }) => {
  await logIn(page, SEED_MEMBER.email, SEED_MEMBER.password)
  await expect(
    page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Admin' }),
  ).toHaveCount(0)
  await page.goto('./#/admin')
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
  await expect(page.getByRole('button', { name: /invite|reset link/i })).toHaveCount(0)
})
