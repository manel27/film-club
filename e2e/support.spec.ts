import { expect, test, type Page } from '@playwright/test'
import {
  adminClient,
  SEED_ADMIN,
  SEED_MEMBER,
  SEED_MEMBER2,
  SEED_MODERATOR,
  SEED_VIEWER,
  userClient,
} from './fixtures'

// The suggestion box (phase 16c) end to end, with the seed's logins. Everything
// it writes is titled "E2E …" and removed afterwards (replies go by cascade).
const IDEA = 'E2E Member idea'
const THROWAWAY = 'E2E Throwaway'
const VIEWER_IDEA = 'E2E Viewer idea'

test.describe.configure({ mode: 'serial' })

async function cleanUp() {
  const { error } = await adminClient().from('suggestions').delete().like('title', 'E2E %')
  if (error) throw error
}
test.beforeAll(cleanUp)
test.afterAll(cleanUp)

async function ideaId(title = IDEA): Promise<number> {
  const { data, error } = await adminClient()
    .from('suggestions')
    .select('id')
    .eq('title', title)
    .single()
  if (error) throw error
  return data.id
}

async function logIn(page: Page, login: { email: string; password: string }, next = '/support') {
  await page.goto(`./#/login?next=${encodeURIComponent(next)}`)
  await page.getByLabel('Email').fill(login.email)
  await page.getByLabel('Password').fill(login.password)
  await page.getByRole('button', { name: 'Log in' }).click()
}

async function write(page: Page, title: string, text: string) {
  await page.getByLabel('Title').fill(title)
  await page.getByLabel('Your suggestion').fill(text)
  await page.getByRole('button', { name: 'Send' }).click()
  await expect(page.getByRole('status').filter({ hasText: `Sent "${title}".` })).toBeFocused()
}

test('a member writes suggestions, sees only theirs, and deletes one before any reply', async ({
  page,
}) => {
  await logIn(page, SEED_MEMBER, '/')
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Support' })
    .click()
  await expect(page.getByRole('heading', { name: 'Support', level: 1 })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Your suggestions' })).toBeVisible()
  // Their seeded one, not the viewer's.
  await expect(page.getByRole('link', { name: 'Subtitles for every film' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Runtime on the poster list' })).toHaveCount(0)

  await write(page, IDEA, 'A popcorn machine for the club.')
  await expect(page.getByRole('link', { name: IDEA })).toBeVisible()
  await write(page, THROWAWAY, 'Never mind.')

  await page.getByRole('link', { name: THROWAWAY }).click()
  await expect(page.getByRole('heading', { name: THROWAWAY, level: 1 })).toBeVisible()
  page.once('dialog', (d) => void d.accept())
  await page.getByRole('button', { name: 'Delete suggestion' }).click()
  await expect(page.getByRole('heading', { name: 'Support', level: 1 })).toBeVisible()
  await expect(
    page.getByRole('status').filter({ hasText: `Deleted "${THROWAWAY}".` }),
  ).toBeFocused()
  await expect(page.getByRole('link', { name: THROWAWAY })).toHaveCount(0)
})

test('another member sees nothing of it, not even by its address', async ({ page }) => {
  const id = await ideaId()
  await logIn(page, SEED_MEMBER2)
  await expect(page.getByText("You haven't written any suggestions yet.")).toBeVisible()
  await page.goto(`./#/support/${id}`)
  await expect(page.getByRole('heading', { name: 'Suggestion not found' })).toBeVisible()
  await expect(page.getByText('A popcorn machine')).toHaveCount(0)
})

test('a moderator sees every suggestion with its author and replies', async ({ page }) => {
  await logIn(page, SEED_MODERATOR)
  await expect(page.getByRole('heading', { name: 'All suggestions' })).toBeVisible()
  const item = page.getByRole('listitem').filter({ hasText: IDEA })
  await expect(item.getByRole('link', { name: 'Kwame' })).toBeVisible()
  await expect(item).toContainText('0 replies')
  await expect(page.getByRole('link', { name: 'Runtime on the poster list' })).toBeVisible()

  await item.getByRole('link', { name: IDEA }).click()
  await expect(page.getByText('A popcorn machine for the club.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Delete suggestion' })).toHaveCount(0)
  await page.getByLabel('Reply').fill('E2E: we will look into it.')
  await page.getByRole('button', { name: 'Send reply' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Reply sent.' })).toBeFocused()
  await expect(
    page.getByRole('listitem').filter({ hasText: 'we will look into it' }),
  ).toContainText('Tamsin')
})

test('the author replies, and can no longer delete after the staff reply', async ({ page }) => {
  await logIn(page, SEED_MEMBER, `/support/${await ideaId()}`)
  await expect(page.getByText('E2E: we will look into it.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Delete suggestion' })).toHaveCount(0)
  await page.getByLabel('Reply').fill('E2E: thanks!')
  await page.getByRole('button', { name: 'Send reply' }).click()
  await expect(page.getByText('E2E: thanks!')).toBeVisible()

  // The database refuses it too, not just the page.
  const client = userClient()
  const { error: loginError } = await client.auth.signInWithPassword(SEED_MEMBER)
  if (loginError) throw loginError
  const { error } = await client
    .from('suggestions')
    .delete()
    .eq('id', await ideaId())
  expect(error?.message).toBe('This suggestion has a reply, so it can no longer be deleted')
})

test('the admin deletes any suggestion, replies and all', async ({ page }) => {
  const id = await ideaId()
  await logIn(page, SEED_ADMIN, `/support/${id}`)
  await expect(page.getByText('E2E: thanks!')).toBeVisible()
  page.once('dialog', (d) => void d.accept())
  await page.getByRole('button', { name: 'Delete suggestion' }).click()
  await expect(page.getByRole('status').filter({ hasText: `Deleted "${IDEA}".` })).toBeFocused()
  await expect(page.getByRole('link', { name: IDEA })).toHaveCount(0)
  const { count } = await adminClient()
    .from('suggestion_replies')
    .select('id', { count: 'exact', head: true })
    .eq('suggestion_id', id)
  expect(count).toBe(0)
})

test('a viewer writes a suggestion and replies in their own thread', async ({ page }) => {
  await logIn(page, SEED_VIEWER)
  await expect(page.getByRole('link', { name: 'Runtime on the poster list' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Subtitles for every film' })).toHaveCount(0)
  await write(page, VIEWER_IDEA, 'Bigger subtitles, please.')
  await page.getByRole('link', { name: VIEWER_IDEA }).click()
  await page.getByLabel('Reply').fill('E2E: and a darker room.')
  await page.getByRole('button', { name: 'Send reply' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Reply sent.' })).toBeFocused()
  await expect(page.getByText('E2E: and a darker room.')).toBeVisible()
  // Only their own reply: they can still delete it.
  await expect(page.getByRole('button', { name: 'Delete suggestion' })).toBeVisible()
})
