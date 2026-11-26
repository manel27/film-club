/**
 * Ref callback for the element around RoleChips (ref={tipsOff}). Escape anywhere
 * hides their tips (WCAG 1.4.13: a hovered tip too, whatever has focus) until the
 * pointer or focus moves inside the element again. A class, not React state, so
 * toggling it never re-renders a long list.
 */
export function tipsOff(el: HTMLElement | null) {
  if (!el) return
  const hide = (e: KeyboardEvent) => {
    if (e.key === 'Escape') el.classList.add('tips-off')
  }
  const show = () => el.classList.remove('tips-off')
  // A tip opened by a tap (focus) closes on a tap elsewhere: iOS keeps focus on the
  // tapped badge when the next tap lands on nothing focusable.
  const away = (e: PointerEvent) => {
    const focused = document.activeElement
    if (
      focused instanceof HTMLElement &&
      el.contains(focused) &&
      !focused.contains(e.target as Node)
    ) {
      focused.blur()
    }
  }
  document.addEventListener('keydown', hide)
  document.addEventListener('pointerdown', away)
  el.addEventListener('focusin', show)
  el.addEventListener('pointerover', show)
  return () => {
    document.removeEventListener('keydown', hide)
    document.removeEventListener('pointerdown', away)
    el.removeEventListener('focusin', show)
    el.removeEventListener('pointerover', show)
  }
}
