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
  document.addEventListener('keydown', hide)
  el.addEventListener('focusin', show)
  el.addEventListener('pointerover', show)
  return () => {
    document.removeEventListener('keydown', hide)
    el.removeEventListener('focusin', show)
    el.removeEventListener('pointerover', show)
  }
}
