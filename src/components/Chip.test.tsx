import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import Chip, { PersonName } from './Chip'

const ada = { id: 'p-ada', name: 'Ada', colour: '#ffd200', isSystem: false }
const cinema = { id: 'p-cinema', name: 'Cinema', colour: '#999999', isSystem: true }

const renderIn = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>)

describe('Chip and PersonName', () => {
  it('link people to their profiles', () => {
    renderIn(
      <>
        <Chip person={ada} />
        <PersonName person={ada} />
      </>,
    )
    for (const link of screen.getAllByRole('link', { name: 'Ada' })) {
      expect(link).toHaveAttribute('href', '/people/p-ada')
    }
    expect(screen.getAllByRole('link')).toHaveLength(2)
    expect(screen.getAllByRole('link')[0]).toHaveStyle({ color: '#000000' })
  })

  it('leave system profiles and unknown people unlinked', () => {
    renderIn(
      <>
        <Chip person={cinema} />
        <Chip person={undefined} />
        <PersonName person={cinema} />
        <PersonName person={undefined} />
      </>,
    )
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByText('Cinema', { selector: 'span.chip' })).toBeInTheDocument()
    expect(screen.getByText('Unknown', { selector: 'span.chip' })).toBeInTheDocument()
  })
})
