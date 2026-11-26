import { expect, test, type Page } from '@playwright/test'
import { adminClient, SEED_MODERATOR } from './fixtures'

// Adds a film to the shared local database, so it runs after the read-only tests
// (playwright.config.ts: matches add-film) and removes it. Its own file:
// add-film.spec.ts's cleanup hooks run per worker and would delete this film mid-test.
const VOTE_TITLE = 'E2E Show Of Hands'

async function logIn(page: Page, login: { email: string; password: string }) {
  await page.goto('./#/login')
  await page.getByLabel('Email').fill(login.email)
  await page.getByLabel('Password').fill(login.password)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page.getByRole('heading', { name: 'Films', exact: true })).toBeVisible()
}

async function removeVoteFilm() {
  const { error } = await adminClient().from('films').delete().eq('title', VOTE_TITLE)
  if (error) throw error
}
test.beforeAll(removeVoteFilm)
test.afterAll(removeVoteFilm)

test("a Democrático's reason is saved, edited, and cleared when the kind changes", async ({
  page,
}) => {
  await logIn(page, SEED_MODERATOR)
  await page.goto('./#/films/new')
  await page.getByRole('button', { name: 'Not on TMDB? Save without TMDB' }).click()
  await page.getByLabel('Title').fill(VOTE_TITLE)
  await page.getByLabel('Release year').fill('2002')
  await page.getByLabel('Screening date').fill('2026-12-19')
  await page.getByLabel('Chosen by').selectOption({ label: 'Kwame' })
  const reason = page.getByLabel(/Why was it chosen/)
  await expect(reason).toHaveCount(0)
  await page.getByLabel('Kind').selectOption('democratico')
  await page.getByLabel(/Whose turn/).selectOption({ label: 'Yusuf' })
  await expect(reason).toHaveAttribute('maxlength', '200')
  // Invisible characters and extra spaces go.
  await reason.fill('  Hands ​  up, everyone ')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('heading', { name: VOTE_TITLE })).toBeVisible()
  await expect(page.getByText('Why: Hands up, everyone')).toBeVisible()

  // Edit: the form loads the reason.
  await page.getByRole('link', { name: 'Edit' }).click()
  await expect(reason).toHaveValue('Hands up, everyone')
  await reason.fill('Hands up, again')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('Why: Hands up, again')).toBeVisible()

  // Another kind hides the field and saves no reason (switching back first keeps the text).
  await page.getByRole('link', { name: 'Edit' }).click()
  await page.getByLabel('Kind').selectOption('normal')
  await expect(reason).toHaveCount(0)
  await page.getByLabel('Kind').selectOption('democratico')
  await expect(reason).toHaveValue('Hands up, again')
  await page.getByLabel('Kind').selectOption('normal')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('heading', { name: VOTE_TITLE })).toBeVisible()
  await expect(page.getByText(/Why:|Unknown reason/)).toHaveCount(0)
  const { data } = await adminClient()
    .from('films')
    .select('kind, democratico_reason')
    .eq('title', VOTE_TITLE)
    .single()
  expect(data).toEqual({ kind: 'normal', democratico_reason: null })
})
