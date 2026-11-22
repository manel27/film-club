import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '../auth/AuthProvider'
import * as api from '../invites/api'
import { routes } from '../routes'
import {
  createFakeAuthBackend,
  fakeProfile,
  fakeSession,
  TEST_EMAIL,
  TEST_PASSWORD,
} from '../test/fakeAuthBackend'

vi.mock('../films/api', () => ({
  fetchFilmsData: async () => ({ films: [], people: [], scored: new Set() }),
}))
vi.mock('../rotation/api', () => ({}))
vi.mock('../invites/api', () => ({
  previewInvite: vi.fn(),
  claimInvite: vi.fn(),
  claimReset: vi.fn(),
  createLink: vi.fn(),
  revokeLink: vi.fn(),
  fetchAdminPeople: vi.fn(),
  addPerson: vi.fn(),
}))
const mocked = vi.mocked(api)

function renderApp(path: string, fake = createFakeAuthBackend()) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(
    <AuthProvider backend={fake.backend}>
      <RouterProvider router={router} />
    </AuthProvider>,
  )
  return { router, fake }
}

const type = (label: string | RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } })

beforeEach(() => vi.resetAllMocks())

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

describe('invite page', () => {
  it('shows who the invite is for, creates the login, signs in and opens the app', async () => {
    mocked.previewInvite.mockResolvedValue({ name: 'Viggo', colour: '#f6b26b', watched: 3 })
    mocked.claimInvite.mockResolvedValue({ ok: true })
    const { router, fake } = renderApp('/invite/tok123')
    expect(await screen.findByRole('heading', { name: 'Welcome, Viggo' })).toBeInTheDocument()
    expect(screen.getByText("You've been at 3 club screenings so far.")).toBeInTheDocument()
    expect(mocked.previewInvite).toHaveBeenCalledWith('tok123')

    type('Email', ` ${TEST_EMAIL} `)
    type(/^Password/, TEST_PASSWORD)
    type('Confirm password', TEST_PASSWORD)
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
    expect(await screen.findByRole('heading', { name: 'Films' })).toBeInTheDocument()
    expect(mocked.claimInvite).toHaveBeenCalledWith('tok123', TEST_EMAIL, TEST_PASSWORD)
    expect(fake.backend.signIn).toHaveBeenCalledWith(TEST_EMAIL, TEST_PASSWORD)
    expect(router.state.location.pathname).toBe('/')
  })

  it('says to ask Manel for a new link when the link is bad', async () => {
    mocked.previewInvite.mockRejectedValue({ status: 404, error: 'invalid_link' })
    renderApp('/invite/nope')
    expect(await screen.findByRole('alert')).toHaveTextContent('Ask Manel for a new link')
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument()
  })

  it('checks the password before claiming and shows a claim failure', async () => {
    mocked.previewInvite.mockResolvedValue({ name: 'Viggo', colour: '#f6b26b', watched: 0 })
    mocked.claimInvite.mockRejectedValue({ status: 409, error: 'email_taken' })
    renderApp('/invite/tok123')
    expect(await screen.findByText('Welcome to the club!')).toBeInTheDocument()
    type('Email', TEST_EMAIL)
    type(/^Password/, 'short')
    type('Confirm password', 'short')
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Use at least 8 characters.')
    expect(mocked.claimInvite).not.toHaveBeenCalled()

    type(/^Password/, TEST_PASSWORD)
    type('Confirm password', TEST_PASSWORD)
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('already has an account')
  })
})

describe('reset page', () => {
  it('sets the new password, then signs in with the returned email', async () => {
    mocked.previewInvite.mockResolvedValue({ name: 'Quinn', colour: '#4a86e8', watched: 2 })
    mocked.claimReset.mockResolvedValue(TEST_EMAIL)
    const { fake } = renderApp('/reset/tok456')
    expect(
      await screen.findByRole('heading', { name: 'Set a new password for Quinn' }),
    ).toBeInTheDocument()
    expect(mocked.previewInvite).toHaveBeenCalledWith('tok456', 'reset')
    type(/^New password/, TEST_PASSWORD)
    type('Confirm new password', TEST_PASSWORD)
    fireEvent.click(screen.getByRole('button', { name: 'Save and log in' }))
    expect(await screen.findByRole('heading', { name: 'Films' })).toBeInTheDocument()
    expect(mocked.claimReset).toHaveBeenCalledWith('tok456', TEST_PASSWORD)
    expect(fake.backend.signIn).toHaveBeenCalledWith(TEST_EMAIL, TEST_PASSWORD)
  })

  it('says straight away when the link is dead', async () => {
    mocked.previewInvite.mockRejectedValue({ status: 404, error: 'invalid_link' })
    renderApp('/reset/dead')
    expect(await screen.findByRole('alert')).toHaveTextContent('Ask Manel for a new link')
    expect(screen.queryByLabelText(/New password/)).not.toBeInTheDocument()
  })

  it('refuses mismatched passwords and explains a link that died meanwhile', async () => {
    mocked.previewInvite.mockResolvedValue({ name: 'Quinn', colour: '#4a86e8', watched: 2 })
    mocked.claimReset.mockRejectedValue({ status: 404 })
    renderApp('/reset/tok456')
    await screen.findByRole('heading', { name: 'Set a new password for Quinn' })
    type(/^New password/, TEST_PASSWORD)
    type('Confirm new password', 'something-else')
    fireEvent.click(screen.getByRole('button', { name: 'Save and log in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("The passwords don't match.")
    type('Confirm new password', TEST_PASSWORD)
    fireEvent.click(screen.getByRole('button', { name: 'Save and log in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Ask Manel for a new link')
  })
})

const VIGGO = '00000000-0000-4000-8000-0000000000b1'
const KWAME = '00000000-0000-4000-8000-0000000000a3'
const adminData = () => ({
  people: [
    {
      id: KWAME,
      name: 'Kwame',
      colour: '#6aa84f',
      isSystem: false,
      role: 'member' as const,
      isClaimed: true,
    },
    {
      id: VIGGO,
      name: 'Viggo',
      colour: '#f6b26b',
      isSystem: false,
      role: 'member' as const,
      isClaimed: false,
    },
    {
      id: 'wren',
      name: 'Wren',
      colour: null,
      isSystem: false,
      role: 'member' as const,
      isClaimed: false,
    },
  ],
  links: [
    { id: 'link-1', profileId: VIGGO, kind: 'invite' as const, expiresAt: '2099-01-01T00:00:00Z' },
  ],
})
const admin = () =>
  createFakeAuthBackend({ session: fakeSession(), profile: fakeProfile({ role: 'admin' }) })

describe('admin page', () => {
  it.each(['member', 'moderator', 'viewer'] as const)('is not found for a %s', async (role) => {
    renderApp(
      '/admin',
      createFakeAuthBackend({ session: fakeSession(), profile: fakeProfile({ role }) }),
    )
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Admin' })).not.toBeInTheDocument()
    expect(mocked.fetchAdminPeople).not.toHaveBeenCalled()
  })

  it('lists people with their login and link status', async () => {
    mocked.fetchAdminPeople.mockResolvedValue(adminData())
    renderApp('/admin', admin())
    const nav = await screen.findByRole('navigation', { name: 'Main' })
    expect(within(nav).getByRole('link', { name: 'Admin' })).toHaveAttribute('aria-current', 'page')
    const row = (name: string) => screen.getByRole('link', { name }).closest('tr')!
    await screen.findByRole('link', { name: 'Kwame' })
    expect(row('Kwame')).toHaveTextContent('Has a login')
    expect(row('Viggo')).toHaveTextContent('Not claimed yet')
    expect(row('Viggo')).toHaveTextContent('Invite until 1 Jan')
    expect(row('Wren')).toHaveTextContent('Needs a colour before an invite')
    expect(screen.getByRole('button', { name: 'Create reset link for Kwame' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Regenerate invite for Viggo' })).toBeInTheDocument()
  })

  it('shows a new link once, with copy', async () => {
    mocked.fetchAdminPeople.mockResolvedValue(adminData())
    mocked.createLink.mockResolvedValue({ link: 'http://x/#/reset/abc', expires_at: '2099-01-01' })
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderApp('/admin', admin())
    fireEvent.click(await screen.findByRole('button', { name: 'Create reset link for Kwame' }))
    expect(await screen.findByLabelText('Link')).toHaveValue('http://x/#/reset/abc')
    expect(mocked.createLink).toHaveBeenCalledWith('reset', KWAME)
    expect(screen.getByText(/shown only this once/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }))
    expect(await screen.findByText('Copied.')).toBeInTheDocument()
    expect(writeText).toHaveBeenCalledWith('http://x/#/reset/abc')
    expect(screen.getByLabelText('Link')).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByLabelText('Link')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create reset link for Kwame' })).toHaveFocus()
  })

  it('revokes a link only after a yes, then focuses the row again', async () => {
    mocked.fetchAdminPeople
      .mockResolvedValueOnce(adminData())
      .mockResolvedValue({ ...adminData(), links: [] })
    mocked.revokeLink.mockResolvedValue()
    renderApp('/admin', admin())
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke invite for Viggo' }))
    const dialog = screen.getByRole('dialog', { name: 'Revoke the invite for Viggo?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(mocked.revokeLink).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Revoke invite for Viggo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, revoke' }))
    await waitFor(() => expect(mocked.revokeLink).toHaveBeenCalledWith('link-1'))
    const create = await screen.findByRole('button', { name: 'Create invite for Viggo' })
    await waitFor(() => expect(create).toHaveFocus())
  })

  it('regenerates a link only after a yes', async () => {
    mocked.fetchAdminPeople.mockResolvedValue(adminData())
    mocked.createLink.mockResolvedValue({ link: 'http://x/#/invite/new', expires_at: '2099-01-01' })
    renderApp('/admin', admin())
    fireEvent.click(await screen.findByRole('button', { name: 'Regenerate invite for Viggo' }))
    expect(mocked.createLink).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toHaveTextContent('stops working, even if it was sent')
    fireEvent.click(screen.getByRole('button', { name: 'Yes, regenerate' }))
    expect(await screen.findByLabelText('Link')).toHaveValue('http://x/#/invite/new')
    expect(mocked.createLink).toHaveBeenCalledWith('invite', VIGGO)
  })

  it('adds a person with a normalised name, colour and role', async () => {
    mocked.fetchAdminPeople.mockResolvedValue(adminData())
    mocked.addPerson.mockResolvedValue()
    renderApp('/admin', admin())
    await screen.findByRole('link', { name: 'Kwame' })
    type('Name', ' kwame ')
    fireEvent.click(screen.getByRole('button', { name: 'Add person' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Someone already has that name.')

    type('Name', '  Zé​   Novo ')
    fireEvent.click(screen.getByRole('button', { name: 'Add person' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Pick a colour.')
    expect(screen.getByText('Not chosen yet')).toBeInTheDocument()
    expect(mocked.addPerson).not.toHaveBeenCalled()

    type('Colour', '#123abc')
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'viewer' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add person' }))
    expect(await screen.findByText('Zé Novo added. Create their invite above.')).toBeInTheDocument()
    expect(mocked.addPerson).toHaveBeenCalledWith('Zé Novo', '#123abc', 'viewer')
    expect(screen.getByLabelText('Name')).toHaveFocus()
    expect(screen.getByText('Not chosen yet')).toBeInTheDocument()
  })
})
