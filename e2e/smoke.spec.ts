import { expect, test } from '@playwright/test'

test('home page renders under the Pages base path', async ({ page }) => {
  await page.goto('./')
  await expect(page).toHaveTitle('Film Club')
  await expect(page.getByRole('heading', { name: 'Film Club' })).toBeVisible()
  await expect(page.getByText('Coming soon.')).toBeVisible()
})

test('unknown hash routes show the 404 page', async ({ page }) => {
  await page.goto('./#/nope')
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
})

test('the 404 page links back home', async ({ page }) => {
  await page.goto('./#/nope')
  await page.getByRole('link', { name: 'Back to the home page' }).click()
  await expect(page).toHaveURL(/\/film-club\/#\/$/)
  await expect(page.getByRole('heading', { name: 'Film Club' })).toBeVisible()
})
