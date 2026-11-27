import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Person } from '../films/films'
import Chip, { PersonName, RoleChip } from './Chip'
import { tipsOff } from './tipsOff'

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

const bo: Person = { id: 'p-bo', name: 'Bo', colour: null, isSystem: false, role: 'moderator' }
const ada2: Person = { ...ada, role: 'admin' }

/** RoleChips inside tipsOff on '/', a stand-in profile page on '/people/:id'. */
function renderChips(people: Person[], extra?: React.ReactNode) {
  return render(
    <MemoryRouter>
      <Routes>
        <Route
          path="/"
          element={
            <div ref={tipsOff}>
              {people.map((p) => (
                <RoleChip key={p.id} person={p} />
              ))}
              {extra}
              <button type="button">Elsewhere</button>
            </div>
          }
        />
        <Route path="/people/:id" element={<h1>Profile page</h1>} />
      </Routes>
    </MemoryRouter>,
  )
}

const chip = (name: string) => screen.getByRole('link', { name })
const elsewhere = () => screen.getByRole('button', { name: 'Elsewhere' })
/** A tap or a mouse click: pointerdown, then a click with detail 1 (0 means the keyboard). */
function press(el: Element, pointerType: string, clickOn = el) {
  fireEvent.pointerDown(el, { pointerType })
  return fireEvent.click(clickOn, { detail: 1 })
}
const isOpen = (name: string) => chip(name).closest('.role-chip')!.classList.contains('tip-open')
const onProfile = () => screen.queryByText('Profile page') !== null

describe('RoleChip', () => {
  afterEach(() => vi.restoreAllMocks())

  it('describes the link with its role', () => {
    renderChips([bo])
    expect(chip('Bo')).toHaveAccessibleDescription('Moderator')
    expect(screen.getByRole('tooltip', { hidden: true })).toHaveTextContent('Moderator')
  })

  it('shows no tip, and no description, for a missing or unknown role', () => {
    renderChips([
      { ...bo, id: 'p-none', name: 'None', role: undefined },
      { ...bo, id: 'p-odd', name: 'Odd', role: 'superuser' as Person['role'] },
      { ...bo, id: 'p-proto', name: 'Proto', role: 'toString' as Person['role'] },
    ])
    for (const name of ['None', 'Odd', 'Proto']) {
      expect(chip(name)).not.toHaveAttribute('aria-describedby')
      expect(chip(name)).toHaveAttribute('href', `/people/p-${name.toLowerCase()}`)
    }
    expect(screen.queryByRole('tooltip', { hidden: true })).not.toBeInTheDocument()
    expect(screen.queryByText('Member')).not.toBeInTheDocument()
  })

  it('on touch, the first tap shows the tip without navigating; the second opens the profile', () => {
    renderChips([bo])
    expect(press(chip('Bo'), 'touch')).toBe(false) // default prevented: no navigation
    expect(isOpen('Bo')).toBe(true)
    expect(onProfile()).toBe(false)
    press(chip('Bo'), 'touch')
    expect(onProfile()).toBe(true)
  })

  it('a pen tap works like a touch', () => {
    renderChips([bo])
    expect(press(chip('Bo'), 'pen')).toBe(false)
    expect(isOpen('Bo')).toBe(true)
  })

  it('a mouse click navigates at once', () => {
    renderChips([bo])
    press(chip('Bo'), 'mouse')
    expect(onProfile()).toBe(true)
  })

  it('a click with no press first (screen reader activation) navigates at once', () => {
    renderChips([bo])
    fireEvent.click(chip('Bo'), { detail: 1 })
    expect(onProfile()).toBe(true)
  })

  it('keyboard Enter (a click with detail 0) navigates, even right after a touch press', () => {
    renderChips([bo])
    fireEvent.pointerDown(chip('Bo'), { pointerType: 'touch' })
    fireEvent.click(chip('Bo'), { detail: 0 })
    expect(onProfile()).toBe(true)
  })

  it('a touch press on one name and a click on another navigates', () => {
    renderChips([bo, ada2])
    press(chip('Bo'), 'touch', chip('Ada'))
    expect(onProfile()).toBe(true)
  })

  it('a touch press on a name that already has focus (screen readers focus first) navigates', () => {
    renderChips([bo])
    chip('Bo').focus()
    press(chip('Bo'), 'touch')
    expect(onProfile()).toBe(true)
  })

  it('a touch press counts once: a later click with no press of its own navigates', () => {
    renderChips([bo])
    fireEvent.pointerDown(chip('Bo'), { pointerType: 'touch' })
    fireEvent.click(elsewhere(), { detail: 1 })
    fireEvent.click(chip('Bo'), { detail: 1 })
    expect(onProfile()).toBe(true)
  })

  it('a tap elsewhere, Escape, a resize or focus on another name closes the tip', () => {
    renderChips([bo, ada2])
    press(chip('Bo'), 'touch')
    fireEvent.pointerDown(elsewhere(), { pointerType: 'touch' })
    expect(isOpen('Bo')).toBe(false)

    press(chip('Bo'), 'touch')
    press(chip('Ada'), 'touch')
    expect([isOpen('Bo'), isOpen('Ada')]).toEqual([false, true])
    expect(onProfile()).toBe(false)

    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(isOpen('Ada')).toBe(false)
    expect(chip('Ada').closest('div')).toHaveClass('tips-off')
    // Closed, so the next tap shows the tip again rather than navigating.
    expect(press(chip('Ada'), 'touch')).toBe(false)
    expect(isOpen('Ada')).toBe(true)

    fireEvent(window, new Event('resize'))
    expect(isOpen('Ada')).toBe(false)

    press(chip('Ada'), 'touch')
    chip('Bo').focus()
    expect(isOpen('Ada')).toBe(false)
  })

  it('a tap elsewhere keeps focus in a text field inside the same element', () => {
    renderChips([bo], <textarea aria-label="Comment" />)
    const field = screen.getByRole('textbox', { name: 'Comment' })
    field.focus()
    fireEvent.pointerDown(elsewhere(), { pointerType: 'touch' })
    expect(field).toHaveFocus()
    // A focused name, by contrast, lets go (its tip closes).
    chip('Bo').focus()
    fireEvent.pointerDown(elsewhere(), { pointerType: 'touch' })
    expect(chip('Bo')).not.toHaveFocus()
  })

  it('nested containers: one tap on an inner name opens one tip, the next navigates', () => {
    render(
      <MemoryRouter>
        <Routes>
          <Route
            path="/"
            element={
              <div ref={tipsOff}>
                <div ref={tipsOff}>
                  <RoleChip person={bo} />
                </div>
              </div>
            }
          />
          <Route path="/people/:id" element={<h1>Profile page</h1>} />
        </Routes>
      </MemoryRouter>,
    )
    expect(press(chip('Bo'), 'touch')).toBe(false)
    expect(document.querySelectorAll('.tip-open')).toHaveLength(1)
    press(chip('Bo'), 'touch')
    expect(onProfile()).toBe(true)
  })

  it('after unmounting, Escape, pointerdown, resize and click do nothing', () => {
    const { unmount } = renderChips([bo])
    const link = chip('Bo')
    const owner = link.closest('.role-chip')!
    const container = owner.parentElement!
    unmount()
    document.body.append(container) // the detached element, to see whether anything still reacts
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(container).not.toHaveClass('tips-off')
    owner.classList.add('tip-open')
    fireEvent.pointerDown(document.body, { pointerType: 'touch' })
    fireEvent(window, new Event('resize'))
    expect(owner).toHaveClass('tip-open')
    owner.classList.remove('tip-open')
    expect(press(link, 'touch')).toBe(true) // not prevented
    expect(owner).not.toHaveClass('tip-open')
    container.remove()
  })

  it('shifts a shown tip back on screen when it would cross an edge', () => {
    renderChips([bo])
    const tip = screen.getByRole('tooltip', { hidden: true })
    const rect = (left: number, width: number) =>
      vi
        .spyOn(tip, 'getBoundingClientRect')
        .mockReturnValue({ left, right: left + width, width } as DOMRect)
    vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(360)
    rect(-20, 80)
    press(chip('Bo'), 'touch')
    expect(tip.style.translate).toBe('28px') // back to 8px from the left edge
    rect(330, 80)
    fireEvent.focusIn(chip('Bo'))
    expect(tip.style.translate).toBe('-58px') // 8px from the right edge
    rect(100, 80)
    fireEvent.pointerOver(chip('Bo'))
    expect(tip.style.translate).toBe('')
    rect(0, 0) // hidden: not measured, not moved
    fireEvent.pointerOver(chip('Bo'))
    expect(tip.style.translate).toBe('')
  })

  it('keeps a tip inside its sideways-scrolling table box rather than the screen', () => {
    renderChips(
      [],
      <div className="table-scroll">
        <RoleChip person={bo} />
      </div>,
    )
    const tip = screen.getByRole('tooltip', { hidden: true })
    vi.spyOn(tip, 'getBoundingClientRect').mockReturnValue({
      left: 250,
      right: 330,
      width: 80,
    } as DOMRect)
    vi.spyOn(tip.closest('.table-scroll')!, 'getBoundingClientRect').mockReturnValue({
      left: 16,
      right: 300,
    } as DOMRect)
    vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(360)
    fireEvent.focusIn(chip('Bo'))
    expect(tip.style.translate).toBe('-38px') // 8px inside the box's right edge, not the screen's
  })
})
