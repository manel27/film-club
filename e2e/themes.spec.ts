import { expect, test } from '@playwright/test'
import { E2E_MEMBER, E2E_PASSWORD } from './fixtures'

const SCREENSHOTS = 'test-results/screenshots'

// Background colour of each theme's --bg token.
const BACKGROUNDS = {
  superman: 'rgb(247, 246, 240)',
  batman: 'rgb(26, 26, 29)',
  letterboxd: 'rgb(21, 26, 31)',
}

test('a member switches themes and the choice survives a reload', async ({ page }) => {
  await page.goto('./#/login')
  await page.getByLabel('Email').fill(E2E_MEMBER.email)
  await page.getByLabel('Password').fill(E2E_PASSWORD)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page.getByText('Films coming soon.')).toBeVisible()

  const picker = page.getByRole('banner').getByLabel('Theme')
  const html = page.locator('html')
  for (const [theme, background] of Object.entries(BACKGROUNDS)) {
    await picker.selectOption(theme)
    await expect(html).toHaveAttribute('data-theme', theme)
    await expect(html).toHaveCSS('background-color', background)
    await page.screenshot({ path: `${SCREENSHOTS}/theme-${theme}.png` })
  }

  // Saved in user_settings, not only on this device: clear localStorage first.
  const saved = page.waitForResponse(
    (r) => r.url().includes('/rest/v1/user_settings') && r.request().method() === 'POST',
  )
  await picker.selectOption('batman')
  expect((await saved).ok()).toBe(true)
  await page.evaluate(() => localStorage.removeItem('film-club-theme'))
  await page.reload()
  await expect(picker).toHaveValue('batman')
  await expect(html).toHaveAttribute('data-theme', 'batman')
})
