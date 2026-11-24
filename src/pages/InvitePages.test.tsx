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
  updatePerson: vi.fn(),
  removeLogin: vi.fn(),
  fetchExport: vi.fn(),
  fetchLastExport: vi.fn(),
  saveLastExport: vi.fn(),
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

beforeEach(() => {
  vi.resetAllMocks()
  mocked.fetchLastExport.mockResolvedValue(new Date().toISOString())
  mocked.saveLastExport.mockResolvedValue()
})

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
    // Read once, then dropped from the address bar and history (audit S10).
    expect(window.location.hash).toBe('#/invite')

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

describe('link pages without a token (reloaded after the token was dropped)', () => {
  it.each(['/invite', '/reset'])(
    '%s says to open the link again, without asking the server',
    async (path) => {
      renderApp(path)
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Open the link Manel sent you again.',
      )
      expect(mocked.previewInvite).not.toHaveBeenCalled()
      expect(screen.getByRole('link', { name: 'Go to the login page' })).toBeInTheDocument()
    },
  )
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
    expect(window.location.hash).toBe('#/reset')
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
      loginRemovedAt: null,
    },
    {
      id: VIGGO,
      name: 'Viggo',
      colour: '#f6b26b',
      isSystem: false,
      role: 'member' as const,
      isClaimed: false,
      loginRemovedAt: null,
    },
    {
      id: 'wren',
      name: 'Wren',
      colour: null,
      isSystem: false,
      role: 'member' as const,
      isClaimed: false,
      loginRemovedAt: '2026-11-20T23:30:00Z',
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
    expect(row('Viggo')).toHaveTextContent('No login')
    // 23:30 UTC on 20 Nov is already 20 Nov in Lisbon (UTC+0 in winter).
    expect(row('Wren')).toHaveTextContent('Login removed 20 Nov 2026')
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

  it('warns when a new colour is close to someone else’s, but still saves', async () => {
    mocked.fetchAdminPeople.mockResolvedValue(adminData())
    mocked.addPerson.mockResolvedValue()
    renderApp('/admin', admin())
    await screen.findByRole('link', { name: 'Kwame' })
    type('Name', 'Nova')
    type('Hex code', '#7ab85a')
    expect(screen.getByLabelText('Colour')).toHaveValue('#7ab85a')
    expect(screen.getByText(/Hard to tell apart from/)).toHaveTextContent(
      "Hard to tell apart from Kwame's colour (#6aa84f). You can still save it.",
    )
    type('Colour', '#123abc')
    expect(screen.queryByText(/Hard to tell apart/)).not.toBeInTheDocument()
    type('Hex code', '#7AB85A')
    fireEvent.click(screen.getByRole('button', { name: 'Add person' }))
    expect(await screen.findByText(/Nova added/)).toBeInTheDocument()
    expect(mocked.addPerson).toHaveBeenCalledWith('Nova', '#7ab85a', 'member')

    type('Name', 'Bad Hex')
    type('Hex code', '#12')
    fireEvent.click(screen.getByRole('button', { name: 'Add person' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Use a hex colour like #4a86e8.')
  })

  it('edits someone’s name, colour and role, then focuses their row again', async () => {
    mocked.fetchAdminPeople.mockResolvedValue(adminData())
    mocked.updatePerson.mockResolvedValue()
    renderApp('/admin', admin())
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Viggo' }))
    const dialog = screen.getByRole('dialog', { name: 'Edit Viggo' })
    expect(within(dialog).getByLabelText('Name')).toHaveFocus()
    const field = (label: string) => within(dialog).getByLabelText(label)
    expect(field('Name')).toHaveValue('Viggo')
    expect(field('Role')).toBeEnabled()

    fireEvent.change(field('Name'), { target: { value: 'KWAME' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Someone already has that name.',
    )

    fireEvent.change(field('Name'), { target: { value: ' Viggo  B ' } })
    // Close to Kwame's green: warned, not blocked. Its own old colour is no clash.
    fireEvent.change(field('Hex code'), { target: { value: '#6aa84e' } })
    expect(within(dialog).getByText(/Hard to tell apart/)).toHaveTextContent('Kwame')
    fireEvent.change(field('Role'), { target: { value: 'moderator' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(mocked.updatePerson).toHaveBeenCalledWith(VIGGO, {
        display_name: 'Viggo B',
        colour: '#6aa84e',
        role: 'moderator',
      }),
    )
    expect(await screen.findByText('Saved Viggo.')).toBeInTheDocument()
    expect(dialog).not.toHaveAttribute('open')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit Viggo' })).toHaveFocus())
  })

  it("explains the guard's refusals and keeps a colour from being cleared", async () => {
    mocked.fetchAdminPeople.mockResolvedValue(adminData())
    mocked.updatePerson.mockRejectedValue({
      code: '42501',
      message: 'The last admin cannot be demoted',
    })
    renderApp('/admin', admin())
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Kwame' }))
    const dialog = screen.getByRole('dialog', { name: 'Edit Kwame' })
    fireEvent.change(within(dialog).getByLabelText('Hex code'), { target: { value: '' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Use a hex colour')
    expect(mocked.updatePerson).not.toHaveBeenCalled()

    fireEvent.change(within(dialog).getByLabelText('Hex code'), { target: { value: '#6aa84f' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'The club needs at least one admin.',
    )
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('button', { name: 'Edit Kwame' })).toHaveFocus()

    // Wren never had a colour: saving without one is fine.
    mocked.updatePerson.mockResolvedValue()
    fireEvent.click(screen.getByRole('button', { name: 'Edit Wren' }))
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Edit Wren' })).getByRole('button', {
        name: 'Save',
      }),
    )
    await waitFor(() =>
      expect(mocked.updatePerson).toHaveBeenLastCalledWith('wren', {
        display_name: 'Wren',
        colour: null,
        role: 'member',
      }),
    )
  })

  it('does not let the admin change their own role or remove their own login', async () => {
    const me = {
      id: 'profile-1',
      name: 'Quinn',
      colour: '#4a86e8',
      isSystem: false,
      role: 'admin' as const,
      isClaimed: true,
      loginRemovedAt: null,
    }
    mocked.fetchAdminPeople.mockResolvedValue({ ...adminData(), people: [me] })
    renderApp('/admin', admin())
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Quinn' }))
    const role = within(screen.getByRole('dialog')).getByLabelText('Role')
    expect(role).toBeDisabled()
    expect(role).toHaveAccessibleDescription(/can't change your own role/)
    expect(screen.queryByRole('button', { name: 'Remove login for Quinn' })).not.toBeInTheDocument()
  })

  it('removes a login only after a yes', async () => {
    mocked.fetchAdminPeople.mockResolvedValue(adminData())
    mocked.removeLogin.mockResolvedValueOnce({ ok: true }).mockRejectedValueOnce({
      status: 409,
      error: 'no_login',
    })
    renderApp('/admin', admin())
    expect(screen.queryByRole('button', { name: 'Remove login for Viggo' })).not.toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: 'Remove login for Kwame' }))
    const dialog = screen.getByRole('dialog', { name: "Remove Kwame's login?" })
    expect(dialog).toHaveTextContent('scores, attendance and comments stay')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(mocked.removeLogin).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Remove login for Kwame' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, remove login' }))
    expect(
      await screen.findByText("Kwame's login was removed. Their history stays."),
    ).toBeInTheDocument()
    expect(mocked.removeLogin).toHaveBeenCalledWith(KWAME)

    fireEvent.click(await screen.findByRole('button', { name: 'Remove login for Kwame' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, remove login' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("doesn't have a login any more")
  })

  it('exports all data as one zip download', async () => {
    mocked.fetchAdminPeople.mockResolvedValue(adminData())
    mocked.fetchExport
      .mockResolvedValueOnce({
        format: 'film-club-export',
        exported_at: '2026-11-23T21:00:00Z',
        schema_version: '20261123140000',
        row_counts: { films: 0 },
        tables: { films: [] },
      })
      .mockRejectedValueOnce({ code: '42501' })
    const createObjectURL = vi.fn(() => 'blob:export')
    const revokeObjectURL = vi.fn()
    Object.assign(URL, { createObjectURL, revokeObjectURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const timers = vi.spyOn(window, 'setTimeout')
    renderApp('/admin', admin())
    fireEvent.click(await screen.findByRole('button', { name: 'Export all data' }))
    expect(
      await screen.findByText('Downloaded film-club-export-2026-11-23.zip.'),
    ).toBeInTheDocument()
    expect(click).toHaveBeenCalledTimes(1)
    expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe(
      'film-club-export-2026-11-23.zip',
    )
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob))
    // Revoked a minute later, not at once (Safari may still be starting the download).
    expect(revokeObjectURL).not.toHaveBeenCalled()
    const later = timers.mock.calls.find(([, ms]) => ms === 60_000)
    ;(later![0] as () => void)()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:export')
    timers.mockRestore()

    fireEvent.click(screen.getByRole('button', { name: 'Export all data' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Only the admin can export the data.',
    )
    expect(mocked.saveLastExport).toHaveBeenCalledTimes(1)
    click.mockRestore()
  })

  it('records the export date for the 30-day reminder, and the banner goes', async () => {
    mocked.fetchAdminPeople.mockResolvedValue(adminData())
    mocked.fetchLastExport.mockResolvedValue(null)
    mocked.fetchExport.mockResolvedValue({
      format: 'film-club-export',
      exported_at: '2026-11-23T21:00:00Z',
      schema_version: '20261123140000',
      row_counts: {},
      tables: {},
    })
    mocked.saveLastExport.mockRejectedValueOnce(new Error('offline'))
    Object.assign(URL, { createObjectURL: () => 'blob:export', revokeObjectURL: () => {} })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    renderApp('/admin', admin())
    expect(await screen.findByText('Last export: never')).toBeInTheDocument()
    expect(
      screen.getByText(/No data export in the last 30 days \(last: never\)/),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Export all data' }))
    // The save failed: the download still counts, with a note.
    expect(await screen.findByText(/Couldn't save the export date/)).toBeInTheDocument()
    expect(screen.getByText(/^Downloaded film-club-export-2026-11-23\.zip\./)).toBeInTheDocument()
    const at = mocked.saveLastExport.mock.calls[0][0]
    expect(Date.now() - Date.parse(at)).toBeLessThan(60_000)
    expect(screen.getByText(/^Last export: \d+ \w+ \d{4}$/)).toBeInTheDocument()
    expect(screen.queryByText(/No data export in the last 30 days/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Export all data' }))
    await waitFor(() => expect(mocked.saveLastExport).toHaveBeenCalledTimes(2))
    await waitFor(() =>
      expect(screen.queryByText(/Couldn't save the export date/)).not.toBeInTheDocument(),
    )
    click.mockRestore()
  })
})

describe('about page', () => {
  it('credits TMDB with their logo and notice, linked from the header nav', async () => {
    // From a page that loads no data (this file mocks the films and rotation APIs away).
    renderApp('/nowhere', createFakeAuthBackend({ session: fakeSession(), profile: fakeProfile() }))
    const nav = await screen.findByRole('navigation', { name: 'Main' })
    fireEvent.click(within(nav).getByRole('link', { name: 'About' }))
    expect(await screen.findByRole('heading', { name: 'About Film Club' })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'About' })).toHaveAttribute('aria-current', 'page')
    expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'The Movie Database (TMDB)' })).toBeInTheDocument()
    expect(
      screen.getByText('This product uses the TMDB API but is not endorsed or certified by TMDB.'),
    ).toBeInTheDocument()
  })
})
