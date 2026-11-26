import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { KindBadge } from './FilmViews'

// jsdom has no CSS: showing the tip on hover/focus and Escape are covered in e2e/films.spec.ts.
describe('KindBadge', () => {
  it('shows nothing for a normal film and a plain badge for other kinds', () => {
    const { container } = render(<KindBadge kind="normal" reason="ignored" />)
    expect(container).toBeEmptyDOMElement()
    render(<KindBadge kind="cinema" tabbable />)
    const badge = screen.getByText('Cinema')
    expect(badge).not.toHaveAttribute('tabindex')
    expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull()
  })

  it("describes a Democrático with its reason, or 'Unknown reason'", () => {
    render(
      <>
        <KindBadge kind="democratico" reason="Nobody agreed" />
        <KindBadge kind="democratico" reason={null} />
        <KindBadge kind="democratico" />
      </>,
    )
    const [withReason, ...unknown] = screen.getAllByText('Democrático')
    expect(withReason).toHaveAccessibleDescription('Nobody agreed')
    for (const badge of unknown) expect(badge).toHaveAccessibleDescription('Unknown reason')
  })

  it('adds a Tab stop only when tabbable; a tap focuses it (focus shows the tip)', () => {
    render(
      <>
        <KindBadge kind="democratico" reason="In a list" />
        <KindBadge kind="democratico" reason="On the film page" tabbable />
      </>,
    )
    const [inList, onPage] = screen.getAllByText('Democrático')
    expect(inList).not.toHaveAttribute('tabindex')
    expect(onPage).toHaveAttribute('tabindex', '0')
    fireEvent.click(onPage)
    expect(onPage).toHaveFocus()
    fireEvent.click(inList)
    expect(inList).not.toHaveFocus()
  })
})
