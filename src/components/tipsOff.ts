/**
 * Ref callback for the element around RoleChips (ref={tipsOff}). Escape anywhere
 * hides their tips (WCAG 1.4.13: a hovered tip too, whatever has focus) until the
 * pointer or focus moves inside the element again. Classes, not React state, so
 * toggling them never re-renders a long list; one set of delegated listeners per
 * element, none per chip.
 *
 * Touch (or pen): the first tap on a name link shows its tip (class `tip-open`) and
 * doesn't navigate; a second tap on it opens the profile. A tap elsewhere or Escape
 * closes it. Mouse clicks and keyboard Enter navigate at once.
 */
export function tipsOff(el: HTMLElement | null) {
  if (!el) return
  const closeOpen = (except?: Node) => {
    for (const open of el.querySelectorAll('.tip-open')) {
      if (!except || !open.contains(except)) open.classList.remove('tip-open')
    }
  }
  const hide = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return
    el.classList.add('tips-off')
    closeOpen()
  }
  const show = (e: Event) => {
    el.classList.remove('tips-off')
    place(e.target)
  }
  // A tip opened by a tap (focus) closes on a tap elsewhere: iOS keeps focus on the
  // tapped badge when the next tap lands on nothing focusable.
  const away = (e: PointerEvent) => {
    const target = e.target as Node
    closeOpen(target)
    const focused = document.activeElement
    if (focused instanceof HTMLElement && el.contains(focused) && !focused.contains(target)) {
      focused.blur()
    }
  }
  let pointer = ''
  const down = (e: PointerEvent) => (pointer = e.pointerType)
  const click = (e: MouseEvent) => {
    // detail 0: a click from the keyboard (Enter), which navigates as always.
    if (e.detail === 0 || !(e.target instanceof Element)) return
    const chip = e.target.closest('a.chip')?.closest('.role-chip')
    if (!chip || !el.contains(chip) || chip.classList.contains('tip-open')) return
    const touch = pointer ? pointer !== 'mouse' : window.matchMedia?.('(hover: none)').matches
    if (!touch) return
    e.preventDefault()
    el.classList.remove('tips-off')
    chip.classList.add('tip-open')
    place(chip)
  }
  document.addEventListener('keydown', hide)
  document.addEventListener('pointerdown', away)
  el.addEventListener('focusin', show)
  el.addEventListener('pointerover', show)
  el.addEventListener('pointerdown', down)
  el.addEventListener('click', click)
  return () => {
    document.removeEventListener('keydown', hide)
    document.removeEventListener('pointerdown', away)
    el.removeEventListener('focusin', show)
    el.removeEventListener('pointerover', show)
    el.removeEventListener('pointerdown', down)
    el.removeEventListener('click', click)
  }
}

/** Gap kept between a tip and the screen's edges, in px (the page's side gutter). */
const EDGE = 8

/**
 * Keeps the tip of the chip around `target` on screen: shifts it sideways if it would
 * cross either edge. Measures only that one tip, and only while it shows (an open tip
 * has a size; a hidden one has none).
 */
function place(target: EventTarget | null) {
  if (!(target instanceof Element)) return
  const tip = target.closest('.role-chip')?.querySelector<HTMLElement>(':scope > .role-tip')
  if (!tip) return
  tip.style.translate = ''
  const { left, right, width } = tip.getBoundingClientRect()
  if (!width) return
  const shift = Math.max(
    EDGE - left,
    Math.min(0, document.documentElement.clientWidth - EDGE - right),
  )
  if (shift) tip.style.translate = `${shift}px`
}
