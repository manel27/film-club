import { expect, test, type Page } from '@playwright/test'
import { adminClient, SEED_ADMIN, SEED_MODERATOR } from './fixtures'

// Adds and deletes a film in the shared local database, so this file runs in
// the writes project, after the tests that count films (playwright.config.ts).
const SCREENSHOTS = 'test-results/screenshots'
const TITLE = 'E2E Doomed Reel'
const KWAME = '00000000-0000-4000-8000-0000000000a3'
let filmId: number

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
    .insert({ title: TITLE, release_year: 1999, screened_on: '2026-12-05', assigned_id: KWAME })
    .select('id')
    .single()
  if (error) throw error
  filmId = data.id
  for (const { error } of await Promise.all([
    db.from('scores').insert({ film_id: filmId, profile_id: KWAME, score: 6.5 }),
    db.from('attendance').insert({ film_id: filmId, profile_id: KWAME }),
    db.from('comments').insert({ film_id: filmId, author_id: KWAME, body: 'Doomed.' }),
  ])) {
    if (error) throw error
  }
})
test.afterAll(removeFilm)

async function openFilm(page: Page, login: { email: string; password: string }) {
  await page.goto(`./#/login?next=%2Ffilms%2F${filmId}`)
  await page.getByLabel('Email').fill(login.email)
  await page.getByLabel('Password').fill(login.password)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page.getByRole('heading', { name: TITLE })).toBeVisible()
}

test('a moderator can edit a film but gets no Delete film', async ({ page }) => {
  await openFilm(page, SEED_MODERATOR)
  await expect(page.getByRole('link', { name: 'Edit' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Delete film' })).toHaveCount(0)
})

test('the admin deletes a film after confirming, with its scores, attendance and comments', async ({
  page,
}) => {
  await openFilm(page, SEED_ADMIN)
  await page.getByRole('button', { name: 'Delete film' }).click()
  const dialog = page.getByRole('dialog', { name: `Delete "${TITLE}"?` })
  await expect(dialog).toContainText('1 score')
  await expect(dialog).toContainText('1 attendance mark')
  await expect(dialog).toContainText('1 comment')
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
  await page.screenshot({ path: `${SCREENSHOTS}/delete-film.png`, fullPage: true })

  // Escape closes it and deletes nothing.
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('button', { name: 'Delete film' })).toBeFocused()

  await page.getByRole('button', { name: 'Delete film' }).click()
  await dialog.getByRole('button', { name: 'Yes, delete film' }).click()
  await expect(page.getByRole('heading', { name: 'Films', exact: true })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: `Deleted "${TITLE}".` })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: `Deleted "${TITLE}".` })).toBeFocused()
  // Wait for the list itself before checking the film is gone from it.
  await expect(page.getByText('The Quiet Orchard').first()).toBeVisible()
  await expect(page.getByText(TITLE)).toHaveCount(1) // only the notice
  // Shown once: not again after a reload.
  await page.reload()
  await expect(page.getByText('The Quiet Orchard').first()).toBeVisible()
  await expect(page.getByText(`Deleted "${TITLE}".`)).toHaveCount(0)

  const db = adminClient()
  for (const table of ['films', 'scores', 'attendance', 'comments']) {
    const { count, error } = await db
      .from(table)
      .select('*', { count: 'exact', head: true })
      .eq(table === 'films' ? 'id' : 'film_id', filmId)
    if (error) throw error
    expect(count, table).toBe(0)
  }
})
