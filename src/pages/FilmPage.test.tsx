import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '../auth/AuthProvider'
import RequireAuth from '../auth/RequireAuth'
import type { FilmDetailData, FilmRecord } from '../films/api'
import { NO_ROWS } from '../films/filmDetail'
import { createFakeAuthBackend, fakeProfile, fakeSession } from '../test/fakeAuthBackend'
import FilmPage from './FilmPage'

const ME = 'profile-1' // fakeProfile's id

function detail(film: Partial<FilmRecord> = {}): FilmDetailData {
  return {
    film: {
      id: 5,
      title: 'Glass River',
      original_title: 'Rio de Vidro',
      release_year: 2001,
      poster_path: null,
      directors: ['Ana Lume'],
      genres: ['Drama'],
      runtime_min: 101,
      overview: 'A <b>river</b>.',
      screened_on: '2026-11-14',
      kind: 'democratico',
      assigned_id: 'p-ada',
      turn_holder_id: 'p-bo',
      is_easter_egg: false,
      scores_locked: false,
      attendance: [{ profile_id: ME }, { profile_id: 'p-ada' }],
      scores: [
        { profile_id: ME, score: 7.5 },
        { profile_id: 'p-ada', score: 9 },
      ],
      comments: [
        {
          id: 1,
          author_id: 'p-ada',
          body: 'Great.',
          created_at: '2026-11-15T10:00:00Z',
          edited_at: null,
          is_legacy: false,
        },
        {
          id: 2,
          author_id: ME,
          body: 'Mine.',
          created_at: '2026-11-15T11:00:00Z',
          edited_at: '2026-11-15T12:00:00Z',
          is_legacy: false,
        },
      ],
      ...film,
    } as FilmRecord,
    avgScore: 8.25,
    people: [
      { id: ME, name: 'Quinn', colour: '#4a86e8', isSystem: false },
      { id: 'p-ada', name: 'Ada', colour: '#ffd200', isSystem: false },
      { id: 'p-bo', name: 'Bo', colour: null, isSystem: false },
      { id: 'p-cinema', name: 'Cinema', colour: '#999999', isSystem: true },
    ],
  }
}

const fetchFilm = vi.fn<(id: number) => Promise<FilmDetailData | null>>(async () => detail())
const writes = vi.hoisted(() => ({
  setPresent: vi.fn(async () => {}),
  saveScore: vi.fn(async () => {}),
  deleteScore: vi.fn(async () => {}),
  addComment: vi.fn(async () => {}),
  editComment: vi.fn(async () => {}),
  deleteComment: vi.fn(async () => {}),
  deleteFilm: vi.fn(async () => {}),
}))
vi.mock('../films/api', () => ({
  fetchFilm: (id: number) => fetchFilm(id),
  filmWrites: writes,
}))
const fetchEpoch = vi.fn(async (): Promise<string | null> => null)
vi.mock('../rotation/api', () => ({ fetchEpoch: () => fetchEpoch() }))

function renderPage(
  role: 'admin' | 'moderator' | 'member' | 'viewer' = 'member',
  path = '/films/5',
) {
  const router = createMemoryRouter(
    [
      {
        path: '/films/:id',
        element: (
          <RequireAuth>
            <FilmPage />
          </RequireAuth>
        ),
      },
      { path: '/', element: <p>Films list</p> },
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

const commentItem = (text: string) => screen.getByText(text).closest('li')!
const findComment = async (text: string) => (await screen.findByText(text)).closest('li')!

beforeEach(() => vi.clearAllMocks())

// jsdom has <dialog> but not showModal()/close().
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.open = true
  }
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.open = false
    this.dispatchEvent(new Event('close'))
  }
})

describe('film page', () => {
  it('shows the film, screening, attendance, scores and comments', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { name: /Glass River/ })).toBeInTheDocument()
    expect(screen.getByText('Rio de Vidro')).toBeInTheDocument()
    expect(screen.getByText('2026/11/14')).toBeInTheDocument()
    expect(screen.getByText('Democrático')).toBeInTheDocument()
    expect(screen.getByText('101 min')).toBeInTheDocument()
    expect(screen.getByText('Missed their turn').nextElementSibling).toHaveTextContent('Bo')
    // Plain text only: markup in data is never rendered.
    expect(screen.getByText('A <b>river</b>.')).toBeInTheDocument()
    // A light colour gets dark text.
    const adaChip = within(
      screen.getByText('Chosen by').nextElementSibling as HTMLElement,
    ).getByText('Ada')
    expect(adaChip).toHaveStyle({ color: '#000000' })
    expect(screen.getByRole('row', { name: 'Average 8.25' })).toBeInTheDocument()
    expect(screen.getByText(/\(edited\)/)).toBeInTheDocument()
  })

  it("shows why a Democrático was chosen, as text and as the badge's tip", async () => {
    fetchFilm.mockResolvedValueOnce(detail({ democratico_reason: 'Nobody agreed' }))
    renderPage()
    expect(await screen.findByText('Why: Nobody agreed')).toBeInTheDocument()
    const badge = screen.getByText('Democrático', { selector: '.badge' })
    expect(badge).toHaveAttribute('tabindex', '0')
    // Described by the "Why:" line, not a second copy in the tip.
    expect(badge).toHaveAccessibleDescription('Why: Nobody agreed')
    // A tap focuses it (focus shows the tip), inside the page's tipsOff; a tap elsewhere closes it.
    fireEvent.pointerDown(badge, { pointerType: 'touch' })
    fireEvent.click(badge, { detail: 1 })
    expect(badge).toHaveFocus()
    expect(badge.closest('.role-chip')!.querySelector('.reason-tip')).toHaveTextContent(
      'Nobody agreed',
    )
    expect(badge.closest('.tips-off')).toBeNull()
    fireEvent.pointerDown(screen.getByRole('heading', { level: 1 }), { pointerType: 'touch' })
    expect(badge).not.toHaveFocus()
    cleanup()

    // Imported films have none.
    fetchFilm.mockResolvedValueOnce(detail({ democratico_reason: null }))
    renderPage()
    expect(await screen.findByText('Unknown reason', { selector: 'p' })).toBeInTheDocument()
    expect(screen.getByText('Democrático', { selector: '.badge' })).toHaveAccessibleDescription(
      'Unknown reason',
    )
    cleanup()

    // Other kinds: no reason line.
    fetchFilm.mockResolvedValueOnce(detail({ kind: 'cinema', democratico_reason: null }))
    renderPage()
    expect(await screen.findByText('Cinema', { selector: '.badge' })).toBeInTheDocument()
    expect(screen.queryByText(/Unknown reason|Why:/)).toBeNull()
  })

  it('shows "not found" for an unknown film, with a way back', async () => {
    fetchFilm.mockResolvedValueOnce(null)
    const router = renderPage()
    expect(await screen.findByRole('heading', { name: 'Film not found' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('link', { name: '← All films' }))
    expect(router.state.location.pathname).toBe('/')
  })

  it('shows "not found" for an id that is not a number, without asking the server', async () => {
    renderPage('member', '/films/abc')
    expect(await screen.findByRole('heading', { name: 'Film not found' })).toBeInTheDocument()
    expect(fetchFilm).not.toHaveBeenCalled()
  })

  it('lets a viewer change nothing', async () => {
    renderPage('viewer')
    await screen.findByRole('heading', { name: /Glass River/ })
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByText('Edit attendance')).not.toBeInTheDocument()
  })

  it('lets a member change only their own presence, score and comments', async () => {
    renderPage('member')
    await screen.findByRole('heading', { name: /Glass River/ })
    expect(screen.queryByText('Edit attendance')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Score for')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: "Delete Quinn's score" })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: "Delete Ada's score" })).not.toBeInTheDocument()
    expect(within(commentItem('Great.')).queryByRole('button')).not.toBeInTheDocument()
    expect(within(commentItem('Mine.')).getByRole('button', { name: 'Edit' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: "I wasn't there" }))
    expect(writes.setPresent).toHaveBeenCalledWith(5, ME, false)
  })

  it('validates the score before saving it', async () => {
    renderPage('member')
    const input = await screen.findByLabelText('Your score')
    expect(input).toHaveValue('7.50')
    fireEvent.change(input, { target: { value: '7.255' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save score' }))
    expect(screen.getByText('Use at most two decimals.')).toBeInTheDocument()
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(writes.saveScore).not.toHaveBeenCalled()

    fireEvent.change(input, { target: { value: '8.25' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save score' }))
    expect(writes.saveScore).toHaveBeenCalledWith(5, ME, 8.25)
  })

  it("lets a moderator score for others but not touch others' comments", async () => {
    renderPage('moderator')
    await screen.findByRole('heading', { name: /Glass River/ })
    expect(screen.getByText('Edit attendance')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: "Delete Ada's score" })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Score for'), { target: { value: 'p-bo' } })
    fireEvent.change(screen.getByLabelText('Score'), { target: { value: '6' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save score' }))
    expect(writes.saveScore).toHaveBeenCalledWith(5, 'p-bo', 6)
    expect(within(commentItem('Great.')).queryByRole('button')).not.toBeInTheDocument()
  })

  it("lets the admin edit and delete others' comments", async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderPage('admin')
    await screen.findByRole('heading', { name: /Glass River/ })
    const item = commentItem('Great.')
    fireEvent.click(within(item).getByRole('button', { name: 'Delete' }))
    expect(writes.deleteComment).toHaveBeenCalledWith(1)
    // One write at a time: wait for the delete (and reload) to finish.
    await waitFor(() => expect(within(item).getByRole('button', { name: 'Delete' })).toBeEnabled())
    fireEvent.click(within(item).getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Edit comment'), { target: { value: 'Fixed.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(writes.editComment).toHaveBeenCalledWith(1, 'Fixed.')
  })

  it('shows a clear error when a write is refused', async () => {
    writes.addComment.mockRejectedValueOnce({ code: '42501', message: 'row-level security' })
    renderPage('member')
    fireEvent.change(await screen.findByLabelText('Add a comment'), { target: { value: 'Hi' } })
    fireEvent.click(screen.getByRole('button', { name: 'Post' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent("You can't change that.")
    // Shown next to the section that ran the write.
    expect(alert.closest('section')).toHaveTextContent(/^Comments/)
  })

  it('accepts a decimal comma', async () => {
    renderPage('member')
    fireEvent.change(await screen.findByLabelText('Your score'), { target: { value: '0,5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save score' }))
    expect(writes.saveScore).toHaveBeenCalledWith(5, ME, 0.5)
  })

  it('shows "not found" for an id too large to be real, without asking the server', async () => {
    renderPage('member', '/films/99999999999999999999')
    expect(await screen.findByRole('heading', { name: 'Film not found' })).toBeInTheDocument()
    expect(fetchFilm).not.toHaveBeenCalled()
  })

  it('starts afresh when only the film id changes', async () => {
    fetchFilm.mockImplementation(async (id) =>
      id === 6
        ? detail({ id: 6, title: 'Night Bus', scores: [{ profile_id: ME, score: 3 }] })
        : detail(),
    )
    const router = renderPage('member')
    fireEvent.change(await screen.findByLabelText('Add a comment'), { target: { value: 'Draft' } })
    await act(() => router.navigate('/films/6'))
    expect(await screen.findByRole('heading', { name: 'Night Bus' })).toBeInTheDocument()
    expect(screen.getByLabelText('Your score')).toHaveValue('3.00')
    expect(screen.getByLabelText('Add a comment')).toHaveValue('')
    fetchFilm.mockImplementation(async () => detail())
  })

  it('offers a retry when the film fails to load, and a good id loads after a bad one', async () => {
    fetchFilm.mockRejectedValueOnce(new Error('offline'))
    const router = renderPage('member', '/films/9')
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load the film")
    await act(() => router.navigate('/films/5'))
    expect(await screen.findByRole('heading', { name: 'Glass River' })).toBeInTheDocument()
  })

  it('keeps the page when the reload after a write fails', async () => {
    renderPage('member')
    fireEvent.change(await screen.findByLabelText('Add a comment'), { target: { value: 'Hi' } })
    fetchFilm.mockRejectedValueOnce(new Error('offline'))
    fireEvent.click(screen.getByRole('button', { name: 'Post' }))
    await waitFor(() => expect(fetchFilm).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('heading', { name: 'Glass River' })).toBeInTheDocument()
  })

  it('follows the saved score: a deleted score empties the input', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderPage('member')
    expect(await screen.findByLabelText('Your score', {}, { timeout: 3000 })).toHaveValue('7.50')
    fetchFilm.mockResolvedValueOnce(detail({ scores: [{ profile_id: 'p-ada', score: 9 }] }))
    fireEvent.click(screen.getByRole('button', { name: "Delete Quinn's score" }))
    await waitFor(() => expect(screen.getByLabelText('Your score')).toHaveValue(''), {
      timeout: 3000,
    })
    expect(screen.getByLabelText('Your score')).toHaveFocus()
  })

  it('runs one write at a time (no double posts)', async () => {
    renderPage('member')
    fireEvent.change(await screen.findByLabelText('Add a comment'), { target: { value: 'Hi' } })
    const post = screen.getByRole('button', { name: 'Post' })
    fireEvent.click(post)
    fireEvent.click(post)
    const away = screen.getByRole('button', { name: "I wasn't there" })
    fireEvent.click(away)
    await waitFor(() => expect(screen.getByLabelText('Add a comment')).toHaveValue(''))
    expect(writes.addComment).toHaveBeenCalledOnce()
    expect(writes.setPresent).not.toHaveBeenCalled()
  })

  it('says so when the comment was changed or removed elsewhere', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    writes.deleteComment.mockRejectedValueOnce(NO_ROWS)
    renderPage('member')
    fireEvent.click(within(await findComment('Mine.')).getByRole('button', { name: 'Delete' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This was changed or removed elsewhere.',
    )
  })

  it('moves focus sensibly when editing a comment', async () => {
    renderPage('member')
    fireEvent.click(within(await findComment('Mine.')).getByRole('button', { name: 'Edit' }))
    expect(screen.getByLabelText('Edit comment')).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(within(commentItem('Mine.')).getByRole('button', { name: 'Edit' })).toHaveFocus()
  })

  it('shows the easter egg with its locked 11s', async () => {
    fetchFilm.mockResolvedValueOnce(
      detail({
        is_easter_egg: true,
        scores_locked: true,
        scores: [
          { profile_id: ME, score: 11 },
          { profile_id: 'p-ada', score: 11 },
        ],
      }),
    )
    renderPage('admin')
    expect(await screen.findByText('You just lost the game!')).toBeInTheDocument()
    expect(screen.getByText(/These scores are locked/)).toBeInTheDocument()
    expect(screen.getByRole('row', { name: 'Average 11.00' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /score/ })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Your score')).not.toBeInTheDocument()
  })

  it('lets only the admin delete a film', async () => {
    renderPage('moderator')
    expect(await screen.findByRole('link', { name: 'Edit' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete film' })).not.toBeInTheDocument()
  })

  it('asks before deleting, says what goes with it, then goes to the films with a notice', async () => {
    const router = renderPage('admin')
    const open = await screen.findByRole('button', { name: 'Delete film' })
    // Opening reloads the film, so the counts are current (a comment was added elsewhere).
    const fresh = detail()
    fresh.film.comments.push({ ...fresh.film.comments[0], id: 3 })
    fetchFilm.mockResolvedValueOnce(fresh)
    fireEvent.click(open)
    const dialog = screen.getByRole('dialog', { name: 'Delete "Glass River"?' })
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    expect(await within(dialog).findByText('3 comments')).toBeInTheDocument()
    expect(dialog).toHaveAccessibleDescription(
      'This also deletes, for good: 2 scores 2 attendance marks 3 comments',
    )
    // Cancel deletes nothing.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(dialog).not.toHaveAttribute('open')
    expect(writes.deleteFilm).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Delete film' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Yes, delete film' }))
    expect(writes.deleteFilm).toHaveBeenCalledWith(5)
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(router.state.location.state).toEqual({ notice: 'Deleted "Glass River".' })
    // Replaced: Back doesn't return to the deleted film.
    expect(router.state.historyAction).toBe('REPLACE')
  })

  it('warns that rotation points change only for a counted screening since go-live', async () => {
    const warning = 'Rotation points will be recalculated without this screening.'
    const open = async (film: Partial<FilmRecord>, epoch: string | null) => {
      cleanup()
      fetchEpoch.mockResolvedValue(epoch)
      fetchFilm.mockResolvedValue(detail(film))
      renderPage('admin')
      fireEvent.click(await screen.findByRole('button', { name: 'Delete film' }))
      await waitFor(() => expect(fetchEpoch).toHaveBeenCalled())
      await act(async () => {})
      return screen.getByRole('dialog')
    }
    expect(await open({ kind: 'democratico' }, '2026-01-05')).toHaveTextContent(warning)
    expect(
      await open({ kind: 'normal', screened_on: '2026-01-05' }, '2026-01-05'),
    ).toHaveTextContent(warning)
    // Before go-live, before the epoch, a planned film, Cinema/Maratona: nothing changes.
    expect(await open({ kind: 'normal' }, null)).not.toHaveTextContent(warning)
    expect(await open({ kind: 'normal' }, '2026-11-15')).not.toHaveTextContent(warning)
    expect(
      await open({ kind: 'normal', screened_on: '2099-01-03' }, '2026-01-05'),
    ).not.toHaveTextContent(warning)
    expect(await open({ kind: 'cinema' }, '2026-01-05')).not.toHaveTextContent(warning)
    fetchEpoch.mockResolvedValue(null)
    fetchFilm.mockImplementation(async () => detail())
  })

  it('sends one delete for a double click on confirm', async () => {
    renderPage('admin')
    fireEvent.click(await screen.findByRole('button', { name: 'Delete film' }))
    const confirm = within(screen.getByRole('dialog')).getByRole('button', {
      name: 'Yes, delete film',
    })
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    expect(writes.deleteFilm).toHaveBeenCalledOnce()
  })

  it('keeps a failure visible even if the dialog closes while deleting', async () => {
    let reject: (e: unknown) => void = () => {}
    writes.deleteFilm.mockImplementationOnce(() => new Promise((_, r) => (reject = r)))
    renderPage('admin')
    fireEvent.click(await screen.findByRole('button', { name: 'Delete film' }))
    const dialog = screen.getByRole('dialog') as HTMLDialogElement
    fireEvent.click(within(dialog).getByRole('button', { name: 'Yes, delete film' }))
    expect(within(dialog).getByRole('button', { name: 'Deleting…' })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled()
    // Escape is refused while the delete runs...
    const escape = new Event('cancel', { cancelable: true })
    dialog.dispatchEvent(escape)
    expect(escape.defaultPrevented).toBe(true)
    // ...but a browser may close it anyway (e.g. a second Escape).
    act(() => dialog.close())
    await act(async () => reject({ code: '42501', message: 'row-level security' }))
    const alerts = await screen.findAllByRole('alert')
    expect(
      alerts.some((a) => !dialog.contains(a) && /can't change that/.test(a.textContent!)),
    ).toBe(true)
  })

  it('says so in the dialog when the film was already removed, then shows "not found"', async () => {
    writes.deleteFilm.mockRejectedValueOnce(NO_ROWS)
    const router = renderPage('admin')
    fireEvent.click(await screen.findByRole('button', { name: 'Delete film' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Yes, delete film' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'This was changed or removed elsewhere.',
    )
    expect(router.state.location.pathname).toBe('/films/5')
    fetchFilm.mockResolvedValueOnce(null)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(await screen.findByRole('heading', { name: 'Film not found' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('This was changed or removed elsewhere.')
  })

  it('says the film was deleted when a write finds it gone, on the "not found" page', async () => {
    writes.addComment.mockRejectedValueOnce({ code: '23503', message: 'foreign key' })
    renderPage('member')
    fireEvent.change(await screen.findByLabelText('Add a comment'), { target: { value: 'Hi' } })
    fetchFilm.mockResolvedValueOnce(null)
    fireEvent.click(screen.getByRole('button', { name: 'Post' }))
    expect(await screen.findByRole('heading', { name: 'Film not found' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('This film was deleted.')
  })

  it('shows a refused delete in the dialog', async () => {
    writes.deleteFilm.mockRejectedValueOnce({ code: '42501', message: 'row-level security' })
    renderPage('admin')
    fireEvent.click(await screen.findByRole('button', { name: 'Delete film' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Yes, delete film' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent("You can't change that.")
  })

  it('offers no delete for the locked easter egg', async () => {
    fetchFilm.mockResolvedValueOnce(detail({ is_easter_egg: true, scores_locked: true }))
    renderPage('admin')
    await screen.findByText('You just lost the game!')
    expect(screen.queryByRole('button', { name: 'Delete film' })).not.toBeInTheDocument()
  })
})
