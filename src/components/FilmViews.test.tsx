import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { KindBadge } from './FilmViews'
import { tipsOff } from './tipsOff'

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

  it('in lists: no Tab stop, the reason read as text after the badge, the tip visual only', () => {
    const { container } = render(
      <>
        <KindBadge kind="democratico" reason="Nobody agreed" />
        <KindBadge kind="democratico" reason={null} />
      </>,
    )
    const [withReason, unknown] = screen.getAllByText('Democrático')
    expect(withReason).not.toHaveAttribute('tabindex')
    expect(withReason).not.toHaveAttribute('aria-describedby')
    expect(container).toHaveTextContent(
      'Democrático (Why: Nobody agreed)Nobody agreedDemocrático (Unknown reason)Unknown reason',
    )
    expect(unknown.nextElementSibling).toHaveClass('sr-only')
    expect(screen.queryAllByRole('tooltip')).toHaveLength(0) // aria-hidden
  })

  it('tabbable: described by its tip, or by the text the page already shows', () => {
    render(
      <>
        <KindBadge kind="democratico" reason="On the card" tabbable />
        <KindBadge kind="democratico" reason="On the page" tabbable describedBy="why" />
        <p id="why">Why: On the page</p>
      </>,
    )
    const [card, page] = screen.getAllByText('Democrático')
    expect(card).toHaveAttribute('tabindex', '0')
    expect(card).toHaveAccessibleDescription('On the card')
    expect(page).toHaveAccessibleDescription('Why: On the page')
    expect(screen.getAllByRole('tooltip', { hidden: true })[1]).toHaveAttribute(
      'aria-hidden',
      'true',
    )
    expect(document.querySelectorAll('.sr-only')).toHaveLength(0)
  })

  it('a tap focuses a tabbable badge (focus shows the tip); a tap elsewhere closes it', () => {
    render(
      <>
        <div ref={tipsOff}>
          <KindBadge kind="democratico" reason="In a list" />
          <KindBadge kind="democratico" reason="On the film page" tabbable />
        </div>
        <p>Elsewhere</p>
      </>,
    )
    const [inList, onPage] = screen.getAllByText('Democrático')
    fireEvent.click(inList)
    expect(inList).not.toHaveFocus()
    fireEvent.click(onPage)
    expect(onPage).toHaveFocus()
    fireEvent.pointerDown(onPage)
    expect(onPage).toHaveFocus()
    fireEvent.pointerDown(screen.getByText('Elsewhere'))
    expect(onPage).not.toHaveFocus()
  })
})
