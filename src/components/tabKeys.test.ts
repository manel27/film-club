import { describe, expect, it } from 'vitest'
import { tabKeyIndex } from './tabKeys'

describe('tabKeyIndex', () => {
  it('moves left and right, wrapping at both ends', () => {
    expect(tabKeyIndex('ArrowRight', 1, 4)).toBe(2)
    expect(tabKeyIndex('ArrowRight', 3, 4)).toBe(0)
    expect(tabKeyIndex('ArrowLeft', 2, 4)).toBe(1)
    expect(tabKeyIndex('ArrowLeft', 0, 4)).toBe(3)
  })

  it('jumps to the first and last tab with Home and End', () => {
    expect(tabKeyIndex('Home', 2, 4)).toBe(0)
    expect(tabKeyIndex('End', 1, 4)).toBe(3)
  })

  it.each(['ArrowDown', 'ArrowUp', 'Enter', 'a', 'toString', ''])('ignores %j', (key) => {
    expect(tabKeyIndex(key, 1, 4)).toBeUndefined()
  })
})
