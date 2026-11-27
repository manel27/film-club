/**
 * Ref callback for the element around RoleChips (ref={tipsOff}). Escape anywhere
 * hides their tips (WCAG 1.4.13: a hovered tip too, whatever has focus) until the
 * pointer or focus moves inside the element again. Classes, not React state, so
 * toggling them never re-renders a long list; one set of delegated listeners per
 * element, none per chip.
 *
 * Touch (or pen): the first tap on a name link shows its tip (class `tip-open`) and
 * doesn't navigate; a second tap on it opens the profile. A tap elsewhere, focus
 * elsewhere, a resize or Escape closes it. Mouse clicks, keyboard Enter and screen
 * reader activation (a click with no touch press on that link, or on a link that
 * already had focus) navigate at once.
 */
export function tipsOff(el: HTMLElement | null) {
  if (!el) return
  const closeOpen = (except?: EventTarget | null) => {
    for (const open of el.querySelectorAll('.tip-open')) {
      if (!(except instanceof Node && open.contains(except))) open.classList.remove('tip-open')
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
  const refocus = (e: FocusEvent) => closeOpen(e.target)
  const resize = () => closeOpen()
  // A tip opened by a tap (focus) closes on a tap elsewhere: iOS keeps focus on the
  // tapped badge when the next tap lands on nothing focusable. Only tip owners lose
  // focus: never a textarea or input inside the same element.
  const away = (e: PointerEvent) => {
    const target = e.target as Node
    closeOpen(target)
    const focused = document.activeElement
    if (
      focused instanceof HTMLElement &&
      el.contains(focused) &&
      focused.closest('.role-chip') &&
      !focused.contains(target)
    ) {
      focused.blur()
    }
  }
  // The press that leads to a click: which link, which pointer, and whether that link
  // already had focus (screen readers focus it before activating it).
  let press: { link: Element; touch: boolean; focused: boolean } | null = null
  const down = (e: PointerEvent) => {
    const link = e.target instanceof Element ? e.target.closest('a.chip') : null
    press = link && {
      link,
      touch: e.pointerType === 'touch' || e.pointerType === 'pen',
      focused: link === document.activeElement,
    }
  }
  const click = (e: MouseEvent) => {
    const p = press
    press = null
    const link = e.target instanceof Element ? e.target.closest('a.chip') : null
    const chip = link?.closest('.role-chip')
    // detail 0: from the keyboard, even after a press that never became a click.
    if (!chip || !p?.touch || p.link !== link || p.focused || e.detail === 0) return
    if (chip.classList.contains('tip-open')) return
    e.preventDefault()
    el.classList.remove('tips-off')
    chip.classList.add('tip-open')
    place(chip)
  }
  document.addEventListener('keydown', hide)
  document.addEventListener('pointerdown', away)
  document.addEventListener('focusin', refocus)
  window.addEventListener('resize', resize)
  el.addEventListener('focusin', show)
  el.addEventListener('pointerover', show)
  el.addEventListener('pointerdown', down)
  el.addEventListener('click', click)
  return () => {
    document.removeEventListener('keydown', hide)
    document.removeEventListener('pointerdown', away)
    document.removeEventListener('focusin', refocus)
    window.removeEventListener('resize', resize)
    el.removeEventListener('focusin', show)
    el.removeEventListener('pointerover', show)
    el.removeEventListener('pointerdown', down)
    el.removeEventListener('click', click)
  }
}

/** Gap kept between a tip and the edge of the screen or of its scroll box, in px. */
const EDGE = 8

/**
 * Keeps the tip of the chip around `target` inside its scroll box (a sideways-scrolling
 * table clips it) or else the screen: shifts it sideways if it would cross either edge.
 * Measures only that one tip, and only while it shows (a hidden tip has no size).
 */
function place(target: EventTarget | null) {
  if (!(target instanceof Element)) return
  const tip = target.closest('.role-chip')?.querySelector<HTMLElement>(':scope > .role-tip')
  if (!tip) return
  tip.style.translate = ''
  const { left, right, width } = tip.getBoundingClientRect()
  if (!width) return
  const box = tip.closest('.table-scroll')?.getBoundingClientRect() ?? {
    left: 0,
    right: document.documentElement.clientWidth,
  }
  const shift = Math.max(box.left + EDGE - left, Math.min(0, box.right - EDGE - right))
  if (shift) tip.style.translate = `${shift}px`
}
