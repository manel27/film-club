import { expect, test, type Page } from '@playwright/test'
import { E2E_MEMBER, E2E_PASSWORD, SEED_VIEWER } from './fixtures'

// Uses the synthetic films in supabase/seed.sql.
const SCREENSHOTS = 'test-results/screenshots'

async function logIn(page: Page, email: string, password: string) {
  await page.goto('./#/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page.getByRole('heading', { name: 'Films', exact: true })).toBeVisible()
}

test('a member browses the films by week, with averages and present people', async ({ page }) => {
  await logIn(page, E2E_MEMBER.email, E2E_PASSWORD)
  await expect(page.getByText('8 films')).toBeVisible()

  // Same-day films are listed together, in day_order.
  const marathon = page.locator('section', {
    has: page.getByRole('heading', { name: 'Week of Sat 31 Jan 2026' }),
  })
  await expect(marathon.getByRole('listitem')).toHaveText([
    /Midnight Marathon \(2015\)\s*Maratona/,
    /Midnight Marathon II \(2017\)\s*Maratona/,
  ])

  const orchard = page.getByRole('listitem').filter({ hasText: 'The Quiet Orchard' })
  await expect(orchard.getByRole('img', { name: 'Chosen by Kwame' })).toBeVisible()
  await expect(orchard.locator('.film-avg')).toHaveText('Average 7.69')
  await expect(orchard.getByRole('group', { name: 'Present' }).getByRole('img')).toHaveCount(4)
  await expect(orchard.getByRole('img', { name: 'Viggo' })).toBeVisible()

  // The easter egg's locked scores never count towards an average.
  const egg = page.getByRole('listitem').filter({ hasText: 'Megashark Rising 2' })
  await expect(egg.locator('.film-avg')).toHaveText('–No average')
  await expect(egg.getByText('Democrático')).toBeVisible()

  // Newest first by default.
  await expect(page.getByRole('heading', { level: 2 }).first()).toHaveText('Week of Sat 5 Dec 2026')
  for (const theme of ['letterboxd', 'superman', 'batman']) {
    await page.getByRole('banner').getByLabel('Theme').selectOption(theme)
    await page.screenshot({ path: `${SCREENSHOTS}/films-list-${theme}.png`, fullPage: true })
  }
})

test('view and filters are kept in the URL and restored from localStorage', async ({ page }) => {
  await logIn(page, E2E_MEMBER.email, E2E_PASSWORD)

  await page.getByLabel('Kind').selectOption({ label: 'Maratona' })
  await page.getByLabel('Sort').selectOption('oldest')
  await expect(page.getByText('2 films')).toBeVisible()
  await expect(page).toHaveURL(/#\/\?sort=oldest&kind=maratona$/)

  await page.getByText('Present', { exact: true }).click()
  // Controlled by the URL, which updates a moment after the click: click, then assert.
  const tamsin = page.getByRole('checkbox', { name: 'Tamsin' })
  await tamsin.click()
  await expect(page.getByText('No films match these filters.')).toBeVisible()
  await tamsin.click()
  await expect(tamsin).not.toBeChecked()

  await page.getByRole('button', { name: 'Posters' }).click()
  await expect(page.getByRole('img', { name: 'Midnight Marathon (2015)' })).toBeVisible()
  await page.screenshot({ path: `${SCREENSHOTS}/films-posters.png`, fullPage: true })

  // Opening the page without any choice in the URL brings the last one back.
  await page.goto('./#/')
  await expect(page).toHaveURL(/#\/\?view=posters&sort=oldest&kind=maratona$/)
  await expect(page.getByText('2 films')).toBeVisible()

  await page.getByRole('button', { name: 'Clear filters' }).click()
  await expect(page.getByText('8 films')).toBeVisible()
  // Sort and view are not filters: they stay.
  await expect(page).toHaveURL(/#\/\?view=posters&sort=oldest$/)
})

test('a viewer can browse but has no "I haven\'t scored" filter', async ({ page }) => {
  await logIn(page, SEED_VIEWER.email, SEED_VIEWER.password)
  await expect(page.getByText('8 films')).toBeVisible()
  await expect(page.getByLabel("I haven't scored")).toHaveCount(0)
})

test('the films page fits a 360px screen', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 })
  await logIn(page, E2E_MEMBER.email, E2E_PASSWORD)
  await expect(page.getByText('8 films')).toBeVisible()
  const overflow = () =>
    page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(await overflow()).toBe(0)
  await page.screenshot({ path: `${SCREENSHOTS}/films-narrow.png`, fullPage: true })

  // The present panel opens inline, in both views.
  await page.getByText('Present', { exact: true }).click()
  await expect(page.getByRole('checkbox', { name: 'Tamsin' })).toBeVisible()
  expect(await overflow()).toBe(0)
  await page.getByRole('button', { name: 'Posters' }).click()
  await expect(page.getByRole('img', { name: 'Midnight Marathon (2015)' })).toBeVisible()
  expect(await overflow()).toBe(0)
  await page.screenshot({ path: `${SCREENSHOTS}/films-narrow-present.png`, fullPage: true })
})
