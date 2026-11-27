import { expect, test, type Page } from '@playwright/test'
import { adminClient, SEED_MEMBER, SEED_MODERATOR, SEED_VIEWER, userClient } from './fixtures'

// Records passes and adjustments in the shared local database, so this file
// runs in the writes project (playwright.config.ts). Uses the seed rotation:
// epoch 2026-01-05, Kwame owes a turn since the Democrático of 2026-02-07.
const SCREENSHOTS = 'test-results/screenshots'
const KWAME = '00000000-0000-4000-8000-0000000000a3'
const REASON = 'E2E starting value'

test.describe.configure({ mode: 'serial' })

async function cleanUp() {
  const db = adminClient()
  for (const { error } of [
    await db.from('rotation_passes').delete().eq('profile_id', KWAME), // the seed has none
    await db.from('rotation_adjustments').delete().eq('reason', REASON),
  ]) {
    if (error) throw error
  }
}
test.beforeAll(cleanUp)
test.afterAll(cleanUp)

async function logIn(page: Page, login: { email: string; password: string }) {
  await page.goto('./#/login')
  await page.getByLabel('Email').fill(login.email)
  await page.getByLabel('Password').fill(login.password)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page.getByRole('heading', { name: 'Films', exact: true })).toBeVisible()
}

// On the rotation page: the films page shows the next film instead while one is added (seed: 2099-12-05).
test('a member sees Next up and passes for the coming week', async ({ page }) => {
  await logIn(page, SEED_MEMBER)
  await page.goto('./#/rotation')
  const card = page.getByRole('region', { name: 'Next up' })
  await expect(card).toContainText('Kwame (owed turn)')
  await expect(
    card.getByRole('list', { name: 'Standings' }).getByRole('listitem').first(),
  ).toContainText('Kwame1 pointowed turn (missed the Democrático on 2026/02/07)')

  // Passing clears the owed turn: points decide (Orla has the most).
  await card.getByRole('button', { name: "I can't make it" }).click()
  await expect(card).toContainText("Can't make it: Kwame")
  await expect(card.locator('.next-chooser')).toContainText('Orla')
  await expect(card).not.toContainText('owed turn')
  await expect(card.getByRole('button', { name: 'I can make it after all' })).toBeFocused()

  await card.getByRole('button', { name: 'I can make it after all' }).click()
  await expect(card).toContainText('Kwame (owed turn)')
})

test('a moderator enters a starting value on the rotation page; the log shows who', async ({
  page,
}) => {
  await logIn(page, SEED_MODERATOR)
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Rotation' })
    .click()
  await expect(page.getByRole('heading', { name: 'Rotation', level: 1 })).toBeVisible()

  const form = page.getByRole('form', { name: 'Adjust points' })
  await form.getByLabel('Person').selectOption({ label: 'Wren' })
  await form.getByLabel('Points', { exact: true }).fill('9')
  await form.getByLabel('Effective from').fill('2026-01-05')
  await form.getByLabel('Reason').fill(REASON)
  await form.getByRole('button', { name: 'Save adjustment' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Adjustment saved.' })).toBeVisible()

  await expect(page.getByRole('row').filter({ hasText: REASON })).toHaveText(
    `2026/01/05Wrenset to 9${REASON}Tamsin`,
  )
  const standings = page.getByRole('list', { name: 'Standings' })
  await expect(standings.getByRole('listitem').filter({ hasText: 'Wren' })).toHaveText(
    'Wren9 points',
  )
  // An owed turn still comes first.
  await expect(standings.getByRole('listitem').first()).toContainText('Kwame')
  await page.screenshot({ path: `${SCREENSHOTS}/rotation.png`, fullPage: true })
})

test('a member cannot take back a pass for a week already screened (R4)', async ({ page }) => {
  // Kwame passed for the week of 2026-01-12, whose screening (2026-01-17) happened.
  const { error } = await adminClient()
    .from('rotation_passes')
    .insert({ week_start: '2026-01-12', profile_id: KWAME, created_by: KWAME })
  if (error) throw error

  await logIn(page, SEED_MEMBER)
  await page.goto('./#/rotation')
  const passes = page.getByRole('region', { name: 'Passes' })
  await expect(passes.getByRole('row').filter({ hasText: '2026/01/12' })).toContainText('Kwame')
  await expect(passes.getByRole('button', { name: /Remove Kwame's pass/ })).toHaveCount(0)

  // The server refuses it too.
  const kwame = userClient()
  const { error: loginError } = await kwame.auth.signInWithPassword(SEED_MEMBER)
  if (loginError) throw loginError
  const removed = await kwame
    .from('rotation_passes')
    .delete()
    .match({ week_start: '2026-01-12', profile_id: KWAME })
    .select('week_start')
  expect(removed.data).toEqual([])
  const added = await kwame
    .from('rotation_passes')
    .insert({ week_start: '2026-01-19', profile_id: KWAME })
  expect(added.error?.code).toBe('42501')
})

test('a viewer sees the rotation but can change nothing', async ({ page }) => {
  await logIn(page, SEED_VIEWER)
  await page.goto('./#/rotation')
  await expect(page.getByRole('region', { name: 'Next up' })).toContainText('Kwame (owed turn)')
  await expect(page.getByRole('heading', { name: 'Past choosers' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Staff' })).toHaveCount(0)
  await expect(page.getByRole('button')).toHaveText(['Log out'])
})
