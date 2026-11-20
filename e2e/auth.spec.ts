import { expect, test, type Page } from '@playwright/test'
import {
  adminClient,
  E2E_ADMIN,
  E2E_MEMBER,
  E2E_PASSWORD,
  E2E_UNLINKED,
  ensureLinkedLogin,
  removeLoginAndProfile,
  userClient,
} from './fixtures'

const SCREENSHOTS = 'test-results/screenshots'

async function logIn(page: Page, email: string, password: string) {
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Log in' }).click()
}

test('logged-out visitors are sent to the login page', async ({ page }) => {
  await page.goto('./')
  await expect(page).toHaveURL(/\/film-club\/#\/login$/)
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible()
  await expect(page.getByText('Invite-only. Ask Manel for an invite.')).toBeVisible()
  await expect(page.getByRole('link')).toHaveCount(0)
  await page.screenshot({ path: `${SCREENSHOTS}/login.png` })

  await page.goto('./#/films/12')
  await expect(page).toHaveURL(/#\/login\?next=%2Ffilms%2F12$/)
})

test('admin logs in and sees the app shell', async ({ page }) => {
  await page.goto('./#/login')
  await logIn(page, E2E_ADMIN.email, E2E_PASSWORD)

  await expect(page).toHaveURL(/\/film-club\/#\/$/)
  const header = page.getByRole('banner')
  await expect(header.getByRole('link', { name: 'Film Club' })).toBeVisible()
  await expect(header.getByText(E2E_ADMIN.name)).toBeVisible()
  await expect(header.getByText('Admin', { exact: true })).toBeVisible()
  await expect(header.locator('.colour-dot')).toHaveCSS('background-color', 'rgb(230, 145, 56)')
  await expect(page.getByText('Films coming soon.')).toBeVisible()
  await page.screenshot({ path: `${SCREENSHOTS}/home-admin.png` })

  // The session survives a reload.
  await page.reload()
  await expect(header.getByText(E2E_ADMIN.name)).toBeVisible()
})

test('a wrong password shows a clear error', async ({ page }) => {
  await page.goto('./#/login')
  await logIn(page, E2E_ADMIN.email, 'not-the-password')
  await expect(page.getByRole('alert')).toHaveText('Wrong email or password.')
  await expect(page.getByLabel('Password')).toHaveValue('')
  await expect(page).toHaveURL(/#\/login$/)
  await page.screenshot({ path: `${SCREENSHOTS}/login-wrong-password.png` })
})

test('a network failure shows a connection error', async ({ page }) => {
  await page.route('**/auth/v1/token**', (route) => route.abort('internetdisconnected'))
  await page.goto('./#/login')
  await logIn(page, E2E_ADMIN.email, E2E_PASSWORD)
  await expect(page.getByRole('alert')).toContainText("Couldn't reach the server")
})

test('after logging in, the visitor returns to the page they asked for', async ({ page }) => {
  await page.goto('./#/films/12')
  await expect(page).toHaveURL(/#\/login\?next=/)
  await logIn(page, E2E_ADMIN.email, E2E_PASSWORD)
  await expect(page).toHaveURL(/#\/films\/12$/)
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
  await expect(page.getByRole('banner').getByText(E2E_ADMIN.name)).toBeVisible()
})

test('logging out returns to the login page and protects the app again', async ({ page }) => {
  await page.goto('./#/login')
  await logIn(page, E2E_ADMIN.email, E2E_PASSWORD)
  await expect(page.getByText('Films coming soon.')).toBeVisible()

  await page.getByRole('button', { name: 'Log out' }).click()
  await expect(page).toHaveURL(/#\/login$/)
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible()

  await page.goto('./#/')
  await expect(page).toHaveURL(/#\/login$/)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible()
})

test('a login without a profile sees the "not linked" page and can log out', async ({ page }) => {
  await page.goto('./#/login')
  await logIn(page, E2E_UNLINKED.email, E2E_PASSWORD)
  await expect(page.getByRole('heading', { name: "Your account isn't linked yet" })).toBeVisible()
  await expect(page.getByText(/Ask Manel to link it/)).toBeVisible()
  await expect(page.getByText('Films coming soon.')).toHaveCount(0)
  await page.screenshot({ path: `${SCREENSHOTS}/unlinked.png` })

  await page.getByRole('button', { name: 'Log out' }).click()
  await expect(page).toHaveURL(/#\/login$/)
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible()
})

test('a member sees the shell without a role badge', async ({ page }) => {
  await page.goto('./#/login')
  await logIn(page, E2E_MEMBER.email, E2E_PASSWORD)
  const header = page.getByRole('banner')
  await expect(header.getByText(E2E_MEMBER.name)).toBeVisible()
  await expect(header.locator('.badge')).toHaveCount(0)
  await expect(header.getByText(/^(Admin|Moderator)$/)).toHaveCount(0)
})

test.describe('the session is checked with the server', () => {
  // Each test uses its own throwaway login, since it deletes or revokes it.
  const client = adminClient()

  test('a login deleted on the server is sent to the login page on reload', async ({ page }) => {
    const account = {
      email: 'e2e-deleted@example.test',
      name: 'E2E Deleted',
      colour: '#999999',
      role: 'member',
    }
    const userId = await ensureLinkedLogin(client, account)
    try {
      await page.goto('./#/login')
      await logIn(page, account.email, E2E_PASSWORD)
      await expect(page.getByRole('banner').getByText(account.name)).toBeVisible()

      const { error } = await client.auth.admin.deleteUser(userId)
      expect(error).toBeNull()

      await page.reload()
      await expect(page).toHaveURL(/#\/login$/)
      await expect(page.getByText('Your session has ended. Please log in again.')).toBeVisible()
      await expect(page.getByText(account.name)).toHaveCount(0)
    } finally {
      await removeLoginAndProfile(client, account.email, account.name)
    }
  })

  test('a global sign-out elsewhere ends the session when the tab regains focus', async ({
    page,
  }) => {
    const account = {
      email: 'e2e-revoked@example.test',
      name: 'E2E Revoked',
      colour: '#888888',
      role: 'member',
    }
    await ensureLinkedLogin(client, account)
    try {
      await page.goto('./#/login')
      await logIn(page, account.email, E2E_PASSWORD)
      await expect(page.getByRole('banner').getByText(account.name)).toBeVisible()

      // "Log out everywhere" from another device.
      const elsewhere = userClient()
      const { error: signInError } = await elsewhere.auth.signInWithPassword({
        email: account.email,
        password: E2E_PASSWORD,
      })
      expect(signInError).toBeNull()
      const { error: signOutError } = await elsewhere.auth.signOut({ scope: 'global' })
      expect(signOutError).toBeNull()

      await page.evaluate(() => window.dispatchEvent(new Event('focus')))
      await expect(page).toHaveURL(/#\/login$/)
      await expect(page.getByText('Your session has ended. Please log in again.')).toBeVisible()

      await page.reload()
      await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible()
    } finally {
      await removeLoginAndProfile(client, account.email, account.name)
    }
  })
})
