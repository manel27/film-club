import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider, type InitialEntry } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '../auth/AuthProvider'
import RequireAuth from '../auth/RequireAuth'
import type { Person } from '../films/films'
import type { SuggestionSummary } from '../support/api'
import { createFakeAuthBackend, fakeProfile, fakeSession } from '../test/fakeAuthBackend'
import SupportPage from './SupportPage'

const PEOPLE: Person[] = [
  { id: 'profile-1', name: 'Quinn', colour: '#4a86e8', isSystem: false, role: 'member' },
  { id: 'p-ada', name: 'Ada', colour: '#ffd200', isSystem: false, role: 'viewer' },
]
const summary = (over: Partial<SuggestionSummary> = {}): SuggestionSummary => ({
  id: 7,
  author_id: 'p-ada',
  title: 'More subtitles',
  created_at: '2026-11-20T20:00:00Z',
  closed_at: null,
  replies: 1,
  ...over,
})
type List = { suggestions: SuggestionSummary[]; people: Person[] }
const list = (...suggestions: SuggestionSummary[]): List => ({ suggestions, people: PEOPLE })

const api = vi.hoisted(() => ({
  fetchSuggestions: vi.fn<() => Promise<List>>(),
  addSuggestion: vi.fn<(title: string, body: string) => Promise<number>>(),
}))
vi.mock('../support/api', () => ({
  fetchSuggestions: () => api.fetchSuggestions(),
  supportWrites: { addSuggestion: api.addSuggestion },
}))

async function renderPage(
  role: 'admin' | 'moderator' | 'member' | 'viewer' = 'member',
  entry: InitialEntry = '/support',
) {
  const router = createMemoryRouter(
    [
      {
        path: '/support',
        element: (
          <RequireAuth>
            <SupportPage />
          </RequireAuth>
        ),
      },
      { path: '/support/:id', element: <p>Suggestion page</p> },
    ],
    { initialEntries: [entry] },
  )
  const fake = createFakeAuthBackend({ session: fakeSession(), profile: fakeProfile({ role }) })
  render(
    <AuthProvider backend={fake.backend}>
      <RouterProvider router={router} />
    </AuthProvider>,
  )
  await screen.findByRole('heading', { name: 'Support', level: 1 })
  return router
}

/** A promise resolved by hand, to control the order responses land in. */
function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

const fill = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } })

beforeEach(() => {
  vi.clearAllMocks()
  api.fetchSuggestions.mockResolvedValue(list(summary({ author_id: 'profile-1' })))
  api.addSuggestion.mockResolvedValue(8)
})

describe('Support page', () => {
  it('shows a viewer their own suggestions, with date and reply count but no author chip', async () => {
    await renderPage('viewer')
    expect(screen.getByRole('heading', { name: 'Support', level: 1 })).toBeInTheDocument()
    expect(
      screen.getByText(/Only you, the moderators and the admin can see what you write here/),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Your suggestions' })).toBeInTheDocument()
    const link = await screen.findByRole('link', { name: 'More subtitles' })
    expect(link).toHaveAttribute('href', '/support/7')
    const item = link.closest('li')!
    expect(item).toHaveTextContent('20 Nov 2026 · 1 reply')
    expect(within(item).queryByText('Quinn')).not.toBeInTheDocument()
  })

  it("shows staff everyone's suggestions with the author's name chip", async () => {
    api.fetchSuggestions.mockResolvedValue(list(summary(), summary({ id: 9, replies: 0 })))
    await renderPage('moderator')
    expect(screen.getByRole('heading', { name: 'All suggestions' })).toBeInTheDocument()
    const items = await screen.findAllByRole('listitem')
    expect(within(items[0]).getByRole('link', { name: 'Ada' })).toHaveAttribute(
      'href',
      '/people/p-ada',
    )
    expect(items[1]).toHaveTextContent('0 replies')
  })

  it.each([
    ['member', "You haven't written any suggestions yet."],
    ['admin', 'No suggestions yet.'],
  ] as const)('shows an empty state to a %s', async (role, text) => {
    api.fetchSuggestions.mockResolvedValue(list())
    await renderPage(role)
    expect(await screen.findByText(text)).toBeInTheDocument()
  })

  it('shows a loading state, then a load failure with a way to try again', async () => {
    let fail!: (e: unknown) => void
    // Created on the page's call, so the rejection always has the page's handler attached.
    api.fetchSuggestions.mockImplementationOnce(() => new Promise((_, reject) => (fail = reject)))
    await renderPage()
    expect(screen.getByText('Loading suggestions…')).toBeInTheDocument()
    await waitFor(() => expect(api.fetchSuggestions).toHaveBeenCalledTimes(1))
    await act(async () => fail(new TypeError('fetch failed')))
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load the suggestions")
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('link', { name: 'More subtitles' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('sends the normalised title and text, clears the form, announces and focuses a status, reloads', async () => {
    await renderPage()
    await screen.findByRole('link', { name: 'More subtitles' })
    api.fetchSuggestions.mockResolvedValue(
      list(summary({ id: 8, title: 'Popcorn', author_id: 'profile-1', replies: 0 })),
    )
    fill('Title', '  Pop\u200bcorn ')
    fill('Your suggestion', 'Salted, \r\n\r\n\r\nplease ')
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    const status = await screen.findByText('Sent "Popcorn".')
    expect(status).toHaveAttribute('role', 'status')
    expect(status).toHaveFocus()
    // Line breaks stay in the text (at most one blank line); the title is one line.
    expect(api.addSuggestion).toHaveBeenCalledWith('Popcorn', 'Salted,\n\nplease')
    expect(screen.getByLabelText('Title')).toHaveValue('')
    expect(screen.getByLabelText('Your suggestion')).toHaveValue('')
    expect(await screen.findByRole('link', { name: 'Popcorn' })).toBeInTheDocument()
    expect(api.fetchSuggestions).toHaveBeenCalledTimes(2)
  })

  it('refuses a blank title or text, or one that is too long, before sending', async () => {
    await renderPage()
    await screen.findByRole('link', { name: 'More subtitles' })
    fill('Title', '\u200b  ')
    fill('Your suggestion', 'Text')
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Give your suggestion a title.')
    expect(screen.getByLabelText('Title')).toHaveFocus()
    expect(screen.getByLabelText('Title')).toHaveAccessibleDescription(
      '0/100 Give your suggestion a title.',
    )

    fill('Title', 'a'.repeat(101))
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Keep it to 100 characters or fewer.')

    fill('Title', 'Fine')
    fill('Your suggestion', ' \n ')
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Write your suggestion.')
    expect(screen.getByLabelText('Your suggestion')).toHaveFocus()

    fill('Your suggestion', 'b'.repeat(2001))
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Keep it to 2000 characters or fewer.')
    expect(api.addSuggestion).not.toHaveBeenCalled()
  })

  it('clears a stale "Sent" status when the next attempt is refused', async () => {
    await renderPage()
    fill('Title', 'First')
    fill('Your suggestion', 'Text')
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByText('Sent "First".')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Give your suggestion a title.')
    expect(screen.queryByText('Sent "First".')).not.toBeInTheDocument()
  })

  it('counts characters as saved', async () => {
    await renderPage()
    fill('Title', ' 😀\u200b ')
    expect(screen.getByText('1/100')).toBeInTheDocument()
    fill('Your suggestion', 'a \n\n\n b')
    expect(screen.getByText('4/2000')).toBeInTheDocument()
  })

  it('sends once for a double click, with the button disabled meanwhile', async () => {
    const sending = deferred<number>()
    api.addSuggestion.mockReturnValueOnce(sending.promise)
    await renderPage()
    fill('Title', 'Once')
    fill('Your suggestion', 'Only once')
    const send = screen.getByRole('button', { name: 'Send' })
    fireEvent.click(send)
    fireEvent.click(send)
    expect(screen.getByRole('button', { name: 'Sending…' })).toBeDisabled()
    await act(async () => sending.resolve(8))
    expect(api.addSuggestion).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole('button', { name: 'Send' })).toBeEnabled()
  })

  it('keeps what was typed and says why when sending fails', async () => {
    api.addSuggestion.mockRejectedValueOnce({ code: '42501', message: 'row-level security' })
    await renderPage()
    fill('Title', 'Refused')
    fill('Your suggestion', 'Text')
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("You can't change that.")
    expect(screen.getByLabelText('Title')).toHaveValue('Refused')
  })

  it('never lets a slow earlier load overwrite a newer one', async () => {
    const first = deferred<List>()
    api.fetchSuggestions.mockReturnValueOnce(first.promise)
    await renderPage()
    api.fetchSuggestions.mockResolvedValueOnce(list(summary({ id: 8, title: 'Newer' })))
    fill('Title', 'Newer')
    fill('Your suggestion', 'Text')
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByRole('link', { name: 'Newer' })).toBeInTheDocument()
    await act(async () => first.resolve(list(summary({ title: 'Stale' }))))
    expect(screen.queryByRole('link', { name: 'Stale' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Newer' })).toBeInTheDocument()
  })

  it('shows and focuses the notice it was opened with (after a delete), once', async () => {
    const replace = vi.spyOn(window.history, 'replaceState')
    await renderPage('member', { pathname: '/support', state: { notice: 'Deleted "Old idea".' } })
    const notice = await screen.findByText('Deleted "Old idea".')
    await waitFor(() => expect(notice).toHaveFocus())
    // Dropped from the history entry, so a reload or Back doesn't show it again.
    expect(replace).toHaveBeenCalledWith(expect.objectContaining({ usr: null }), '')
    replace.mockRestore()
  })

  it("shows each suggestion's state, open ones first, then closed, newest first within each", async () => {
    api.fetchSuggestions.mockResolvedValue(
      list(
        summary({ id: 9, title: 'Newest, closed', closed_at: '2026-11-25T10:00:00Z' }),
        summary({ id: 8, title: 'Newer, open' }),
        summary({ id: 7, title: 'Oldest, open' }),
      ),
    )
    await renderPage('moderator')
    await screen.findByRole('link', { name: 'Newer, open' })
    const items = screen.getAllByRole('listitem')
    expect(items.map((i) => within(i).getAllByRole('link')[0].textContent)).toEqual([
      'Newer, open',
      'Oldest, open',
      'Newest, closed',
    ])
    expect(within(items[0]).getByText('Open')).toHaveClass('badge')
    expect(within(items[2]).getByText('Closed')).toHaveClass('badge', 'badge-muted')
  })

  it('filters by state, kept in the URL; an unknown value shows all', async () => {
    api.fetchSuggestions.mockResolvedValue(
      list(
        summary({ id: 9, title: 'Done', closed_at: '2026-11-25T10:00:00Z' }),
        summary({ id: 8, title: 'Todo' }),
      ),
    )
    const router = await renderPage('member', '/support?show=closed')
    expect(await screen.findByRole('link', { name: 'Done' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Todo' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Show')).toHaveValue('closed')

    fireEvent.change(screen.getByLabelText('Show'), { target: { value: 'open' } })
    expect(router.state.location.search).toBe('?show=open')
    expect(screen.getByRole('link', { name: 'Todo' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Done' })).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Show'), { target: { value: 'all' } })
    expect(router.state.location.search).toBe('')
    expect(screen.getAllByRole('listitem')).toHaveLength(2)

    await act(() => router.navigate('/support?show=%E2%80%8Bopen'))
    expect(screen.getByLabelText('Show')).toHaveValue('all')
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })

  it('says when the filter leaves nothing to show', async () => {
    await renderPage('member', '/support?show=closed')
    expect(await screen.findByText('No closed suggestions.')).toBeInTheDocument()
  })
})
