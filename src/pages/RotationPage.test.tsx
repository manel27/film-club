import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '../auth/AuthProvider'
import RequireAuth from '../auth/RequireAuth'
import NextUpCard from '../components/NextUp'
import type { RotationData } from '../rotation/api'
import { createFakeAuthBackend, fakeProfile, fakeSession } from '../test/fakeAuthBackend'
import RotationPage from './RotationPage'

const ME = 'profile-1' // fakeProfile's id (Quinn)
const WEEK = '2026-11-16'

function data(over: Partial<RotationData> = {}): RotationData {
  return {
    epoch: '2026-01-05',
    weekStart: WEEK,
    standings: [
      { profileId: ME, points: 2, owedRank: null, owedSince: null },
      { profileId: 'p-ada', points: 5, owedRank: null, owedSince: null },
      { profileId: 'p-bo', points: 1, owedRank: 1, owedSince: '2026-11-07' },
    ],
    passes: [{ weekStart: '2026-02-09', profileId: 'p-ada', createdBy: 'p-ada' }],
    decisions: [],
    adjustments: [
      {
        id: 1,
        profileId: 'p-ada',
        delta: null,
        setTo: 3,
        clearOwedTurn: false,
        reason: 'Starting value',
        effectiveAt: '2026-01-05T00:00:00Z',
        createdBy: 'p-bo',
      },
      {
        id: 2,
        profileId: ME,
        delta: -2,
        setTo: null,
        clearOwedTurn: false,
        reason: 'Typo',
        effectiveAt: '2026-02-01T00:00:00Z',
        createdBy: null,
      },
    ],
    chosen: [
      {
        id: 7,
        title: 'Vote Night',
        screenedOn: '2026-11-07',
        kind: 'democratico',
        assignedId: 'p-ada',
        turnHolderId: 'p-bo',
      },
    ],
    people: [
      { id: ME, name: 'Quinn', colour: '#4a86e8', isSystem: false },
      { id: 'p-ada', name: 'Ada', colour: '#ffd200', isSystem: false },
      { id: 'p-bo', name: 'Bo', colour: null, isSystem: false },
      { id: 'p-cinema', name: 'Cinema', colour: '#999999', isSystem: true },
    ],
    ...over,
  }
}

const fetchRotation = vi.fn(async () => data())
const writes = vi.hoisted(() => ({
  pass: vi.fn(async () => {}),
  unpass: vi.fn(async () => {}),
  decide: vi.fn(async () => {}),
  adjust: vi.fn(async () => {}),
}))
vi.mock('../rotation/api', () => ({
  fetchRotation: () => fetchRotation(),
  rotationWrites: writes,
}))

function renderPage(
  role: 'admin' | 'moderator' | 'member' | 'viewer' = 'member',
  element = <RotationPage />,
) {
  const router = createMemoryRouter([
    { path: '/', element: <RequireAuth>{element}</RequireAuth> },
    { path: '/films/:id', element: <p>Film</p> },
  ])
  const fake = createFakeAuthBackend({ session: fakeSession(), profile: fakeProfile({ role }) })
  render(
    <AuthProvider backend={fake.backend}>
      <RouterProvider router={router} />
    </AuthProvider>,
  )
}

const card = async () => {
  await screen.findByRole('heading', { name: 'Next up' }, { timeout: 3000 })
  return screen.getByRole('region', { name: 'Next up' })
}

beforeEach(() => {
  vi.clearAllMocks()
  fetchRotation.mockImplementation(async () => data())
})

describe('next up', () => {
  it('pins the owed turn on top with its badge, and names who chooses', async () => {
    renderPage()
    const c = await card()
    expect(c).toHaveTextContent('Week of 2026/11/16: Bo (owed turn)')
    const rows = within(within(c).getByRole('list', { name: 'Standings' })).getAllByRole('listitem')
    expect(rows.map((r) => r.textContent)).toEqual([
      'Bo1 pointowed turn (missed the Democrático on 2026/11/07)',
      'Ada5 points',
      'Quinn2 points',
    ])
  })

  it('shows a tie to talk out, and a staff decision', async () => {
    const tie = data({
      standings: [
        { profileId: 'p-ada', points: 4, owedRank: null, owedSince: null },
        { profileId: 'p-bo', points: 4, owedRank: null, owedSince: null },
      ],
    })
    fetchRotation.mockResolvedValue(tie)
    renderPage()
    expect(await card()).toHaveTextContent('Ada / Bo: talk it out')

    fetchRotation.mockResolvedValue({
      ...tie,
      decisions: [{ weekStart: WEEK, profileId: 'p-bo', decidedBy: 'p-ada' }],
    })
    cleanup()
    renderPage()
    expect(await card()).toHaveTextContent('Week of 2026/11/16: Bo (decided by Ada)')
  })

  it('lets a member pass for the coming week, skipping them, and take it back', async () => {
    renderPage()
    const c = await card()
    fireEvent.click(within(c).getByRole('button', { name: "I can't make it" }))
    fireEvent.click(within(c).getByRole('button', { name: "I can't make it" })) // double click
    expect(writes.pass).toHaveBeenCalledOnce()
    expect(writes.pass).toHaveBeenCalledWith(WEEK, ME)

    fetchRotation.mockResolvedValue(
      data({ passes: [{ weekStart: WEEK, profileId: ME, createdBy: ME }] }),
    )
    cleanup()
    renderPage()
    const after = await card()
    expect(after).toHaveTextContent("Can't make it: Quinn")
    fireEvent.click(within(after).getByRole('button', { name: 'I can make it after all' }))
    expect(writes.unpass).toHaveBeenCalledWith(WEEK, ME)
  })

  it('shows a friendly error when a pass is refused', async () => {
    writes.pass.mockRejectedValueOnce({ code: '42501', message: 'row-level security' })
    renderPage()
    fireEvent.click(within(await card()).getByRole('button', { name: "I can't make it" }))
    expect(await screen.findByRole('alert')).toHaveTextContent("You can't change that.")
  })

  it('offers no pass to a viewer, nor to someone outside the rotation', async () => {
    renderPage('viewer')
    expect(await card()).toHaveTextContent('Bo (owed turn)')
    expect(screen.queryByRole('button', { name: "I can't make it" })).not.toBeInTheDocument()
  })

  it('says the rotation starts at go-live when there is no epoch, and shows nothing else', async () => {
    fetchRotation.mockResolvedValue(
      data({
        epoch: null,
        weekStart: null,
        standings: [],
        passes: [],
        adjustments: [],
        chosen: [],
      }),
    )
    renderPage('admin')
    expect(await card()).toHaveTextContent('The rotation starts at go-live')
    expect(screen.queryByRole('list', { name: 'Standings' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Staff' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Adjustments' })).not.toBeInTheDocument()
  })

  it('gives the start date when go-live is still ahead', async () => {
    fetchRotation.mockResolvedValue(data({ epoch: '2099-01-05', weekStart: null, standings: [] }))
    renderPage()
    expect(await card()).toHaveTextContent('The rotation starts on 2099/01/05.')
  })

  it('is the films page card too, with a retry when it fails to load', async () => {
    fetchRotation.mockRejectedValueOnce(new Error('offline'))
    renderPage('member', <NextUpCard />)
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load the rotation.")
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await card()).toHaveTextContent('Bo (owed turn)')
  })
})

describe('rotation page', () => {
  it('lists past choosers, passes and the adjustment log with who entered each', async () => {
    renderPage()
    await card()
    expect(screen.getByRole('link', { name: 'Vote Night' })).toHaveAttribute('href', '/films/7')
    expect(screen.getByText('(missed: Bo)')).toBeInTheDocument()
    const log = screen.getByRole('heading', { name: 'Adjustments' }).nextElementSibling!
    const rows = within(log as HTMLElement)
      .getAllByRole('row')
      .map((r) => r.textContent)
    expect(rows.slice(1)).toEqual([
      '2026/01/05Adaset to 3Starting valueBo',
      '2026/02/01Quinn−2Typo–',
    ])
    // A past pass can't be removed.
    expect(screen.getByText('2026/02/09')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument()
    // Members get no staff forms.
    expect(screen.queryByRole('heading', { name: 'Staff' })).not.toBeInTheDocument()
  })

  it('lets staff record a pass and a decision for a week, by any day in it', async () => {
    renderPage('moderator')
    await card()
    const passForm = screen.getByRole('form', { name: 'Record a pass' })
    fireEvent.change(within(passForm).getByLabelText('Person'), { target: { value: 'p-ada' } })
    fireEvent.change(within(passForm).getByLabelText('Week (any day in it)'), {
      target: { value: '2026-11-28' },
    })
    fireEvent.click(within(passForm).getByRole('button', { name: 'Record pass' }))
    await waitFor(() => expect(writes.pass).toHaveBeenCalledWith('2026-11-23', 'p-ada'))
    expect(await screen.findByRole('status')).toHaveTextContent('Pass recorded.')

    const decide = screen.getByRole('form', { name: "Decide who's next" })
    fireEvent.change(within(decide).getByLabelText('Person'), { target: { value: 'p-bo' } })
    fireEvent.click(within(decide).getByRole('button', { name: 'Save decision' }))
    await waitFor(() => expect(writes.decide).toHaveBeenCalledWith(WEEK, 'p-bo'))
  })

  it('lets staff set starting values, correct points and clear an owed turn, with a reason', async () => {
    renderPage('admin')
    await card()
    const form = screen.getByRole('form', { name: 'Adjust points' })
    const save = within(form).getByRole('button', { name: 'Save adjustment' })
    expect(save).toBeDisabled() // no person or reason yet
    fireEvent.change(within(form).getByLabelText('Person'), { target: { value: 'p-ada' } })
    fireEvent.change(within(form).getByLabelText('Reason'), { target: { value: 'Go-live' } })
    fireEvent.change(within(form).getByLabelText('Effective from'), {
      target: { value: '2026-01-05' },
    })

    fireEvent.change(within(form).getByLabelText('Points'), { target: { value: '-1' } })
    fireEvent.click(save)
    expect(within(form).getByRole('alert')).toHaveTextContent('Points start at 0.')
    fireEvent.change(within(form).getByLabelText('Points'), { target: { value: '3' } })
    fireEvent.click(save)
    await waitFor(() =>
      expect(writes.adjust).toHaveBeenCalledWith({
        profile_id: 'p-ada',
        set_to: 3,
        reason: 'Go-live',
        effective_on: '2026-01-05',
      }),
    )

    fireEvent.change(within(form).getByLabelText('Person'), { target: { value: ME } })
    fireEvent.click(within(form).getByLabelText('Add or subtract (correction)'))
    fireEvent.change(within(form).getByLabelText(/Points to add/), { target: { value: '0' } })
    fireEvent.change(within(form).getByLabelText('Reason'), { target: { value: 'Fix' } })
    fireEvent.click(save)
    expect(within(form).getByRole('alert')).toHaveTextContent("A correction can't be 0.")
    fireEvent.change(within(form).getByLabelText(/Points to add/), { target: { value: '-2' } })
    fireEvent.click(save)
    await waitFor(() =>
      expect(writes.adjust).toHaveBeenLastCalledWith(
        expect.objectContaining({ profile_id: ME, delta: -2, reason: 'Fix' }),
      ),
    )

    fireEvent.change(within(form).getByLabelText('Person'), { target: { value: 'p-bo' } })
    fireEvent.click(within(form).getByLabelText('Clear owed turn'))
    fireEvent.change(within(form).getByLabelText('Reason'), { target: { value: 'Asked to' } })
    fireEvent.click(save)
    await waitFor(() =>
      expect(writes.adjust).toHaveBeenLastCalledWith(
        expect.objectContaining({ profile_id: 'p-bo', clear_owed_turn: true, reason: 'Asked to' }),
      ),
    )
    // System profiles are never offered.
    expect(within(form).queryByRole('option', { name: 'Cinema' })).not.toBeInTheDocument()
  })

  it('shows a write failure next to its form', async () => {
    writes.decide.mockRejectedValueOnce({ code: '42501' })
    renderPage('moderator')
    await card()
    const decide = screen.getByRole('form', { name: "Decide who's next" })
    fireEvent.change(within(decide).getByLabelText('Person'), { target: { value: 'p-bo' } })
    fireEvent.click(within(decide).getByRole('button', { name: 'Save decision' }))
    expect(await within(decide).findByRole('alert')).toHaveTextContent("You can't change that.")
  })
})
