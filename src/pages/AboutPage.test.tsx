import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AuthContext, type AuthState } from '../auth/authContext'
import type { MyProfile } from '../auth/backend'
import { fakeProfile } from '../test/fakeAuthBackend'
import AboutPage from './AboutPage'

const renderAs = (profile: MyProfile | null) =>
  render(
    <AuthContext.Provider value={{ profile } as AuthState}>
      <AboutPage />
    </AuthContext.Provider>,
  )

/** The marks in a row, as a screen reader reads them: [admin, moderator, member, viewer]. */
function marks(rowName: string) {
  const row = screen.getByRole('row', { name: new RegExp(`^${rowName}`) })
  return within(row)
    .getAllByRole('cell')
    .map((cell) => cell.querySelector('.sr-only')?.textContent)
}

describe('AboutPage roles', () => {
  it('shows a labelled table with the four roles as column headers', () => {
    render(<AboutPage />)
    expect(screen.getByRole('heading', { name: 'Roles' })).toBeInTheDocument()
    const table = screen.getByRole('table', { name: 'What each role can do' })
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((th) => th.textContent)
    expect(headers).toEqual(['What you can do', 'Admin', 'Moderator', 'Member', 'Viewer'])
    expect(screen.getByRole('region', { name: 'Roles' })).toHaveAttribute('tabindex', '0')
  })

  it('marks each permission for the right roles, with text for screen readers', () => {
    render(<AboutPage />)
    expect(marks('See films')).toEqual(['yes', 'yes', 'yes', 'yes'])
    expect(marks('Enter, edit and delete your own score')).toEqual(['yes', 'yes', 'yes', 'no'])
    expect(marks('Change your display name')).toEqual(['yes', 'yes', 'yes', 'no'])
    expect(marks('Pick a theme')).toEqual(['yes', 'yes', 'yes', 'yes'])
    expect(marks('Revoke invite and reset links')).toEqual(['yes', 'no', 'no', 'no'])
    expect(marks('Add and edit films')).toEqual(['yes', 'yes', 'no', 'no'])
    expect(marks('Delete films')).toEqual(['yes', 'no', 'no', 'no'])
    expect(marks('Export all data')).toEqual(['yes', 'no', 'no', 'no'])
    // Viewers may write suggestions (an exception to "viewers change nothing").
    expect(marks('Write suggestions')).toEqual(['yes', 'yes', 'yes', 'yes'])
    expect(marks('Delete your own suggestion')).toEqual(['yes', 'yes', 'yes', 'yes'])
    expect(marks("See and reply to everyone's suggestions")).toEqual(['yes', 'yes', 'no', 'no'])
    expect(marks('Delete any suggestion')).toEqual(['yes', 'no', 'no', 'no'])
    expect(marks('Close and reopen suggestions')).toEqual(['yes', 'yes', 'no', 'no'])
    // The visible marks are hidden from screen readers.
    const row = screen.getByRole('row', { name: /^Delete films/ })
    expect(within(row).getAllByText('✓')[0]).toHaveAttribute('aria-hidden', 'true')
    expect(within(row).getAllByText('—')).toHaveLength(3)
  })

  it('notes what the table cannot show', () => {
    render(<AboutPage />)
    expect(
      screen.getByText(
        /Viewers can look at everything but can't change anything except their theme/,
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('Nobody can change their own role.')).toBeInTheDocument()
    expect(
      screen.getByText('A suggestion is seen only by its author, the moderators and the admin.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Jurassic Shark 2's scores are locked, and the film can't be deleted/),
    ).toBeInTheDocument()
  })
})

describe('AboutPage: your role', () => {
  it.each([
    ['admin', 'You are an admin.', 1],
    ['moderator', 'You are a moderator.', 2],
    ['member', 'You are a member.', 3],
    ['viewer', 'You are a viewer.', 4],
  ] as const)('highlights a logged-in %s’s column and says so', (role, sentence, column) => {
    renderAs(fakeProfile({ role }))
    expect(screen.getByText(sentence)).toBeInTheDocument()
    const ths = screen.getAllByRole('columnheader')
    expect(ths[column]).toHaveTextContent(/ \(you\)$/)
    expect(ths[column]).toHaveClass('your-role')
    expect(ths.filter((th) => th.classList.contains('your-role'))).toHaveLength(1)
    expect(screen.getAllByText(/\(you\)/)).toHaveLength(1)
    // Every cell of that column, and only those.
    for (const row of screen.getAllByRole('row').slice(1)) {
      const cells = within(row).getAllByRole('cell')
      expect(cells.map((c) => c.classList.contains('your-role'))).toEqual(
        [1, 2, 3, 4].map((i) => i === column),
      )
    }
  })

  it.each([
    ['logged out', null],
    ['an unknown role', fakeProfile({ role: 'owner' as MyProfile['role'] })],
    ['a system profile', fakeProfile({ role: 'member', is_system: true })],
  ])('highlights nothing and says nothing for %s', (_, profile) => {
    renderAs(profile)
    expect(screen.queryByText(/^You are/)).not.toBeInTheDocument()
    expect(document.querySelector('.your-role')).toBeNull()
    expect(screen.getAllByRole('columnheader').map((th) => th.textContent)).toEqual([
      'What you can do',
      'Admin',
      'Moderator',
      'Member',
      'Viewer',
    ])
  })
})
