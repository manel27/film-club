import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import type { Person } from '../films/films'
import PeoplePage from './PeoplePage'

const people: Person[] = [
  { id: 'a', name: 'Ada', colour: null, isSystem: false, role: 'admin' },
  { id: 'm', name: 'Mo', colour: null, isSystem: false, role: 'moderator' },
  { id: 'q', name: 'Quinn', colour: null, isSystem: false, role: 'member' },
  { id: 'v', name: 'Vi', colour: null, isSystem: false, role: 'viewer' },
  { id: 'c', name: 'Cinema', colour: null, isSystem: true },
]
vi.mock('../films/api', () => ({ fetchPeopleList: () => Promise.resolve(people) }))

// jsdom has no CSS, so showing/hiding the tips (hover, focus, Escape) is covered in e2e/profiles.spec.ts.
describe('PeoplePage', () => {
  it.each([
    ['Ada', 'Admin'],
    ['Mo', 'Moderator'],
    ['Quinn', 'Member'],
    ['Vi', 'Viewer'],
  ])('describes %s to assistive tech as %s', async (name, role) => {
    render(<PeoplePage />, { wrapper: MemoryRouter })
    expect(await screen.findByRole('link', { name })).toHaveAccessibleDescription(role)
  })

  it('shows no visible role badge and leaves out system profiles', async () => {
    const { container } = render(<PeoplePage />, { wrapper: MemoryRouter })
    await screen.findByRole('link', { name: 'Ada' })
    expect(container.querySelector('.badge')).toBeNull()
    expect(screen.queryByText('Cinema')).toBeNull()
  })
})
