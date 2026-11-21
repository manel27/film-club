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
    has: page.getByRole('heading', { name: '2026/01/31' }),
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
  await expect(page.getByRole('heading', { level: 2 }).first()).toHaveText('2026/12/05')
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

  await page.getByRole('button', { name: 'Posters by week' }).click()
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

test('posters can be shown in one grid without week headings', async ({ page }) => {
  await logIn(page, E2E_MEMBER.email, E2E_PASSWORD)
  await page.getByRole('button', { name: 'Posters by week' }).click()
  await expect(page.getByRole('heading', { level: 2 })).toHaveCount(7)

  await page.getByRole('button', { name: 'Poster grid' }).click()
  await expect(page).toHaveURL(/#\/\?view=grid$/)
  await expect(page.getByRole('heading', { level: 2 })).toHaveCount(0)
  await expect(page.locator('.poster')).toHaveCount(8)
  await expect(page.locator('.poster').first()).toHaveAttribute(
    'title',
    "Tomorrow's Feature (2024)",
  )
  await page.screenshot({ path: `${SCREENSHOTS}/films-posters-flat.png`, fullPage: true })

  await page.reload()
  await expect(page.getByRole('button', { name: 'Poster grid' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})

test('films can be sorted by title, release year and average, without week headings', async ({
  page,
}) => {
  await logIn(page, E2E_MEMBER.email, E2E_PASSWORD)
  const titles = page.locator('.film-title a')

  await page.getByLabel('Sort').selectOption({ label: 'Title A–Z' })
  await expect(page).toHaveURL(/#\/\?sort=title$/)
  await expect(page.getByRole('heading', { level: 2 })).toHaveCount(0)
  // A leading "The" is ignored.
  await expect(titles).toHaveText([
    'The Long Vote',
    'Megashark Rising 2',
    'Midnight Marathon',
    'Midnight Marathon II',
    'Neon Harbour',
    'Paper Moons Over the River',
    'The Quiet Orchard',
    "Tomorrow's Feature",
  ])

  await page.getByLabel('Sort').selectOption({ label: 'Oldest release' })
  await expect(titles.first()).toHaveText('Megashark Rising 2')

  // Films with no average go last, newest screening first.
  await page.getByLabel('Sort').selectOption({ label: 'Highest average' })
  await expect(titles).toHaveText([
    'Paper Moons Over the River',
    'The Quiet Orchard',
    'The Long Vote',
    'Neon Harbour',
    "Tomorrow's Feature",
    'Midnight Marathon',
    'Midnight Marathon II',
    'Megashark Rising 2',
  ])

  await page.getByRole('button', { name: 'Posters by week' }).click()
  await expect(page).toHaveURL(/#\/\?view=posters&sort=score-desc$/)
  await expect(page.getByRole('heading', { level: 2 })).toHaveCount(0)
  await expect(page.locator('.poster').first()).toHaveAttribute(
    'title',
    'Paper Moons Over the River (2018)',
  )
})

test('the present filter closes on a click outside or Escape', async ({ page }) => {
  await logIn(page, E2E_MEMBER.email, E2E_PASSWORD)
  const summary = page.getByText('Present', { exact: true })
  const tamsin = page.getByRole('checkbox', { name: 'Tamsin' })

  await summary.click()
  await expect(tamsin).toBeVisible()
  await page.getByRole('heading', { name: 'Films', exact: true }).click()
  await expect(tamsin).toBeHidden()

  await summary.click()
  await tamsin.focus()
  await page.keyboard.press('Escape')
  await expect(tamsin).toBeHidden()
  await expect(summary).toBeFocused()
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
  await page.getByRole('button', { name: 'Posters by week' }).click()
  await expect(page.getByRole('img', { name: 'Midnight Marathon (2015)' })).toBeVisible()
  expect(await overflow()).toBe(0)
  await page.screenshot({ path: `${SCREENSHOTS}/films-narrow-present.png`, fullPage: true })
})
