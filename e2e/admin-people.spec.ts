import { expect, test, type Browser, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { findUserByEmail } from '../scripts/create-admin.mjs'
import {
  adminClient,
  E2E_ADMIN,
  E2E_PASSWORD,
  ensureLinkedLogin,
  removeLoginAndProfile,
  SEED_MEMBER,
  SEED_MODERATOR,
  userClient,
} from './fixtures'
import { localSupabase } from './localSupabase'

// Phase 12 admin (decisions A1–A3): people management, removing a login,
// export, About. Runs last, after every other writing test
// (playwright.config.ts), so the export's counts can be checked against a
// database nobody else is changing. Everything it adds is removed afterwards.
const SCREENSHOTS = 'test-results/screenshots'
const EDITEE = { name: 'E2E Editee', renamed: 'E2E Edited' }
const LEAVER = { name: 'E2E Leaver', email: 'e2e-leaver@example.test', colour: '#45818e' }
const TABLES = [
  'profiles',
  'films',
  'attendance',
  'scores',
  'comments',
  'rotation_adjustments',
  'rotation_passes',
  'rotation_next',
  'app_settings',
  'user_settings',
  'suggestions',
  'suggestion_replies',
]

async function cleanUp() {
  const client = adminClient()
  const { data } = await client.from('profiles').select('id').eq('display_name', LEAVER.name)
  for (const { id } of data ?? []) {
    const { error } = await client.from('scores').delete().eq('profile_id', id)
    if (error) throw error
  }
  await removeLoginAndProfile(client, LEAVER.email, LEAVER.name)
  for (const name of [EDITEE.name, EDITEE.renamed]) {
    const { error } = await client.from('profiles').delete().eq('display_name', name)
    if (error) throw error
  }
}
test.describe.configure({ mode: 'default' })
test.beforeAll(cleanUp)
test.afterAll(cleanUp)
test.beforeEach(async () => {
  const { error } = await adminClient().from('rate_limits').delete().eq('bucket', 'invite-link')
  if (error) throw error
})

async function logIn(page: Page, email: string, password: string) {
  await page.goto('./#/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page.getByRole('heading', { name: 'Films', exact: true })).toBeVisible()
}

async function openAdmin(page: Page) {
  await logIn(page, E2E_ADMIN.email, E2E_PASSWORD)
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Admin' }).click()
  await expect(page.getByRole('heading', { name: 'Admin', level: 1 })).toBeVisible()
}

async function openFresh(browser: Browser, link: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage()
  await page.goto(link)
  return page
}

test('admin renames someone, changes their colour (with a clash warning) and role', async ({
  page,
}) => {
  const { error } = await adminClient()
    .from('profiles')
    .insert({ display_name: EDITEE.name, colour: '#c27ba0', role: 'viewer' })
  if (error) throw error
  await openAdmin(page)

  // The admin's own role can't be changed, with the reason given.
  await page.getByRole('button', { name: `Edit ${E2E_ADMIN.name}` }).click()
  const own = page.getByRole('dialog', { name: `Edit ${E2E_ADMIN.name}` })
  await expect(own.getByLabel('Role')).toBeDisabled()
  await expect(own.getByText("You can't change your own role")).toBeVisible()
  await own.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByRole('button', { name: `Edit ${E2E_ADMIN.name}` })).toBeFocused()
  await expect(
    page.getByRole('button', { name: `Remove login for ${E2E_ADMIN.name}` }),
  ).toHaveCount(0)

  await page.getByRole('button', { name: `Edit ${EDITEE.name}` }).click()
  const dialog = page.getByRole('dialog', { name: `Edit ${EDITEE.name}` })
  await dialog.getByLabel('Name').fill('kwame')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog.getByRole('alert')).toHaveText('Someone already has that name.')

  await dialog.getByLabel('Name').fill(`  ${EDITEE.renamed} `)
  // One step off the E2E admin's orange: warned, both swatches shown, still saved.
  await dialog.getByLabel('Hex code').fill('#e69139')
  const warning = dialog.getByText(/Hard to tell apart from/)
  await expect(warning).toContainText(`${E2E_ADMIN.name}'s colour (${E2E_ADMIN.colour})`)
  await expect(warning.locator('.clash-pair').first().locator('.colour-dot')).toHaveCount(2)
  await expect(dialog.getByLabel('Colour')).toHaveValue('#e69139')
  await page.screenshot({ path: `${SCREENSHOTS}/admin-edit-clash.png` })
  await dialog.getByLabel('Role').selectOption('moderator')
  await dialog.getByRole('button', { name: 'Save' }).click()

  await expect(page.getByText(`Saved ${EDITEE.name}.`)).toBeVisible()
  const row = page.getByRole('row').filter({ hasText: EDITEE.renamed })
  await expect(row).toContainText('Moderator')
  await expect(row.getByRole('link', { name: EDITEE.renamed })).toHaveCSS(
    'background-color',
    'rgb(230, 145, 57)',
  )
  await expect(page.getByRole('button', { name: `Edit ${EDITEE.renamed}` })).toBeFocused()

  // On a phone the dialog and the cards fit.
  await page.setViewportSize({ width: 375, height: 800 })
  await page.getByRole('button', { name: `Edit ${EDITEE.renamed}` }).click()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
  await page.screenshot({ path: `${SCREENSHOTS}/admin-edit-phone.png` })
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: `Edit ${EDITEE.renamed}` })).toBeFocused()
})

test('admin removes a login: history stays, old sessions end, they can be invited again', async ({
  page,
  browser,
}) => {
  const client = adminClient()
  await ensureLinkedLogin(client, { ...LEAVER, role: 'viewer' })
  const { data: leaver } = await client
    .from('profiles')
    .select('id')
    .eq('display_name', LEAVER.name)
    .single()
  const { error } = await client
    .from('scores')
    .insert({ film_id: 1, profile_id: leaver!.id, score: 6 })
  if (error) throw error

  const old = await openFresh(browser, './')
  await logIn(old, LEAVER.email, E2E_PASSWORD)

  await openAdmin(page)
  const row = page.getByRole('row').filter({ hasText: LEAVER.name })
  await expect(row).toContainText('Has a login')
  await page.getByRole('button', { name: `Remove login for ${LEAVER.name}` }).click()
  const dialog = page.getByRole('dialog', { name: `Remove ${LEAVER.name}'s login?` })
  await expect(dialog).toContainText('can invite them again')
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
  await dialog.getByRole('button', { name: 'Yes, remove login' }).click()
  await expect(page.getByText(`${LEAVER.name}'s login was removed.`)).toBeVisible()
  await expect(row).toContainText(/Login removed \d+ \w+ \d{4}/)
  await expect(page.getByRole('button', { name: `Create invite for ${LEAVER.name}` })).toBeFocused()

  expect(await findUserByEmail(client, LEAVER.email)).toBeFalsy()
  const { count } = await client
    .from('scores')
    .select('film_id', { count: 'exact', head: true })
    .eq('profile_id', leaver!.id)
  expect(count).toBe(1)
  // Their open browser gets nothing any more, and a reload sends it to the login page.
  await old.goto('./#/people')
  await expect(old.getByRole('heading', { name: 'People', exact: true })).toBeVisible()
  await expect(old.getByRole('main').getByRole('listitem')).toHaveCount(0)
  await old.reload()
  await expect(old.getByRole('heading', { name: 'Log in' })).toBeVisible()

  await page.getByRole('button', { name: `Create invite for ${LEAVER.name}` }).click()
  const link = await page.getByLabel('Link', { exact: true }).inputValue()
  const invitee = await openFresh(browser, link)
  await invitee.getByLabel('Email').fill(LEAVER.email)
  await invitee.getByLabel(/^Password/).fill(E2E_PASSWORD)
  await invitee.getByLabel('Confirm password').fill(E2E_PASSWORD)
  await invitee.getByRole('button', { name: 'Create account' }).click()
  await expect(invitee.getByRole('banner').getByText(LEAVER.name)).toBeVisible()
})

test('admin is reminded to export until they do; a member never is', async ({ page }) => {
  const reminder = page
    .getByRole('status')
    .filter({ hasText: 'No data export in the last 30 days' })
  const { error } = await adminClient().from('app_settings').delete().eq('key', 'last_export_at')
  if (error) throw error

  await logIn(page, SEED_MEMBER.email, SEED_MEMBER.password)
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
  await expect(reminder).toHaveCount(0)
  await page.getByRole('button', { name: 'Log out' }).click()

  await logIn(page, E2E_ADMIN.email, E2E_PASSWORD)
  await expect(reminder).toContainText('(last: never)')
  await reminder.getByRole('link', { name: 'Export it from the Admin page' }).click()
  await expect(page.getByRole('heading', { name: 'Admin', level: 1 })).toBeVisible()
  await expect(page.getByText('Last export: never')).toBeVisible()
  await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export all data' }).click(),
  ])
  await expect(reminder).toHaveCount(0)
  await expect(page.getByText(/^Last export: \d+ \w+ \d{4}$/)).toBeVisible()

  // Saved: still gone after a reload.
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Admin', level: 1 })).toBeVisible()
  await expect(page.getByText(/^Last export: \d+ \w+ \d{4}$/)).toBeVisible()
  await expect(reminder).toHaveCount(0)
})

test('admin exports all data: one zip with the complete JSON and a CSV per table', async ({
  page,
}) => {
  // The export then only updates last_export_at, so its row counts match the database's.
  const { error } = await adminClient()
    .from('app_settings')
    .upsert({ key: 'last_export_at', value: new Date().toISOString() })
  if (error) throw error
  await openAdmin(page)
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export all data' }).click(),
  ])
  expect(download.suggestedFilename()).toMatch(/^film-club-export-\d{4}-\d{2}-\d{2}\.zip$/)
  await expect(page.getByText(`Downloaded ${download.suggestedFilename()}.`)).toBeVisible()

  // Opened with Python's zipfile, which also checks every entry's CRC.
  const script = [
    'import json, sys, zipfile',
    'z = zipfile.ZipFile(sys.argv[1])',
    'assert z.testzip() is None',
    'print(json.dumps({i.filename: z.read(i).decode("utf-8") for i in z.infolist()}))',
  ].join('\n')
  const files: Record<string, string> = JSON.parse(
    execFileSync('python3', ['-I', '-c', script, await download.path()]).toString(),
  )
  expect(Object.keys(files).sort()).toEqual(
    ['film-club-export.json', ...TABLES.map((t) => `csv/${t}.csv`)].sort(),
  )
  const data = JSON.parse(files['film-club-export.json'])
  expect(data.format).toBe('film-club-export')
  expect(data.schema_version).toMatch(/^\d{14}$/)

  // Every table, every row: the same counts as the database.
  const client = adminClient()
  for (const table of TABLES) {
    const { count, error } = await client.from(table).select('*', { count: 'exact', head: true })
    if (error) throw error
    expect(data.row_counts[table], table).toBe(count)
    expect(data.tables[table], table).toHaveLength(count!)
    // Header (always, even for an empty table) + one line per row (no line breaks in the seed).
    const lines = files[`csv/${table}.csv`].split('\r\n').filter(Boolean)
    expect(lines.length, table).toBe(count! + 1)
  }
  // Nothing secret: no auth ids, emails or link tokens.
  const text = JSON.stringify(files)
  expect(text).not.toContain('auth_user_id')
  expect(text).not.toContain('@example.test')
  expect(text).not.toContain('token_hash')
  expect(files['csv/profiles.csv'].split('\r\n')[0]).toBe(
    '﻿id,display_name,sheet_keyword,colour,role,is_claimed,claimed_at,is_system,created_at,updated_at,login_removed_at',
  )
})

test('non-admins can do none of it', async ({ page }) => {
  for (const who of [SEED_MEMBER, SEED_MODERATOR]) {
    const client = userClient()
    const { data, error } = await client.auth.signInWithPassword(who)
    if (error) throw error
    const exported = await client.rpc('export_data')
    expect(exported.error?.code, who.email).toBe('42501')
    const promoted = await client
      .from('profiles')
      .update({ role: 'admin' })
      .eq('display_name', 'Viggo')
      .select('id')
    expect(promoted.data ?? [], who.email).toEqual([])
    const removed = await fetch(`${localSupabase().apiUrl}/functions/v1/admin-remove-login`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${data.session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ profile_id: '00000000-0000-4000-8000-0000000000a4' }),
    })
    expect(removed.status, who.email).toBe(403)
  }
  await logIn(page, SEED_MEMBER.email, SEED_MEMBER.password)
  await page.goto('./#/admin')
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Export all data' })).toHaveCount(0)
})

test('About credits TMDB with its bundled logo and notice', async ({ page }) => {
  await logIn(page, SEED_MEMBER.email, SEED_MEMBER.password)
  const about = page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'About' })
  await about.click()
  await expect(page.getByRole('heading', { name: 'About Film Club' })).toBeVisible()
  await expect(about).toHaveAttribute('aria-current', 'page')
  // The header nav fits a phone in every theme, nothing scrolls sideways.
  await page.setViewportSize({ width: 375, height: 800 })
  // Themes switched on the page only (the picker would save Kwame's choice to the database).
  for (const theme of ['superman', 'batman', 'letterboxd']) {
    await page.evaluate((t) => (document.documentElement.dataset.theme = t), theme)
    await expect(about).toBeInViewport()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
  }
  await page.setViewportSize({ width: 1280, height: 720 })
  await expect(
    page.getByText('This product uses the TMDB API but is not endorsed or certified by TMDB.'),
  ).toBeVisible()
  const logo = page.getByRole('img', { name: 'The Movie Database (TMDB)' })
  await expect
    .poll(() => logo.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0)
  expect(await logo.getAttribute('src')).not.toContain('themoviedb.org')
  await page.screenshot({ path: `${SCREENSHOTS}/about.png` })
})
