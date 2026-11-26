import { expect, test, type Page } from '@playwright/test'
import {
  adminClient,
  E2E_MEMBER,
  E2E_PASSWORD,
  SEED_MEMBER,
  SEED_VIEWER,
  userClient,
} from './fixtures'

// Renames the E2E member in the shared local database (and puts the name
// back), so this file runs in the writes project (playwright.config.ts).
// Uses the seed data: Orla (admin) was present at films 1, 3, 4, 5 and 6,
// chose 4 and 5 (and the easter egg, 7), and scored 2 and 7 without being there.
const SCREENSHOTS = 'test-results/screenshots'
const ORLA = '00000000-0000-4000-8000-0000000000a1'
const RENAMED = 'E2E Member Renamed'

async function restoreName() {
  const { error } = await adminClient()
    .from('profiles')
    .update({ display_name: E2E_MEMBER.name })
    .eq('display_name', RENAMED)
  if (error) throw error
}

async function logIn(page: Page, email: string, password: string) {
  await page.goto('./#/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page.getByRole('heading', { name: 'Films', exact: true })).toBeVisible()
}

test('a profile shows stats and switches between present, not present, watched and not watched', async ({
  page,
}) => {
  await logIn(page, SEED_VIEWER.email, SEED_VIEWER.password)
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'People' }).click()
  await page.locator('.people-list').getByRole('link', { name: 'Orla' }).click()

  await expect(page.getByRole('heading', { level: 1, name: 'Orla' })).toBeVisible()
  await expect(page.locator('.badge', { hasText: 'Admin' })).toBeVisible()
  const stats = page.locator('.profile-stats')
  // The easter egg's 11 and choice count nowhere.
  await expect(stats).toContainText('Films present5')
  // Present at 5, and scored Neon Harbour without attendance.
  await expect(stats).toContainText('Films watched6')
  await expect(stats).toContainText('Films chosen2')
  await expect(stats).toContainText('Scores given3')
  await expect(stats).toContainText('Average score given8.20')
  await expect(page.getByText('Attendance before 2023 may be incomplete.')).toBeVisible()
  // A viewer edits nothing, not even their own name.
  await expect(page.getByRole('button', { name: 'Edit name' })).toHaveCount(0)

  const panel = page.getByRole('tabpanel')
  await expect(page.getByRole('tab', { name: 'Present (5)' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(panel).toContainText('The Quiet Orchard')
  await expect(panel).not.toContainText('Neon Harbour')
  await page.getByRole('tab', { name: 'Watched (6)' }).click()
  await expect(panel).toContainText('The Quiet Orchard')
  await expect(panel).toContainText('Neon Harbour')
  await expect(panel).not.toContainText('Scored, not present')
  await page.getByRole('tab', { name: /^Not watched/ }).click()
  await expect(panel).not.toContainText('Neon Harbour')
  await page.getByRole('tab', { name: /^Not present/ }).click()
  await expect(panel.getByRole('listitem').filter({ hasText: 'Neon Harbour' })).toContainText(
    'Scored, not present',
  )
  // The easter egg is in neither tab, though Orla scored it (decision P3).
  await expect(panel).not.toContainText('Megashark Rising 2')
  await page.getByRole('button', { name: 'Poster grid' }).click()
  await expect(panel.getByRole('img', { name: 'Neon Harbour (2021)' })).toBeVisible()
  await page.screenshot({ path: `${SCREENSHOTS}/profile.png`, fullPage: true })

  // Tab and view are kept in the URL: back from a film returns to them.
  await panel.getByRole('link', { name: 'Neon Harbour (2021)' }).click()
  await expect(page.getByRole('heading', { name: 'Neon Harbour' })).toBeVisible()
  await page.goBack()
  await expect(page.getByRole('tab', { name: /^Not present/ })).toHaveAttribute(
    'aria-selected',
    'true',
  )
})

test('people on a film page link to their profiles', async ({ page }) => {
  await logIn(page, SEED_MEMBER.email, SEED_MEMBER.password)
  await page.goto('./#/films/1')
  await page.locator('.chips').getByRole('link', { name: 'Orla' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Orla' })).toBeVisible()
  // Someone else's profile: no rename.
  await expect(page.getByRole('button', { name: 'Edit name' })).toHaveCount(0)
})

test("a member can't rename someone else or change their own role or colour", async () => {
  const db = userClient()
  const { error: loginError } = await db.auth.signInWithPassword({
    email: SEED_MEMBER.email,
    password: SEED_MEMBER.password,
  })
  expect(loginError).toBeNull()
  const other = await db
    .from('profiles')
    .update({ display_name: 'Hacked' })
    .eq('id', ORLA)
    .select('id')
  expect(other.error).toBeNull()
  expect(other.data).toEqual([]) // RLS: no row matched
  const me = '00000000-0000-4000-8000-0000000000a3'
  const colour = await db.from('profiles').update({ colour: '#000000' }).eq('id', me)
  expect(colour.error?.code).toBe('42501')
  const role = await db.from('profiles').update({ role: 'admin' }).eq('id', me)
  expect(role.error?.code).toBe('42501')
})

// Hooks scoped here: file-level ones also ran in parallel workers and put the name back mid-test.
test.describe('rename', () => {
  test.beforeAll(restoreName)
  test.afterAll(restoreName)

  test('a member renames themselves from their own profile', async ({ page }) => {
    await logIn(page, E2E_MEMBER.email, E2E_PASSWORD)
    const header = page.getByRole('banner')
    await header.getByRole('link', { name: E2E_MEMBER.name }).click()
    await expect(page.getByRole('heading', { level: 1, name: E2E_MEMBER.name })).toBeVisible()

    await page.getByRole('button', { name: 'Edit name' }).click()
    const input = page.getByLabel('Display name')
    await expect(input).toBeFocused()
    await input.fill('\u200b \u2060')
    await page.getByRole('button', { name: 'Save name' }).click()
    await expect(page.getByRole('alert')).toHaveText('Enter a name.')
    await input.fill('k\u200bwame')
    await page.getByRole('button', { name: 'Save name' }).click()
    await expect(page.getByRole('alert')).toHaveText('Someone already has that name.')

    await input.fill(`  ${RENAMED}  `)
    await page.getByRole('button', { name: 'Save name' }).click()
    await expect(page.getByRole('status')).toHaveText('Name saved.')
    await expect(page.getByRole('heading', { level: 1, name: RENAMED })).toBeVisible()
    await expect(header.getByRole('link', { name: RENAMED })).toBeVisible()

    // It's in the database, not just on screen.
    await page.reload()
    await expect(page.getByRole('heading', { level: 1, name: RENAMED })).toBeVisible()
  })
})

test('the people page shows each role on hover and keyboard focus, phone and desktop, every theme', async ({
  page,
}) => {
  // Not the E2E member: the rename test runs in parallel as them.
  await logIn(page, SEED_VIEWER.email, SEED_VIEWER.password)
  await page.goto('./#/people')
  const kwame = page.locator('.people-list').getByRole('link', { name: 'Kwame' })
  const orla = page.locator('.people-list').getByRole('link', { name: 'Orla' })
  await expect(kwame).toHaveAccessibleDescription('Member')
  await expect(page.getByRole('tooltip')).toHaveCount(0) // all hidden until hover/focus
  for (const width of [360, 1280]) {
    await page.setViewportSize({ width, height: 740 })
    for (const theme of ['letterboxd', 'superman', 'batman']) {
      await page.evaluate((t) => (document.documentElement.dataset.theme = t), theme)
      await orla.hover()
      await expect(page.getByRole('tooltip', { name: 'Admin' })).toBeVisible()
      await page.mouse.move(0, 0)
      await kwame.focus()
      await expect(page.getByRole('tooltip', { name: 'Member' })).toBeVisible()
      await page.screenshot({ path: `${SCREENSHOTS}/people-role-${width}-${theme}.png` })
      await kwame.blur()
    }
  }

  // WCAG 1.4.13 at phone width: dismissible, hoverable, and never in the way.
  await page.setViewportSize({ width: 360, height: 740 })
  const kwameTip = page.getByRole('tooltip', { name: 'Member' })
  await kwame.focus()
  await expect(kwameTip).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(kwameTip).toBeHidden()
  await expect(kwame).toBeFocused()

  await kwame.blur()
  await kwame.hover()
  await expect(kwameTip).toBeVisible()
  await kwameTip.hover()
  await expect(kwameTip).toBeVisible()

  await page.mouse.move(0, 0)
  await kwame.focus()
  await page.locator('.people-list').getByRole('link', { name: 'Viggo' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Viggo' })).toBeVisible()
})
