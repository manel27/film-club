import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '../auth/AuthProvider'
import RequireAuth from '../auth/RequireAuth'
import type { Person } from '../films/films'
import type { Suggestion } from '../support/api'
import { createFakeAuthBackend, fakeProfile, fakeSession } from '../test/fakeAuthBackend'
import SuggestionPage from './SuggestionPage'

const ME = 'profile-1' // fakeProfile's id
const PEOPLE: Person[] = [
  { id: ME, name: 'Quinn', colour: '#4a86e8', isSystem: false, role: 'member' },
  { id: 'p-mod', name: 'Tam', colour: '#6aa84f', isSystem: false, role: 'moderator' },
  { id: 'p-other', name: 'Ada', colour: '#ffd200', isSystem: false, role: 'member' },
]
const reply = (id: number, author_id: string, body: string, created_at: string) => ({
  id,
  author_id,
  body,
  created_at,
})
const suggestion = (over: Partial<Suggestion> = {}): Suggestion => ({
  id: 7,
  author_id: ME,
  title: 'More subtitles',
  body: 'For every film, please.',
  created_at: '2026-11-20T20:00:00Z',
  closed_at: null,
  closed_by: null,
  suggestion_replies: [],
  ...over,
})
type Data = { suggestion: Suggestion; people: Person[] } | null
const data = (over: Partial<Suggestion> = {}): Data => ({
  suggestion: suggestion(over),
  people: PEOPLE,
})

const api = vi.hoisted(() => ({
  fetchSuggestion: vi.fn<(id: number) => Promise<Data>>(),
  addReply: vi.fn<(id: number, body: string) => Promise<void>>(),
  deleteSuggestion: vi.fn<(id: number) => Promise<void>>(),
  setClosed: vi.fn<(id: number, closed: boolean) => Promise<void>>(),
}))
vi.mock('../support/api', () => ({
  fetchSuggestion: (id: number) => api.fetchSuggestion(id),
  supportWrites: {
    addReply: api.addReply,
    deleteSuggestion: api.deleteSuggestion,
    setClosed: api.setClosed,
  },
}))

function Notice() {
  const { state } = useLocation()
  return <p>Support list: {(state as { notice?: string } | null)?.notice}</p>
}

function renderPage(
  role: 'admin' | 'moderator' | 'member' | 'viewer' = 'member',
  path = '/support/7',
) {
  const router = createMemoryRouter(
    [
      {
        path: '/support/:id',
        element: (
          <RequireAuth>
            <SuggestionPage />
          </RequireAuth>
        ),
      },
      { path: '/support', element: <Notice /> },
    ],
    { initialEntries: [path] },
  )
  const fake = createFakeAuthBackend({ session: fakeSession(), profile: fakeProfile({ role }) })
  render(
    <AuthProvider backend={fake.backend}>
      <RouterProvider router={router} />
    </AuthProvider>,
  )
  return router
}

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

const STAFF_REPLY = reply(1, 'p-mod', 'Good idea.', '2026-11-21T09:00:00Z')
const OWN_REPLY = reply(2, ME, 'Thanks!', '2026-11-21T10:00:00Z')

beforeEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
  api.fetchSuggestion.mockResolvedValue(data())
  api.addReply.mockResolvedValue()
  api.deleteSuggestion.mockResolvedValue()
  api.setClosed.mockResolvedValue()
})

describe('suggestion page', () => {
  it('shows the suggestion, its author and date, and the replies oldest first with chips', async () => {
    api.fetchSuggestion.mockResolvedValue(data({ suggestion_replies: [STAFF_REPLY, OWN_REPLY] }))
    renderPage()
    expect(
      await screen.findByRole('heading', { name: 'More subtitles', level: 1 }),
    ).toBeInTheDocument()
    expect(screen.getByText('For every film, please.')).toBeInTheDocument()
    expect(screen.getByText('20 Nov 2026, 20:00')).toBeInTheDocument()
    const replies = within(
      screen.getByRole('heading', { name: 'Replies' }).closest('section')!,
    ).getAllByRole('listitem')
    expect(replies).toHaveLength(2)
    expect(replies[0]).toHaveTextContent(/^Tam.*21 Nov 2026, 09:00\s*Good idea\.$/)
    expect(replies[1]).toHaveTextContent(/^Quinn.*21 Nov 2026, 10:00\s*Thanks!$/)
    expect(within(replies[0]).getByRole('link', { name: 'Tam' })).toHaveAccessibleDescription(
      'Moderator',
    )
    expect(api.fetchSuggestion).toHaveBeenCalledWith(7)
  })

  it('says when there are no replies yet', async () => {
    renderPage()
    expect(await screen.findByText('No replies yet.')).toBeInTheDocument()
  })

  it.each(['abc', '0', '-1', '7\u200b', '99999999999999999999'])(
    'shows "not found" for the id %j without asking the server',
    async (id) => {
      renderPage('member', `/support/${encodeURIComponent(id)}`)
      expect(
        await screen.findByRole('heading', { name: 'Suggestion not found' }),
      ).toBeInTheDocument()
      expect(api.fetchSuggestion).not.toHaveBeenCalled()
    },
  )

  it('shows the same "not found" for an unknown suggestion or one that is not yours', async () => {
    api.fetchSuggestion.mockResolvedValue(null)
    const router = renderPage()
    expect(await screen.findByRole('heading', { name: 'Suggestion not found' })).toBeInTheDocument()
    expect(
      screen.getByText("It may have been deleted, or it isn't yours to see."),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('link', { name: '← Support' }))
    expect(router.state.location.pathname).toBe('/support')
  })

  it('shows a load failure with a way to try again', async () => {
    api.fetchSuggestion.mockRejectedValueOnce(new TypeError('fetch failed'))
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load the suggestion")
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { name: 'More subtitles' })).toBeInTheDocument()
  })

  it('lets the author reply and delete while nobody else has replied', async () => {
    api.fetchSuggestion.mockResolvedValue(data({ suggestion_replies: [OWN_REPLY] }))
    renderPage('viewer')
    expect(await screen.findByRole('button', { name: 'Delete suggestion' })).toBeInTheDocument()
    expect(screen.getByLabelText('Reply')).toBeInTheDocument()
  })

  it('hides Delete from the author once staff have replied, but still lets them reply', async () => {
    api.fetchSuggestion.mockResolvedValue(data({ suggestion_replies: [STAFF_REPLY] }))
    renderPage('member')
    await screen.findByRole('heading', { name: 'More subtitles' })
    expect(screen.queryByRole('button', { name: 'Delete suggestion' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Reply')).toBeInTheDocument()
  })

  it("lets a moderator reply to someone else's suggestion but not delete it", async () => {
    api.fetchSuggestion.mockResolvedValue(data({ author_id: 'p-other' }))
    renderPage('moderator')
    await screen.findByRole('heading', { name: 'More subtitles' })
    expect(screen.getByLabelText('Reply')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete suggestion' })).not.toBeInTheDocument()
  })

  it('lets the admin delete any suggestion, replies or not', async () => {
    api.fetchSuggestion.mockResolvedValue(
      data({ author_id: 'p-other', suggestion_replies: [STAFF_REPLY] }),
    )
    renderPage('admin')
    expect(await screen.findByRole('button', { name: 'Delete suggestion' })).toBeInTheDocument()
  })

  it('sends a normalised reply, clears the box, reloads and focuses a status', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'More subtitles' })
    api.fetchSuggestion.mockResolvedValue(data({ suggestion_replies: [OWN_REPLY] }))
    fireEvent.change(screen.getByLabelText('Reply'), {
      target: { value: ' Thanks!\u200b \r\n\r\n\r\nBye ' },
    })
    expect(screen.getByText('12/2000')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }))
    const status = await screen.findByText('Reply sent.')
    expect(status).toHaveAttribute('role', 'status')
    expect(status).toHaveFocus()
    expect(api.addReply).toHaveBeenCalledWith(7, 'Thanks!\n\nBye')
    expect(screen.getByLabelText('Reply')).toHaveValue('')
    expect(screen.getByText('Thanks!')).toBeInTheDocument()

    // A refused next attempt doesn't leave the old status next to its error.
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Write a reply.')
    expect(screen.queryByText('Reply sent.')).not.toBeInTheDocument()
  })

  it('refuses a blank or too long reply before sending', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'More subtitles' })
    fireEvent.change(screen.getByLabelText('Reply'), { target: { value: '\u200b \n' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Write a reply.')
    expect(screen.getByLabelText('Reply')).toHaveFocus()
    expect(screen.getByLabelText('Reply')).toHaveAccessibleDescription('0/2000 Write a reply.')
    fireEvent.change(screen.getByLabelText('Reply'), { target: { value: 'r'.repeat(2001) } })
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Keep it to 2000 characters or fewer.')
    expect(api.addReply).not.toHaveBeenCalled()
  })

  it('sends one reply for a double click, with the buttons disabled meanwhile', async () => {
    const sending = deferred<void>()
    api.addReply.mockReturnValueOnce(sending.promise)
    renderPage()
    await screen.findByRole('heading', { name: 'More subtitles' })
    fireEvent.change(screen.getByLabelText('Reply'), { target: { value: 'Once' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sending…' }))
    expect(screen.getByRole('button', { name: 'Sending…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Delete suggestion' })).toBeDisabled()
    await act(async () => sending.resolve())
    expect(api.addReply).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['the foreign key (staff)', '23503'],
    ['row-level security (the author)', '42501'],
  ])('says the suggestion was deleted when %s refuses the reply', async (_, code) => {
    renderPage()
    await screen.findByRole('heading', { name: 'More subtitles' })
    api.addReply.mockRejectedValueOnce({ code, message: 'refused' })
    api.fetchSuggestion.mockResolvedValue(null)
    fireEvent.change(screen.getByLabelText('Reply'), { target: { value: 'Too late' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }))
    expect(await screen.findByRole('heading', { name: 'Suggestion not found' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('This suggestion was deleted.')
  })

  it('deletes after confirming and goes back to the list with a notice', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    const router = renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Delete suggestion' }))
    expect(confirm).toHaveBeenCalledWith('Delete "More subtitles"? Its replies go too.')
    expect(api.deleteSuggestion).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Delete suggestion' }))
    expect(await screen.findByText('Support list: Deleted "More subtitles".')).toBeInTheDocument()
    expect(api.deleteSuggestion).toHaveBeenCalledWith(7)
    expect(router.state.location.pathname).toBe('/support')
  })

  it('explains a delete refused because staff replied meanwhile, and hides Delete', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderPage()
    await screen.findByRole('button', { name: 'Delete suggestion' })
    api.deleteSuggestion.mockRejectedValueOnce({
      code: '42501',
      message: 'This suggestion has a reply, so it can no longer be deleted',
    })
    api.fetchSuggestion.mockResolvedValue(data({ suggestion_replies: [STAFF_REPLY] }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete suggestion' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(
      'Someone has replied, so this suggestion can no longer be deleted.',
    )
    expect(await screen.findByText('Good idea.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete suggestion' })).not.toBeInTheDocument()
    // The button that had focus is gone: the error has it instead.
    expect(alert).toHaveFocus()
  })

  it('starts fresh when the id changes, and a slow earlier load never lands', async () => {
    const first = deferred<Data>()
    api.fetchSuggestion.mockReturnValueOnce(first.promise)
    api.fetchSuggestion.mockResolvedValueOnce(data({ id: 8, title: 'Second' }))
    const router = renderPage()
    await screen.findByText('Loading suggestion…')
    await act(() => router.navigate('/support/8'))
    expect(await screen.findByRole('heading', { name: 'Second' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Reply'), { target: { value: 'Draft' } })
    await act(async () => first.resolve(data({ title: 'Stale' })))
    expect(screen.queryByRole('heading', { name: 'Stale' })).not.toBeInTheDocument()

    api.fetchSuggestion.mockResolvedValueOnce(data({ id: 9, title: 'Third' }))
    await act(() => router.navigate('/support/9'))
    expect(await screen.findByRole('heading', { name: 'Third' })).toBeInTheDocument()
    expect(screen.getByLabelText('Reply')).toHaveValue('')
  })

  describe('open and closed', () => {
    const CLOSED = { closed_at: '2026-11-23T10:00:00Z', closed_by: 'p-mod' }

    it('shows an open suggestion as Open, with the reply form', async () => {
      renderPage()
      await screen.findByRole('heading', { name: 'More subtitles' })
      expect(screen.getByText('Open')).toHaveClass('badge')
      expect(screen.queryByText(/Closed by/)).not.toBeInTheDocument()
      expect(screen.getByLabelText('Reply')).toBeInTheDocument()
    })

    it.each(['member', 'moderator', 'admin'] as const)(
      'shows a closed suggestion to a %s: who closed it and when, and no reply form',
      async (role) => {
        api.fetchSuggestion.mockResolvedValue(data(CLOSED))
        renderPage(role)
        expect(await screen.findByText('Closed')).toHaveClass('badge-muted')
        const closedBy = screen.getByText(/Closed by/)
        expect(closedBy).toHaveTextContent(/^Closed by Tam.* on 23 Nov 2026, 10:00$/)
        expect(within(closedBy).getByRole('link', { name: 'Tam' })).toHaveAttribute(
          'href',
          '/people/p-mod',
        )
        expect(screen.getByText('This suggestion is closed.')).toBeInTheDocument()
        expect(screen.queryByLabelText('Reply')).not.toBeInTheDocument()
      },
    )

    it('renders no empty actions row when there is no button', async () => {
      // The author, after a staff reply: no Delete, and no Close (not staff).
      api.fetchSuggestion.mockResolvedValue(data({ suggestion_replies: [STAFF_REPLY] }))
      renderPage('member')
      await screen.findByRole('heading', { name: 'More subtitles' })
      expect(document.querySelector('.comment-actions')).toBeNull()
    })

    it.each([
      ['member', false],
      ['viewer', false],
      ['moderator', true],
      ['admin', true],
    ] as const)('shows Close suggestion to a %s: %s', async (role, shown) => {
      renderPage(role)
      await screen.findByRole('heading', { name: 'More subtitles' })
      expect(screen.queryByRole('button', { name: 'Close suggestion' }) !== null).toBe(shown)
    })

    it('lets staff close, then reopen, in place: disabled meanwhile, announced, focus kept', async () => {
      const closing = deferred<void>()
      api.setClosed.mockReturnValueOnce(closing.promise)
      renderPage('moderator')
      const close = await screen.findByRole('button', { name: 'Close suggestion' })
      close.focus()
      fireEvent.click(close)
      fireEvent.click(close)
      expect(close).toBeDisabled()
      api.fetchSuggestion.mockResolvedValue(data(CLOSED))
      await act(async () => closing.resolve())
      const reopen = await screen.findByRole('button', { name: 'Reopen suggestion' })
      expect(api.setClosed).toHaveBeenCalledTimes(1)
      expect(api.setClosed).toHaveBeenCalledWith(7, true)
      expect(screen.getByText('Suggestion closed.')).toHaveAttribute('role', 'status')
      expect(screen.getByText('This suggestion is closed.')).toBeInTheDocument()
      await waitFor(() => expect(reopen).toHaveFocus())

      api.fetchSuggestion.mockResolvedValue(data())
      fireEvent.click(reopen)
      expect(await screen.findByText('Suggestion reopened.')).toBeInTheDocument()
      expect(api.setClosed).toHaveBeenLastCalledWith(7, false)
      expect(screen.getByLabelText('Reply')).toBeInTheDocument()
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Close suggestion' })).toHaveFocus(),
      )
    })

    it('says why a close failed, with focus on the message', async () => {
      api.setClosed.mockRejectedValueOnce({ code: 'P0002', message: 'No such suggestion' })
      renderPage('admin')
      fireEvent.click(await screen.findByRole('button', { name: 'Close suggestion' }))
      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent('This suggestion was deleted.')
      await waitFor(() => expect(alert).toHaveFocus())
    })

    it('says so when the suggestion was closed before the reply landed, and reloads', async () => {
      renderPage()
      await screen.findByRole('heading', { name: 'More subtitles' })
      api.addReply.mockRejectedValueOnce({ code: '42501', message: 'This suggestion is closed' })
      api.fetchSuggestion.mockResolvedValue(data(CLOSED))
      fireEvent.change(screen.getByLabelText('Reply'), { target: { value: 'Too late' } })
      fireEvent.click(screen.getByRole('button', { name: 'Send reply' }))
      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent('This suggestion was closed.')
      expect(await screen.findByText('This suggestion is closed.')).toBeInTheDocument()
      expect(screen.queryByLabelText('Reply')).not.toBeInTheDocument()
      await waitFor(() => expect(alert).toHaveFocus())
    })
  })
})
