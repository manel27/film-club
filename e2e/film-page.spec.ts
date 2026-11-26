import { expect, test, type Page } from '@playwright/test'
import { SEED_ADMIN, SEED_MEMBER, SEED_MODERATOR, SEED_VIEWER } from './fixtures'

// Uses the synthetic films, people, scores and comments in supabase/seed.sql.
// Tests that write put everything back, and each uses its own film.
const SCREENSHOTS = 'test-results/screenshots'

async function openFilm(page: Page, login: { email: string; password: string }, id: number) {
  await page.goto(`./#/login?next=%2Ffilms%2F${id}`)
  await page.getByLabel('Email').fill(login.email)
  await page.getByLabel('Password').fill(login.password)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Comments' })).toBeVisible()
}

const comment = (page: Page, text: string) => page.getByRole('listitem').filter({ hasText: text })

test('a viewer sees everything and can change nothing', async ({ page }) => {
  await openFilm(page, SEED_VIEWER, 1)
  await expect(page.getByRole('heading', { name: 'The Quiet Orchard' })).toBeVisible()
  await expect(page.getByText('2026/01/10')).toBeVisible()
  await expect(page.getByRole('row', { name: 'Average 7.69' })).toBeVisible()
  await expect(comment(page, 'projector broke')).toContainText('Sheet archive')
  const main = page.getByRole('main')
  await expect(main.getByRole('button')).toHaveCount(0)
  await expect(main.getByRole('textbox')).toHaveCount(0)
  await page.screenshot({ path: `${SCREENSHOTS}/film-viewer.png`, fullPage: true })

  await page.setViewportSize({ width: 360, height: 740 })
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBe(0)
})

test("a member changes their own presence, score and comments, never others'", async ({ page }) => {
  page.on('dialog', (d) => d.accept())
  await openFilm(page, SEED_MEMBER, 1)
  await expect(page.getByRole('button', { name: "Delete Kwame's score" })).toBeVisible()
  await expect(page.getByRole('button', { name: "Delete Orla's score" })).toHaveCount(0)
  await expect(
    comment(page, 'Loved the ending.').getByRole('button', { name: 'Edit' }),
  ).toBeVisible()
  await expect(comment(page, 'projector broke').getByRole('button')).toHaveCount(0)
  await expect(page.getByText('Edit attendance')).toHaveCount(0)

  // Film 8 has no attendance, scores or comments yet.
  await page.goto('./#/films/8')
  await expect(page.getByRole('heading', { name: "Tomorrow's Feature" })).toBeVisible()
  await page.getByRole('button', { name: 'I was there' }).click()
  await expect(page.locator('.chips')).toContainText('Kwame')
  await page.getByRole('button', { name: "I wasn't there" }).click()
  await expect(page.getByText('Nobody marked as present.')).toBeVisible()

  const score = page.getByLabel('Your score')
  await score.fill('7.255')
  await page.getByRole('button', { name: 'Save score' }).click()
  await expect(page.getByText('Use at most two decimals.')).toBeVisible()
  // A decimal comma works (number inputs used to drop it).
  await score.fill('0,5')
  await page.getByRole('button', { name: 'Save score' }).click()
  await expect(page.getByRole('row', { name: /^Kwame 0\.50/ })).toBeVisible()
  await score.fill('7,5')
  await page.getByRole('button', { name: 'Save score' }).click()
  await expect(page.getByRole('row', { name: /^Kwame 7\.50/ })).toBeVisible()
  await score.fill('6.5')
  await page.getByRole('button', { name: 'Save score' }).click()
  await expect(page.getByRole('row', { name: /^Kwame 6\.50/ })).toBeVisible()
  await page.getByRole('button', { name: "Delete Kwame's score" }).click()
  await expect(page.getByText('No scores yet.')).toBeVisible()

  await page.getByLabel('Add a comment').fill('Looking forward to it <b>!</b>')
  await page.getByRole('button', { name: 'Post' }).click()
  const mine = comment(page, 'Looking forward to it <b>!</b>')
  await mine.getByRole('button', { name: 'Edit' }).click()
  await page.getByLabel('Edit comment').fill('Changed my mind.')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(comment(page, 'Changed my mind.')).toContainText('(edited)')
  await comment(page, 'Changed my mind.').getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByText('No comments yet.')).toBeVisible()
})

test("a moderator handles anyone's attendance and scores, but not others' comments", async ({
  page,
}) => {
  page.on('dialog', (d) => d.accept())
  await openFilm(page, SEED_MODERATOR, 6)
  await expect(page.getByRole('button', { name: "Delete Yusuf's score" })).toBeVisible()

  // A viewer can be marked present and scored by staff (decision D6).
  await page.getByText('Edit attendance').click()
  // Controlled by the reloaded data: click, then assert.
  await page.getByRole('checkbox', { name: 'Petra' }).click()
  await expect(page.locator('.chips')).toContainText('Petra')
  await page.getByRole('checkbox', { name: 'Petra' }).click()
  await expect(page.locator('.chips')).not.toContainText('Petra')

  await page.getByLabel('Score for').selectOption({ label: 'Petra' })
  await page.getByLabel('Score', { exact: true }).fill('5')
  await page.getByRole('button', { name: 'Save score' }).click()
  await expect(page.getByRole('row', { name: /^Petra 5\.00/ })).toBeVisible()
  await page.getByRole('button', { name: "Delete Petra's score" }).click()
  await expect(page.getByRole('row', { name: /Petra/ })).toHaveCount(0)

  await page.goto('./#/films/2')
  await expect(
    comment(page, 'The harbour scene!').getByRole('button', { name: 'Edit' }),
  ).toBeVisible()
  await expect(comment(page, 'Too long, great soundtrack.').getByRole('button')).toHaveCount(0)
})

test("the admin can edit and delete others' comments", async ({ page }) => {
  await openFilm(page, SEED_ADMIN, 2)
  const yusuf = comment(page, 'Too long, great soundtrack.')
  await expect(yusuf.getByRole('button', { name: 'Edit' })).toBeVisible()
  await expect(yusuf.getByRole('button', { name: 'Delete' })).toBeVisible()
})

test('the easter egg: you just lost the game, and its 11s are locked', async ({ page }) => {
  await openFilm(page, SEED_ADMIN, 7)
  await expect(page.getByText('You just lost the game!')).toBeVisible()
  await expect(page.getByText(/These scores are locked/)).toBeVisible()
  await expect(page.getByRole('row', { name: 'Orla 11.00' })).toBeVisible()
  await expect(page.getByRole('row', { name: 'Average 11.00' })).toBeVisible()
  await expect(page.getByRole('button', { name: /score/i })).toHaveCount(0)
  await expect(page.getByLabel('Your score')).toHaveCount(0)
  await page.screenshot({ path: `${SCREENSHOTS}/film-easter-egg.png`, fullPage: true })
})

test('films link to their page, and the way back keeps the filters', async ({ page }) => {
  await openFilm(page, SEED_MEMBER, 1)
  await page.getByRole('link', { name: '← All films' }).click()
  await page.getByLabel('Kind').selectOption({ label: 'Cinema' })
  await page.getByRole('link', { name: 'Paper Moons Over the River' }).click()
  await expect(page).toHaveURL(/#\/films\/3$/)
  await page.getByRole('link', { name: '← All films' }).click()
  await expect(page).toHaveURL(/kind=cinema/)
  await expect(page.getByText('1 film')).toBeVisible()

  await page.getByRole('button', { name: 'Poster grid' }).click()
  await page.getByRole('link', { name: 'Paper Moons Over the River (2018)' }).click()
  await expect(page.getByRole('heading', { name: /Paper Moons Over the River/ })).toBeVisible()
  await page.goto('./#/films/999999')
  await expect(page.getByRole('heading', { name: 'Film not found' })).toBeVisible()
})

test("a Democrático's film page says why it was chosen; the badge tip shows on focus", async ({
  page,
}) => {
  await openFilm(page, SEED_VIEWER, 6)
  const main = page.getByRole('main')
  await expect(main.getByText('Why: Three people had never seen a Lea Fontaine film')).toBeVisible()
  const badge = main.getByText('Democrático', { exact: true })
  const tip = main.getByRole('tooltip')
  await expect(tip).toBeHidden()
  await badge.focus()
  await expect(tip).toBeVisible()
  await expect(tip).toHaveText('Three people had never seen a Lea Fontaine film')
  await page.keyboard.press('Escape')
  await expect(tip).toBeHidden()

  // No reason recorded (imported films).
  await page.goto('./#/films/7')
  await expect(main.locator('p.film-reason')).toHaveText('Unknown reason')
  await expect(main.locator('p.film-reason')).toBeVisible()
  await main.getByText('Democrático', { exact: true }).focus()
  await expect(main.getByRole('tooltip')).toHaveText('Unknown reason')
})

test.describe('on a touch screen', () => {
  test.use({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true })

  test("tapping a Democrático's badge shows why, within the screen in every theme", async ({
    page,
  }) => {
    await openFilm(page, SEED_VIEWER, 6)
    expect(await page.evaluate(() => matchMedia('(hover: none)').matches)).toBe(true)
    const main = page.getByRole('main')
    const tip = main.getByRole('tooltip')
    await expect(tip).toBeHidden()
    await main.getByText('Democrático', { exact: true }).tap()
    await expect(tip).toBeVisible()
    // Themes switched on the page only (the picker would save the viewer's choice).
    for (const theme of ['letterboxd', 'superman', 'batman']) {
      await page.evaluate((t) => (document.documentElement.dataset.theme = t), theme)
      await expect(tip).toBeVisible()
      const box = (await tip.boundingBox())!
      expect(box.x + box.width).toBeLessThanOrEqual(360)
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBe(0)
    }
    await page.screenshot({ path: `${SCREENSHOTS}/film-reason-touch.png` })
  })
})
