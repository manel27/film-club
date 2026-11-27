import { expect, test, type Page } from '@playwright/test'
import { adminClient, SEED_MEMBER, SEED_VIEWER } from './fixtures'

// Adds a 2025 screening (so the year filter has two years) in the shared local
// database and removes it after, so this file runs in the writes project
// (playwright.config.ts). Wren is an unclaimed seed member nobody else counts
// for; the film is before the rotation epoch, so it changes no standings.
const SCREENSHOTS = 'test-results/screenshots'
const TITLE = 'E2E Stats Archive Night'
const WREN = '00000000-0000-4000-8000-0000000000b2'

test.describe.configure({ mode: 'serial' })

async function removeFilm() {
  const { error } = await adminClient().from('films').delete().eq('title', TITLE)
  if (error) throw error
}

test.beforeAll(async () => {
  await removeFilm()
  const db = adminClient()
  const { data, error } = await db
    .from('films')
    .insert({ title: TITLE, release_year: 1988, screened_on: '2025-03-15', assigned_id: WREN })
    .select('id')
    .single()
  if (error) throw error
  for (const { error } of await Promise.all([
    db.from('scores').insert({ film_id: data.id, profile_id: WREN, score: 4 }),
    db.from('attendance').insert({ film_id: data.id, profile_id: WREN }),
  ])) {
    if (error) throw error
  }
})
test.afterAll(removeFilm)

async function logIn(page: Page, login: { email: string; password: string }) {
  await page.goto('./#/login')
  await page.getByLabel('Email').fill(login.email)
  await page.getByLabel('Password').fill(login.password)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page.getByRole('heading', { name: 'Films', exact: true })).toBeVisible()
}

/** The value next to an overview label. */
const fact = (page: Page, label: string) =>
  page
    .locator('dt', { hasText: new RegExp(`^${label}$`) })
    .locator('xpath=following-sibling::dd[1]')

test('a member sees the club stats, filters them by year and opens a film', async ({ page }) => {
  await logIn(page, SEED_MEMBER)
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Stats' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Stats' })).toBeVisible()

  // All time: the seed's six screenings (not the easter egg, not film 8 on
  // 2026-12-05) plus this file's 2025 one.
  await expect(fact(page, 'Films screened')).toHaveText('7')
  await expect(fact(page, 'Scores given')).toHaveText('13')
  // Film averages 7.69, 6.84, 8.75, 7.00 and 4.00.
  await expect(fact(page, 'Club average')).toContainText('6.86')
  const period = page.getByLabel('Period')
  await expect(period.locator('option')).toHaveText(['All time', '2026', '2025'])

  // 2026: exactly the seed.
  await period.selectOption('2026')
  await expect(page).toHaveURL(/#\/stats\?year=2026$/)
  await expect(fact(page, 'Films screened')).toHaveText('6')
  await expect(fact(page, 'Scores given')).toHaveText('12')
  await expect(fact(page, 'Club average')).toContainText('7.57 👌')
  // 14 attendance marks over 6 screenings.
  await expect(fact(page, 'Average attendance')).toHaveText('2.33')
  await expect(fact(page, 'Normal')).toHaveText('2')
  await expect(fact(page, 'Maratona')).toHaveText('2')

  await period.selectOption('2025')
  await expect(page).toHaveURL(/#\/stats\?year=2025$/)
  await expect(fact(page, 'Films screened')).toHaveText('1')
  await expect(fact(page, 'Club average')).toContainText('4.00')

  // A bad year in the URL falls back to All time.
  await page.goto('./#/stats?year=20x6')
  await expect(page.getByLabel('Period')).toHaveValue('')
  await expect(fact(page, 'Films screened')).toHaveText('7')

  await page.screenshot({ path: `${SCREENSHOTS}/stats.png`, fullPage: true })
  await page
    .getByRole('table', { name: 'Highest average' })
    .getByRole('link', { name: 'The Quiet Orchard (2019)' })
    .click()
  await expect(page.getByRole('heading', { level: 1, name: 'The Quiet Orchard' })).toBeVisible()
})

test('a viewer can open the stats; at 360px only the tables scroll sideways', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 })
  await logIn(page, SEED_VIEWER)
  await page.goto('./#/stats')
  await expect(fact(page, 'Films screened')).toHaveText('7')
  for (const theme of ['letterboxd', 'superman', 'batman']) {
    await page.evaluate((t) => (document.documentElement.dataset.theme = t), theme)
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow, theme).toBe(0)
  }
  await page.screenshot({ path: `${SCREENSHOTS}/stats-360.png`, fullPage: true })
})
