import { expect, test } from '@playwright/test'
import { SEED_ADMIN } from './fixtures'

// Every main page fits a 360px phone in every theme: no page-level sideways scroll.
const PAGES = ['/', '/films/1', '/rotation', '/people', 'profile', '/admin', '/about']
const THEMES = ['letterboxd', 'superman', 'batman']

test('the main pages fit a 360px screen in every theme', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 })
  await page.goto('./#/login')
  await page.getByLabel('Email').fill(SEED_ADMIN.email)
  await page.getByLabel('Password').fill(SEED_ADMIN.password)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page.getByRole('heading', { name: 'Films', exact: true })).toBeVisible()

  for (const path of PAGES) {
    if (path === 'profile') {
      await page.goto('./#/people')
      await page.getByRole('main').getByRole('link', { name: 'Kwame' }).click()
    } else {
      await page.goto(`./#${path}`)
    }
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await page.waitForLoadState('networkidle')
    for (const theme of THEMES) {
      // Set on the page only: the picker would save the admin's choice to the database.
      await page.evaluate((t) => (document.documentElement.dataset.theme = t), theme)
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect(overflow, `${path} in ${theme}`).toBe(0)
    }
  }
})
