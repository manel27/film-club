/**
 * WAI-ARIA tabs keyboard: the index a key moves to from the pressed tab `i` of `n`
 * (Left and Right wrap, Home and End jump to the ends), or undefined for any other key.
 * Callers pass the pressed tab's own index, not the selected tab from the last render:
 * a second key pressed before the re-render would otherwise move from a stale one.
 */
export function tabKeyIndex(key: string, i: number, n: number): number | undefined {
  switch (key) {
    case 'ArrowLeft':
      return (i - 1 + n) % n
    case 'ArrowRight':
      return (i + 1) % n
    case 'Home':
      return 0
    case 'End':
      return n - 1
  }
}
