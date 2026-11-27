import { expect, test, type Page } from '@playwright/test'
import { adminClient, SEED_MEMBER, SEED_VIEWER, watchCsp } from './fixtures'

// Adds a screening in 2019, a year no seed film or other spec uses, and removes
// it after: this file runs in the writes project (playwright.config.ts). Exact
// numbers are checked only for 2019, which this file owns; for All time and
// 2026 the expected counts come from the database itself, so other specs'
// films (and the seed's next film once its date passes) can't break them.
// Wren is an unclaimed seed member nobody else counts for; the film is before
// the rotation epoch, so it changes no standings.
const SCREENSHOTS = 'test-results/screenshots'
const TITLE = 'E2E Stats Archive Night'
const OWN_YEAR = '2019'
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
    .insert({
      title: TITLE,
      release_year: 1988,
      screened_on: `${OWN_YEAR}-03-16`,
      assigned_id: WREN,
    })
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
  // The Stats page and its chart library are a chunk of their own (routes.tsx).
  const statsChunk: string[] = []
  page.on('request', (r) => {
    if (/\/assets\/StatsPage-[^/]*\.js$/.test(r.url())) statsChunk.push(r.url())
  })
  await logIn(page, SEED_MEMBER)
  await page.waitForLoadState('networkidle')
  expect(statsChunk, 'the Films page loads no Stats chunk').toEqual([])
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Stats' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Stats' })).toBeVisible()
  expect(statsChunk).toHaveLength(1)

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
    '1',
    expect.stringContaining('4.00 👎'),
    '1.00',
  ])
  // Three charts, each an SVG, hidden from screen readers (the tables carry the numbers).
  const charts = page.locator('.stats-chart')
  await expect(charts).toHaveCount(3)
  for (const chart of await charts.all()) {
    await expect(chart).toHaveAttribute('aria-hidden', 'true')
    await expect(chart.locator('.recharts-wrapper > svg')).toBeVisible()
  }

  await period.selectOption('2026')
  await expect(page).toHaveURL(/#\/stats\?year=2026$/)
  const in2026 = await screened('2026')
  await expect(fact(page, 'Films screened')).toHaveText(in2026.films)
  await expect(fact(page, 'Scores given')).toHaveText(in2026.scores)

  // The year this file owns: exact numbers.
  await period.selectOption(OWN_YEAR)
  await expect(page).toHaveURL(new RegExp(`#/stats\\?year=${OWN_YEAR}$`))
  await expect(fact(page, 'Films screened')).toHaveText('1')
  await expect(fact(page, 'Scores given')).toHaveText('1')
  await expect(fact(page, 'Club average')).toContainText('4.00 👎')
  await expect(fact(page, 'Average attendance')).toHaveText('1.00')
  await expect(fact(page, 'Normal')).toHaveText('1')
  await expect(fact(page, 'First screening')).toHaveText('Sat 16 Mar 2019')
  expect(await tableRows(page, `By month in ${OWN_YEAR}`)).toEqual([
    ['March', '1', expect.stringContaining('4.00 👎'), '1.00'],
  ])
  expect(await violations()).toEqual([])

  // A bad year in the URL falls back to All time.
  await page.goto('./#/stats?year=20x6')
  await expect(page.getByLabel('Period')).toHaveValue('')
  await expect(fact(page, 'Films screened')).toHaveText(all.films)

  await page.screenshot({ path: `${SCREENSHOTS}/stats.png`, fullPage: true })
  await page.goto(`./#/stats?year=${OWN_YEAR}`)
  await page
    .getByRole('table', { name: 'Most attended' })
    .getByRole('link', { name: `${TITLE} (1988)` })
    .click()
  await expect(page.getByRole('heading', { level: 1, name: TITLE })).toBeVisible()
})

test('a viewer can open the stats; at 360px the charts fit and only the tables scroll sideways', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 740 })
  await logIn(page, SEED_VIEWER)
  await page.goto('./#/stats')
  await expect(fact(page, 'Films screened')).toHaveText((await screened()).films)
  await expect(page.locator('.stats-chart .recharts-wrapper > svg')).toHaveCount(3)
  for (const theme of ['letterboxd', 'superman', 'batman']) {
    await page.evaluate((t) => (document.documentElement.dataset.theme = t), theme)
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow, theme).toBe(0)
    // Each chart fits the column (ResponsiveContainer), never wider than the screen.
    for (const box of await page
      .locator('.stats-chart .recharts-wrapper > svg')
      .evaluateAll((svgs) => svgs.map((svg) => svg.getBoundingClientRect().right))) {
      expect(box, theme).toBeLessThanOrEqual(360)
    }
  }
  await page.screenshot({ path: `${SCREENSHOTS}/stats-360.png`, fullPage: true })
})
