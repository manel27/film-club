import { expect, test, type Page } from '@playwright/test'
import { adminClient, SEED_MEMBER, SEED_VIEWER, watchCsp } from './fixtures'

// Adds screenings in 2019, a year no seed film or other spec uses, and removes
// them after: this file runs in the writes project (playwright.config.ts). Exact
// numbers are checked only for 2019, which this file owns; for All time and
// 2026 the expected counts come from the database itself, so other specs'
// films (and the seed's next film once its date passes) can't break them.
// Wren is an unclaimed seed member nobody else counts for; the films are before
// the rotation epoch, so they change no standings. One film has a score and
// Wren present; five more, one a month April–August, give By month 6 rows (Show all).
const SCREENSHOTS = 'test-results/screenshots'
const TITLE = 'E2E Stats Archive Night'
const OWN_YEAR = '2019'
/** A class name Recharts renders: in its code, minified or not. */
const RECHARTS = 'recharts-wrapper'
const WREN = '00000000-0000-4000-8000-0000000000b2'

test.describe.configure({ mode: 'serial' })

async function removeFilm() {
  const { error } = await adminClient().from('films').delete().like('title', `${TITLE}%`)
  if (error) throw error
}

test.beforeAll(async () => {
  await removeFilm()
  const db = adminClient()
  const { data, error } = await db
    .from('films')
    .insert({
      title: TITLE,
      release_year: 1988,
      screened_on: `${OWN_YEAR}-03-16`,
      assigned_id: WREN,
    })
    .select('id')
    .single()
  if (error) throw error
  const more = await db.from('films').insert(
    [4, 5, 6, 7, 8].map((month) => ({
      title: `${TITLE} ${month}`,
      release_year: 1988,
      screened_on: `${OWN_YEAR}-0${month}-10`,
      assigned_id: WREN,
    })),
  )
  if (more.error) throw more.error
  for (const { error } of await Promise.all([
    db.from('scores').insert({ film_id: data.id, profile_id: WREN, score: 4 }),
    db.from('attendance').insert({ film_id: data.id, profile_id: WREN }),
  ])) {
    if (error) throw error
  }
})
test.afterAll(removeFilm)

/**
 * What the database holds now: screened films (on or before today in Lisbon,
 * not the easter egg) and their scores, in `year` or all time, and the years.
 */
async function screened(year?: string) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon' }).format(new Date())
  let query = adminClient()
    .from('films')
    .select('screened_on, scores(score)')
    .eq('is_easter_egg', false)
    .lte('screened_on', today)
  if (year) query = query.gte('screened_on', `${year}-01-01`).lte('screened_on', `${year}-12-31`)
  const { data, error } = await query
  if (error) throw error
  return {
    films: String(data.length),
    scores: String(data.reduce((n, f) => n + f.scores.length, 0)),
    years: [...new Set(data.map((f) => f.screened_on.slice(0, 4)))].sort().reverse(),
  }
}

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

/** The row header and cell texts of each row of the table `name`. */
const tableRows = (page: Page, name: string) =>
  page
    .getByRole('table', { name })
    .locator('tbody tr')
    .evaluateAll((trs) =>
      trs.map((tr) => [...tr.querySelectorAll('th, td')].map((c) => c.textContent)),
    )

test('a member sees the club stats, filters them by year and opens a film', async ({ page }) => {
  const violations = await watchCsp(page)
  // The Stats page and its chart library are a chunk of their own (routes.tsx):
  // no script the Films page loads contains Recharts (its class name as a marker).
  const scripts: { url: string; text: Promise<string> }[] = []
  page.on('response', (r) => {
    if (r.request().resourceType() === 'script') scripts.push({ url: r.url(), text: r.text() })
  })
  const withRecharts = async () => {
    const found: string[] = []
    for (const s of scripts) if ((await s.text).includes(RECHARTS)) found.push(s.url)
    return found
  }
  await logIn(page, SEED_MEMBER)
  await page.waitForLoadState('networkidle')
  expect(scripts.length, 'scripts seen').toBeGreaterThan(0)
  expect(await withRecharts(), 'the Films page loads no Recharts').toEqual([])
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Stats' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Stats' })).toBeVisible()
  // The marker is real: the Stats chunk, and only it, has it.
  expect(await withRecharts()).toEqual([expect.stringMatching(/\/assets\/StatsPage-[^/]*\.js$/)])

  const all = await screened()
  expect(all.years).toContain(OWN_YEAR)
  await expect(fact(page, 'Films screened')).toHaveText(all.films)
  await expect(fact(page, 'Scores given')).toHaveText(all.scores)
  const period = page.getByLabel('Period')
  await expect(period.locator('option')).toHaveText(['All time', ...all.years])
  // Over time, all time: one row per year, oldest first; 2019 is this file's film alone.
  const byYear = await tableRows(page, 'By year')
  expect(byYear.map((r) => r[0])).toEqual([...all.years].reverse())
  expect(byYear.find((r) => r[0] === OWN_YEAR)).toEqual([
    OWN_YEAR,
    '6',
    expect.stringContaining('4.00 👎'),
    '0.17',
  ])
  // Charts, each an SVG, hidden from screen readers (the tables carry the numbers):
  // films and average over time on Overview, genres and decades on Breakdowns.
  const charts = page.locator('.stats-chart')
  const checkCharts = async () => {
    await expect(charts).toHaveCount(2)
    for (const chart of await charts.all()) {
      await expect(chart).toHaveAttribute('aria-hidden', 'true')
      await expect(chart.locator('.recharts-wrapper > svg')).toBeVisible()
    }
  }
  await checkCharts()
  await page.getByRole('tab', { name: 'Breakdowns' }).click()
  await expect(page).toHaveURL(/#\/stats\?tab=breakdowns$/)
  await expect(page.getByRole('tabpanel', { name: 'Breakdowns' })).toBeVisible()
  await checkCharts()
  await page.getByRole('tab', { name: 'Overview' }).click()
  await expect(page).toHaveURL(/#\/stats$/)

  await period.selectOption('2026')
  await expect(page).toHaveURL(/#\/stats\?year=2026$/)
  const in2026 = await screened('2026')
  await expect(fact(page, 'Films screened')).toHaveText(in2026.films)
  await expect(fact(page, 'Scores given')).toHaveText(in2026.scores)

  // The year this file owns: exact numbers.
  await period.selectOption(OWN_YEAR)
  await expect(page).toHaveURL(new RegExp(`#/stats\\?year=${OWN_YEAR}$`))
  await expect(fact(page, 'Films screened')).toHaveText('6')
  await expect(fact(page, 'Scores given')).toHaveText('1')
  await expect(fact(page, 'Club average')).toContainText('4.00 👎')
  await expect(fact(page, 'Average attendance')).toHaveText('0.17')
  await expect(fact(page, 'Normal')).toHaveText('6')
  await expect(fact(page, 'First screening')).toHaveText('Sat 16 Mar 2019')
  await expect(fact(page, 'Last screening')).toHaveText('Sat 10 Aug 2019')
  // Six months: the first 5, then Show all; focus stays on the button.
  const byMonth = `By month in ${OWN_YEAR}`
  const month = (name: string, films: string) => [name, films, '–No average', '0.00']
  expect(await tableRows(page, byMonth)).toEqual([
    ['March', '1', expect.stringContaining('4.00 👎'), '1.00'],
    month('April', '1'),
    month('May', '1'),
    month('June', '1'),
    month('July', '1'),
  ])
  const showAll = page.getByRole('button', { name: `Show all 6 rows: ${byMonth}` })
  await expect(showAll).toHaveText('Show all (6)')
  await expect(showAll).toHaveAttribute('aria-expanded', 'false')
  await showAll.click()
  const showFewer = page.getByRole('button', { name: `Show fewer rows: ${byMonth}` })
  await expect(showFewer).toHaveText('Show fewer')
  await expect(showFewer).toHaveAttribute('aria-expanded', 'true')
  await expect(showFewer).toBeFocused()
  expect((await tableRows(page, byMonth)).map((r) => r[0])).toEqual([
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
  ])
  // A year change starts it collapsed again.
  await period.selectOption('')
  await period.selectOption(OWN_YEAR)
  await expect(showAll).toHaveAttribute('aria-expanded', 'false')
  expect(await tableRows(page, byMonth)).toHaveLength(5)

  // Tabs: the tab joins the year in the URL; the year stays when the tab changes and back.
  await page.getByRole('tab', { name: 'People' }).click()
  await expect(page).toHaveURL(new RegExp(`#/stats\\?tab=people&year=${OWN_YEAR}$`))
  await expect(page.getByRole('table', { name: 'Attendance' })).toBeVisible()
  await expect(page.getByRole('table', { name: byMonth })).toHaveCount(0)
  await period.selectOption('2026')
  await expect(page).toHaveURL(/#\/stats\?tab=people&year=2026$/)
  await expect(page.getByRole('tab', { name: 'People' })).toHaveAttribute('aria-selected', 'true')
  // Keyboard: arrows move and wrap, Home and End; focus follows the selected tab.
  await page.getByRole('tab', { name: 'People' }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('tab', { name: 'Breakdowns' })).toBeFocused()
  await expect(page).toHaveURL(/#\/stats\?tab=breakdowns&year=2026$/)
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('tab', { name: 'Overview' })).toBeFocused()
  await expect(page).toHaveURL(/#\/stats\?year=2026$/)
  await page.keyboard.press('End')
  await expect(page.getByRole('tab', { name: 'Breakdowns' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await page.keyboard.press('Home')
  await page.keyboard.press('ArrowLeft')
  await expect(page.getByRole('tab', { name: 'Breakdowns' })).toBeFocused()
  // Tab moves from the selected tab into its panel, not to the other tabs.
  await page.keyboard.press('Tab')
  await expect(page.getByRole('tabpanel', { name: 'Breakdowns' })).toBeFocused()
  expect(await violations()).toEqual([])

  // A bad year or tab in the URL falls back to All time and Overview.
  await page.goto('./#/stats?tab=peop1e&year=20x6')
  await expect(page.getByLabel('Period')).toHaveValue('')
  await expect(page.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')
  await expect(fact(page, 'Films screened')).toHaveText(all.films)

  await page.screenshot({ path: `${SCREENSHOTS}/stats.png`, fullPage: true })
  await page.goto(`./#/stats?tab=films&year=${OWN_YEAR}`)
  await page
    .getByRole('table', { name: 'Most attended' })
    .getByRole('link', { name: `${TITLE} (1988)` })
    .click()
  await expect(page.getByRole('heading', { level: 1, name: TITLE })).toBeVisible()
})

test('a viewer can open the stats; at 360px, in every tab and theme, the cards fit and only the tables scroll sideways', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 740 })
  await logIn(page, SEED_VIEWER)
  await page.goto('./#/stats')
  await expect(fact(page, 'Films screened')).toHaveText((await screened()).films)
  for (const [tab, charts] of [
    ['Overview', 2],
    ['Films', 0],
    ['People', 0],
    ['Breakdowns', 2],
  ] as const) {
    await page.getByRole('tab', { name: tab }).click()
    await expect(page.getByRole('tabpanel', { name: tab })).toBeVisible()
    await expect(page.locator('.stats-chart .recharts-wrapper > svg')).toHaveCount(charts)
    for (const theme of ['letterboxd', 'superman', 'batman']) {
      await page.evaluate((t) => (document.documentElement.dataset.theme = t), theme)
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect(overflow, `${tab}, ${theme}`).toBe(0)
      // Each card and chart fits the column, never wider than the screen.
      for (const right of await page
        .locator('.stats-card, .stats-tile, .stats-chart .recharts-wrapper > svg')
        .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().right))) {
        expect(right, `${tab}, ${theme}`).toBeLessThanOrEqual(360)
      }
    }
    await page.screenshot({
      path: `${SCREENSHOTS}/stats-360-${tab.toLowerCase()}.png`,
      fullPage: true,
    })
  }
})

test('if the Stats chunk is missing (an old tab after a release), the page offers a reload', async ({
  page,
}) => {
  const chunk = /\/assets\/StatsPage-[^/]*\.js$/
  await page.route(chunk, (route) => route.abort())
  await logIn(page, SEED_VIEWER)
  const nav = page.getByRole('navigation', { name: 'Main' })
  await nav.getByRole('link', { name: 'Stats' }).click()
  await expect(page.getByRole('alert')).toHaveText(
    "Couldn't load this page. The site may have been updated.",
  )
  await expect(page.getByText('Unexpected Application Error')).toHaveCount(0)
  // The header stays, so the visitor can go elsewhere; Reload fetches the page again.
  await expect(nav).toBeVisible()
  await page.unroute(chunk)
  await page.getByRole('button', { name: 'Reload' }).click()
  await expect(page.getByLabel('Period')).toBeVisible()
})
