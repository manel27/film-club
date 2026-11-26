import { expect, test, type Page } from '@playwright/test'
import { E2E_MEMBER, E2E_PASSWORD, SEED_VIEWER } from './fixtures'

// Uses the synthetic films in supabase/seed.sql.
const SCREENSHOTS = 'test-results/screenshots'
const THEMES = ['letterboxd', 'superman', 'batman']
// Before the seed's next film (Tomorrow's Feature, 2026-12-05), and in the past, so the session stays valid.
const BEFORE_NEXT_FILM = new Date('2026-11-20T12:00:00Z')

async function logIn(page: Page, email: string, password: string) {
  await page.goto('./#/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page.getByRole('heading', { name: 'Films', exact: true })).toBeVisible()
}

const filmTitles = (page: Page) => page.locator('.film-title a[href*="/films/"]')
const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

test('a member browses one flat list with names, ratings and present people', async ({ page }) => {
  await logIn(page, E2E_MEMBER.email, E2E_PASSWORD)
  await expect(page.getByText('8 films')).toBeVisible()

  // Newest first, no week headings; same-day films in day_order.
  await expect(filmTitles(page)).toHaveText([
    "Tomorrow's Feature",
    'The Long Vote',
    'Midnight Marathon',
    'Midnight Marathon II',
    'Paper Moons Over the River',
    'Neon Harbour',
    'The Quiet Orchard',
    'Megashark Rising 2',
  ])
  await expect(page.locator('.film-list').getByRole('heading')).toHaveCount(0)

  const orchard = page.getByRole('listitem').filter({ hasText: 'The Quiet Orchard' })
  const kwame = orchard.locator('.film-title').getByRole('link', { name: 'Kwame' })
  await expect(kwame).toHaveAccessibleDescription('Member')
  await expect(orchard.locator('.film-title')).toContainText('Kwame · The Quiet Orchard (2019)')
  await expect(orchard.locator('.film-avg')).toHaveText('7.69 👌average 7.69, good')
  await expect(orchard.locator('.film-date')).toHaveText('2026/01/10')
  const present = orchard.getByRole('group', { name: 'Present' })
  await expect(present.locator('.chip')).toHaveText(['Kwame', 'Orla', 'Tamsin', 'Viggo'])

  // The role shows on hover and on focus; Escape hides it.
  const tip = orchard.locator('.film-title').getByRole('tooltip', { name: 'Member' })
  await expect(tip).toBeHidden()
  await kwame.hover()
  await expect(tip).toBeVisible()
  await page.mouse.move(0, 0)
  await expect(tip).toBeHidden()
  await kwame.focus()
  await expect(tip).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(tip).toBeHidden()
  await kwame.blur()

  // A system chooser is a plain chip: no link, no tip.
  const paper = page.getByRole('listitem').filter({ hasText: 'Paper Moons' })
  await expect(paper.locator('.film-title .chip')).toHaveText('Cinema')
  await expect(paper.locator('.film-title').getByRole('link', { name: 'Cinema' })).toHaveCount(0)
  await expect(paper.getByText('Cinema', { exact: true }).last()).toHaveClass('badge')

  // The easter egg's locked scores never count towards an average; no emoji.
  const egg = page.getByRole('listitem').filter({ hasText: 'Megashark Rising 2' })
  await expect(egg.locator('.film-avg')).toHaveText('–No average')
  await expect(egg.getByText('Democrático')).toBeVisible()

  for (const theme of THEMES) {
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

  await page.getByRole('button', { name: 'Poster list' }).click()
  await expect(page.locator('.film-row .film-thumb')).toHaveCount(2)
  await page.screenshot({ path: `${SCREENSHOTS}/films-poster-list.png`, fullPage: true })

  // Opening the page without any choice in the URL brings the last one back.
  await page.goto('./#/')
  await expect(page).toHaveURL(/#\/\?view=posters&sort=oldest&kind=maratona$/)
  await expect(page.getByText('2 films')).toBeVisible()

  await page.getByRole('button', { name: 'Clear filters' }).click()
  await expect(page.getByText('8 films')).toBeVisible()
  // Sort and view are not filters: they stay.
  await expect(page).toHaveURL(/#\/\?view=posters&sort=oldest$/)
})

test('the poster grid shows date, chooser and rating on hover or focus', async ({ page }) => {
  await logIn(page, E2E_MEMBER.email, E2E_PASSWORD)
  await page.getByRole('button', { name: 'Poster grid' }).click()
  await expect(page).toHaveURL(/#\/\?view=grid$/)
  await expect(page.locator('.poster')).toHaveCount(8)

  const orchard = page.locator('.poster', { hasText: 'The Quiet Orchard' })
  const details = orchard.locator('.poster-details')
  await expect(details).toHaveText('2026/01/10Kwame7.69 👌')
  await expect(details).toHaveCSS('opacity', '0')
  await orchard.hover()
  await expect(details).toHaveCSS('opacity', '1')
  await page.screenshot({ path: `${SCREENSHOTS}/films-grid-hover.png` })
  await page.mouse.move(0, 0)
  await expect(details).toHaveCSS('opacity', '0')
  await orchard.getByRole('link').focus()
  await expect(details).toHaveCSS('opacity', '1')
  await expect(orchard.getByRole('link')).toHaveAccessibleName(
    /^The Quiet Orchard \(2019\) ?, 2026\/01\/10, chosen by Kwame, average 7\.69, good$/,
  )

  await page.reload()
  await expect(page.getByRole('button', { name: 'Poster grid' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})

test('on a touch screen the grid shows the details under each poster', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'hover', value: 'none' }] })
  await page.setViewportSize({ width: 360, height: 740 })
  await logIn(page, E2E_MEMBER.email, E2E_PASSWORD)
  await page.getByRole('button', { name: 'Poster grid' }).click()
  const details = page
    .locator('.poster', { hasText: 'The Quiet Orchard' })
    .locator('.poster-details')
  await expect(details).toBeVisible()
  await expect(details).toHaveCSS('opacity', '1')
  await expect(details).toHaveCSS('position', 'static')
  expect(await overflow(page)).toBe(0)
  await page.screenshot({ path: `${SCREENSHOTS}/films-grid-touch.png`, fullPage: true })
})

test('films can be sorted by title, release year and average in a flat list', async ({ page }) => {
  await logIn(page, E2E_MEMBER.email, E2E_PASSWORD)

  await page.getByLabel('Sort').selectOption({ label: 'Title A–Z' })
  await expect(page).toHaveURL(/#\/\?sort=title$/)
  // A leading "The" is ignored.
  await expect(filmTitles(page)).toHaveText([
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
  await expect(filmTitles(page).first()).toHaveText('Megashark Rising 2')

  // Films with no average go last, newest screening first.
  await page.getByLabel('Sort').selectOption({ label: 'Highest average' })
  await expect(filmTitles(page)).toHaveText([
    'Paper Moons Over the River',
    'The Quiet Orchard',
    'The Long Vote',
    'Neon Harbour',
    "Tomorrow's Feature",
    'Midnight Marathon',
    'Midnight Marathon II',
    'Megashark Rising 2',
  ])
  await expect(page.locator('.film-date').first()).toHaveText('2026/01/24')

  // The poster list works with any sort.
  await page.getByRole('button', { name: 'Poster list' }).click()
  await expect(page).toHaveURL(/#\/\?view=posters&sort=score-desc$/)
  await expect(filmTitles(page).first()).toHaveText('Paper Moons Over the River')

  await page.getByRole('button', { name: 'Poster grid' }).click()
  await expect(page).toHaveURL(/#\/\?view=grid&sort=score-desc$/)
  const first = page.locator('.poster').first()
  await expect(first).toHaveAttribute('title', 'Paper Moons Over the River (2018)')
  await expect(first.locator('.poster-details .film-avg')).toContainText('8.75 👏')
})

test('the next film card shows the film added for the next screening', async ({ page }) => {
  await page.clock.setFixedTime(BEFORE_NEXT_FILM)
  await logIn(page, E2E_MEMBER.email, E2E_PASSWORD)
  const card = page.getByRole('region', { name: 'Next film' })
  await expect(card).toContainText("Tomorrow's Feature (2024)")
  await expect(card).toContainText('Sat 5 Dec 2026')
  await expect(card).toContainText('Chosen by Yusuf')
  await expect(page.getByRole('region', { name: 'Next up' })).toHaveCount(0)
  await expect(card.getByRole('link', { name: 'Yusuf' })).toHaveAccessibleDescription('Member')

  // The chooser's chip opens their profile; anywhere else on the card opens the film.
  await card.getByRole('link', { name: 'Yusuf' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Yusuf' })).toBeVisible()
  await page.goBack()
  await card.getByText('Sat 5 Dec 2026').click()
  await expect(page.getByRole('heading', { level: 1, name: "Tomorrow's Feature" })).toBeVisible()
})

test('without a film added for the next screening, the rotation card stays', async ({ page }) => {
  await page.clock.setFixedTime(BEFORE_NEXT_FILM)
  // Leave out the films still to come, as if none had been added yet.
  await page.route(/\/rest\/v1\/films\?/, async (route) => {
    const response = await route.fetch()
    const films = (await response.json()) as { screened_on: string }[]
    await route.fulfill({ response, json: films.filter((f) => f.screened_on < '2026-11-20') })
  })
  await logIn(page, E2E_MEMBER.email, E2E_PASSWORD)
  await expect(page.getByRole('region', { name: 'Next up' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Next film' })).toHaveCount(0)
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

test('the films page fits a 360px screen in every view and theme', async ({ page }) => {
  await page.clock.setFixedTime(BEFORE_NEXT_FILM)
  await page.setViewportSize({ width: 360, height: 740 })
  await logIn(page, E2E_MEMBER.email, E2E_PASSWORD)
  await expect(page.getByText('8 films')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Next film' })).toBeVisible()

  for (const theme of THEMES) {
    await page.getByRole('banner').getByLabel('Theme').selectOption(theme)
    for (const [view, file] of [
      ['List', 'list'],
      ['Poster list', 'poster-list'],
      ['Poster grid', 'grid'],
    ]) {
      await page.getByRole('button', { name: view, exact: true }).click()
      await expect(page.getByRole('button', { name: view, exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
      expect(await overflow(page), `${view} in ${theme}`).toBe(0)
      await page.screenshot({
        path: `${SCREENSHOTS}/films-narrow-${file}-${theme}.png`,
        fullPage: true,
      })
    }
  }
  await page
    .getByRole('region', { name: 'Next film' })
    .screenshot({ path: `${SCREENSHOTS}/films-narrow-next-film.png` })

  // A present name's role tip, shown by focus near the right edge, doesn't widen the page.
  await page.getByRole('button', { name: 'List', exact: true }).click()
  const orchard = page.getByRole('listitem').filter({ hasText: 'The Quiet Orchard' })
  await orchard.getByRole('group', { name: 'Present' }).getByRole('link').last().focus()
  await expect(orchard.getByRole('group', { name: 'Present' }).getByRole('tooltip')).toBeVisible()
  expect(await overflow(page)).toBe(0)

  // The present panel opens inline.
  await page.getByText('Present', { exact: true }).click()
  await expect(page.getByRole('checkbox', { name: 'Tamsin' })).toBeVisible()
  expect(await overflow(page)).toBe(0)
})
