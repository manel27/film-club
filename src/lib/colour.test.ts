import { describe, expect, it } from 'vitest'
import { textOn } from './colour'

describe('textOn', () => {
  it('picks readable text for a person colour', () => {
    expect(textOn('#ffffff')).toBe('#000000')
    expect(textOn('#ffd200')).toBe('#000000')
    expect(textOn('#0b3d91')).toBe('#ffffff')
    expect(textOn('#000000')).toBe('#ffffff')
  })
})
