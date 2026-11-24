import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import AboutPage from './AboutPage'

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
      screen.getByText(/Jurassic Shark 2's scores are locked, and the film can't be deleted/),
    ).toBeInTheDocument()
  })
})
