import { expect, test } from '@playwright/test'

test('the app renders under the Pages base path', async ({ page }) => {
  await page.goto('./')
  await expect(page).toHaveTitle('Film Club')
  await expect(page.getByRole('heading', { name: 'Film Club' })).toBeVisible()
})

test('unknown hash routes are protected too', async ({ page }) => {
  await page.goto('./#/nope')
  await expect(page).toHaveURL(/#\/login\?next=%2Fnope$/)
})
