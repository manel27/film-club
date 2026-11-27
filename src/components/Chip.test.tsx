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
function renderChips(people: Person[]) {
  render(
    <MemoryRouter>
      <Routes>
        <Route
          path="/"
          element={
            <div ref={tipsOff}>
              {people.map((p) => (
                <RoleChip key={p.id} person={p} />
              ))}
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
/** A tap or a mouse click: pointerdown, then a click with detail 1 (0 means the keyboard). */
function press(el: Element, pointerType: string) {
  fireEvent.pointerDown(el, { pointerType })
  return fireEvent.click(el, { detail: 1 })
}
const isOpen = (name: string) => chip(name).closest('.role-chip')!.classList.contains('tip-open')

describe('RoleChip', () => {
  afterEach(() => vi.unstubAllGlobals())

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
    expect(screen.queryByText('Profile page')).not.toBeInTheDocument()
    press(chip('Bo'), 'touch')
    expect(screen.getByText('Profile page')).toBeInTheDocument()
  })

  it('a pen tap works like a touch', () => {
    renderChips([bo])
    expect(press(chip('Bo'), 'pen')).toBe(false)
    expect(isOpen('Bo')).toBe(true)
  })

  it('a tap elsewhere or Escape closes the tip, and only one tip is open at a time', () => {
    renderChips([bo, ada2])
    press(chip('Bo'), 'touch')
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Elsewhere' }), {
      pointerType: 'touch',
    })
    expect(isOpen('Bo')).toBe(false)

    press(chip('Bo'), 'touch')
    press(chip('Ada'), 'touch')
    expect(isOpen('Bo')).toBe(false)
    expect(isOpen('Ada')).toBe(true)
    expect(screen.queryByText('Profile page')).not.toBeInTheDocument()

    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(isOpen('Ada')).toBe(false)
    expect(chip('Ada').closest('div')).toHaveClass('tips-off')
    // Closed, so the next tap shows the tip again rather than navigating.
    expect(press(chip('Ada'), 'touch')).toBe(false)
    expect(isOpen('Ada')).toBe(true)
  })

  it('a mouse click navigates at once', () => {
    renderChips([bo])
    press(chip('Bo'), 'mouse')
    expect(screen.getByText('Profile page')).toBeInTheDocument()
  })

  it('keyboard Enter (a click with detail 0) navigates at once, even on a touch screen', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    renderChips([bo])
    fireEvent.click(chip('Bo'), { detail: 0 })
    expect(screen.getByText('Profile page')).toBeInTheDocument()
  })

  it('with no pointer seen, a screen without hover counts as touch', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(hover: none)' }))
    renderChips([bo])
    expect(fireEvent.click(chip('Bo'), { detail: 1 })).toBe(false)
    expect(isOpen('Bo')).toBe(true)
  })

  it('with no pointer seen, a screen with hover navigates at once', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    renderChips([bo])
    fireEvent.click(chip('Bo'), { detail: 1 })
    expect(screen.getByText('Profile page')).toBeInTheDocument()
  })

  it('shifts an open tip back on screen when it would cross an edge', () => {
    renderChips([bo])
    const tip = screen.getByRole('tooltip', { hidden: true })
    const rect = (left: number, width: number) =>
      vi.spyOn(tip, 'getBoundingClientRect').mockReturnValue({
        left,
        right: left + width,
        width,
      } as DOMRect)
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
})
