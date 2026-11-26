import { useState } from 'react'

/** Props for the element around RoleChips: Escape hides their tips (WCAG 1.4.13) until the pointer or focus moves. */
export function useTipsOff() {
  const [off, setOff] = useState(false)
  return {
    className: off ? 'tips-off' : '',
    onKeyDown: (e: React.KeyboardEvent) => e.key === 'Escape' && setOff(true),
    onFocus: () => setOff(false),
    onPointerOver: () => setOff(false),
  }
}
