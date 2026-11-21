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
  await expect(main.getByRole('spinbutton')).toHaveCount(0)
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
  await expect(page.getByRole('spinbutton')).toHaveCount(0)
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
