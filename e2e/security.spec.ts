import { expect, test, type Page } from '@playwright/test'
import { SEED_VIEWER, userClient } from './fixtures'

// The production build's meta CSP, frame guard and referrer policy (SECURITY.md S5)
// and that a session is never taken from the URL fragment (S9).

// 1x1 transparent PNG, served in place of real TMDB posters.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
)

/** Collects CSP violations (DOM events and console reports) for the whole page life. */
async function watchCsp(page: Page): Promise<() => Promise<string[]>> {
  const console: string[] = []
  page.on('console', (m) => {
    if (/Content Security Policy/i.test(m.text())) console.push(m.text())
  })
  await page.addInitScript(() => {
    const w = window as unknown as { cspViolations: string[] }
    w.cspViolations = []
    document.addEventListener('securitypolicyviolation', (e) =>
      w.cspViolations.push(`${e.violatedDirective} ${e.blockedURI}`),
    )
  })
  return async () => [
    ...console,
    ...(await page.evaluate(
      () => (window as unknown as { cspViolations: string[] }).cspViolations,
    )),
  ]
}

test('key pages load under the CSP with no violations, posters included', async ({ page }) => {
  const violations = await watchCsp(page)
  const posterReferers: (string | undefined)[] = []
  await page.route('https://image.tmdb.org/**', (route) => {
    posterReferers.push(route.request().headers()['referer'])
    return route.fulfill({ contentType: 'image/png', body: PNG })
  })
  // Give film 1 a poster (the seed has none) without writing to the database.
  const withPoster = (f: object) => ({ ...f, poster_path: '/e2e-poster.jpg' })
  await page.route(
    (url) => url.pathname.endsWith('/rest/v1/films') && url.searchParams.get('id') === 'eq.1',
    async (route) => {
      const response = await route.fetch()
      const body = await response.json()
      const json = Array.isArray(body) ? body.map(withPoster) : withPoster(body)
      await route.fulfill({ response, json })
    },
  )

  await page.goto('./#/login?next=%2Ffilms%2F1')
  const policy = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute('content')
  expect(policy).toContain("script-src 'self' 'sha256-")
  expect(policy).toContain("object-src 'none'")
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer')

  await page.getByLabel('Email').fill(SEED_VIEWER.email)
  await page.getByLabel('Password').fill(SEED_VIEWER.password)
  await page.getByRole('button', { name: 'Log in' }).click()
  const poster = page.getByRole('img', { name: 'Poster of The Quiet Orchard' })
  await expect(poster).toBeVisible()
  await expect.poll(() => poster.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1)
  expect(posterReferers).toEqual([undefined])

  for (const [path, heading] of [
    ['./#/', 'Films'],
    ['./#/rotation', 'Rotation'],
    ['./#/people', 'People'],
  ]) {
    await page.goto(path)
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible()
    expect(await violations()).toEqual([])
  }
})

test('the app stays hidden inside a frame', async ({ page }) => {
  await page.goto('./')
  await expect(page.locator('html')).not.toHaveCSS('display', 'none')
  // Framed by itself: the guard only checks top === self, so the origin doesn't
  // matter (Chromium won't let a routed "public" page frame localhost at all).
  await page.evaluate(() => {
    const frame = document.createElement('iframe')
    frame.src = location.href
    document.body.append(frame)
  })
  const frame = page.frameLocator('iframe')
  await expect(frame.locator('#root')).toBeAttached()
  await expect(frame.locator('html')).toHaveCSS('display', 'none')
})

test('a session in the URL fragment is ignored', async ({ page }) => {
  const { data, error } = await userClient().auth.signInWithPassword(SEED_VIEWER)
  if (error) throw error
  const { access_token, refresh_token, expires_in } = data.session
  await page.goto(
    `./#access_token=${access_token}&refresh_token=${refresh_token}&expires_in=${expires_in}&token_type=bearer&type=magiclink`,
  )
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible()
  const keys = await page.evaluate(() => Object.keys(localStorage))
  expect(keys.filter((k) => k.endsWith('-auth-token'))).toEqual([])
})
