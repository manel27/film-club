import { expect, test, type Page } from '@playwright/test'
import { adminClient, SEED_MEMBER, SEED_MODERATOR, userClient } from './fixtures'
import { tmdbStubRequests } from './tmdbStub'

// Adds films to the shared local database, so this file runs on its own after
// the others (playwright.config.ts) and removes what it added. TMDB is the
// stub in tmdbStub.ts.
const SCREENSHOTS = 'test-results/screenshots'
const STUB_TITLE = 'E2E Lighthouse Keeper'

async function logIn(page: Page, login: { email: string; password: string }) {
  await page.goto('./#/login')
  await page.getByLabel('Email').fill(login.email)
  await page.getByLabel('Password').fill(login.password)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page.getByRole('heading', { name: 'Films', exact: true })).toBeVisible()
}

async function removeStubFilm() {
  const { error } = await adminClient().from('films').delete().eq('title', STUB_TITLE)
  if (error) throw error
}
test.beforeAll(removeStubFilm)
test.afterAll(removeStubFilm)

test('a moderator adds a film from TMDB; watched films cannot be picked', async ({ page }) => {
  const stubRequestsBefore = await tmdbStubRequests()
  await logIn(page, SEED_MODERATOR)
  await page.getByRole('link', { name: 'Add film' }).click()
  await expect(page.getByRole('heading', { name: 'Add film' })).toBeVisible()

  const search = page.getByLabel('Search TMDB')
  await search.fill('the quiet')
  const watched = page.getByRole('button', { name: /The Quiet Orchard/ })
  await expect(watched).toHaveAttribute('aria-disabled', 'true')
  await expect(watched).toContainText('Already watched on 2026/01/10')
  await expect(page.getByRole('status')).toHaveText('1 match on TMDB.')

  await search.fill('lighthouse')
  await page.getByRole('button', { name: /E2E Lighthouse Keeper \(2014\)/ }).click()
  await page.getByLabel('Screening date').fill('2026-12-19')
  await page.getByLabel('Chosen by').selectOption({ label: 'Kwame' })
  await page.screenshot({ path: `${SCREENSHOTS}/add-film.png`, fullPage: true })
  await page.getByRole('button', { name: 'Save' }).click()

  await expect(page.getByRole('heading', { name: STUB_TITLE })).toBeVisible()
  await expect(page.getByText('O Faroleiro')).toBeVisible()
  await expect(page.getByText('Stub Director')).toBeVisible()
  await expect(page.getByText('2026/12/19')).toBeVisible()
  // Search and details came from the stub: a run against real TMDB fails here.
  expect(await tmdbStubRequests()).toBeGreaterThan(stubRequestsBefore + 2)

  // Edit: change the date.
  await page.getByRole('link', { name: 'Edit' }).click()
  await expect(page.getByRole('heading', { name: 'Edit film' })).toBeVisible()
  await page.getByLabel('Screening date').fill('2026-12-26')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('2026/12/26')).toBeVisible()
})

test('a duplicate saved without TMDB is blocked', async ({ page }) => {
  await logIn(page, SEED_MODERATOR)
  await page.goto('./#/films/new')
  await page.getByRole('button', { name: 'Not on TMDB? Save without TMDB' }).click()
  await page.getByLabel('Title').fill('The quiet orchard!')
  await page.getByLabel('Release year').fill('2019')
  await expect(page.getByRole('alert')).toContainText('Already watched on 2026/01/10')
  await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled()
})

test('a member gets no Add film or Edit, and the server refuses them', async ({ page }) => {
  await logIn(page, SEED_MEMBER)
  await expect(page.getByRole('link', { name: 'Add film' })).toHaveCount(0)
  await page.goto('./#/films/1')
  await expect(page.getByRole('heading', { name: 'The Quiet Orchard' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Edit' })).toHaveCount(0)
  await page.goto('./#/films/new')
  await expect(page.getByRole('alert')).toHaveText(
    'Only moderators and admins can add or edit films.',
  )

  // Straight to the Edge Function, as a member: refused.
  const client = userClient()
  const { error: loginError } = await client.auth.signInWithPassword(SEED_MEMBER)
  if (loginError) throw loginError
  const { error } = await client.functions.invoke('film-save', {
    body: {
      tmdb_id: null,
      title: 'Member Sneaks In',
      release_year: 2000,
      screened_on: '2026-12-19',
      kind: 'normal',
      assigned_id: '00000000-0000-4000-8000-0000000000a3',
    },
  })
  expect((error as { context?: Response } | null)?.context?.status).toBe(403)
  const { count } = await adminClient()
    .from('films')
    .select('id', { count: 'exact', head: true })
    .eq('title', 'Member Sneaks In')
  expect(count).toBe(0)
})
