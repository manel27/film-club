import { describe, expect, it } from 'vitest'
import { CLASH_DELTA_E, colourClashes, deltaE, textOn } from './colour'

describe('textOn', () => {
  it('picks readable text for a person colour', () => {
    expect(textOn('#ffffff')).toBe('#000000')
    expect(textOn('#ffd200')).toBe('#000000')
    expect(textOn('#0b3d91')).toBe('#ffffff')
    expect(textOn('#000000')).toBe('#ffffff')
  })
})

describe('deltaE (CIE76)', () => {
  it('is 0 for the same colour and symmetric', () => {
    expect(deltaE('#4a86e8', '#4a86e8')).toBe(0)
    expect(deltaE('#4a86e8', '#e06666')).toBeCloseTo(deltaE('#e06666', '#4a86e8'), 10)
  })

  it('matches known Lab values', () => {
    // Black to white is the whole L* axis.
    expect(deltaE('#000000', '#ffffff')).toBeCloseTo(100, 1)
    // sRGB red is L*a*b* (53.24, 80.09, 67.20), so its distance to black is |Lab|.
    expect(deltaE('#ff0000', '#000000')).toBeCloseTo(Math.hypot(53.24, 80.09, 67.2), 0)
    // Greys differ only in L*: #777777 is L* 50.05, #888888 is L* 56.72.
    expect(deltaE('#777777', '#888888')).toBeCloseTo(6.67, 1)
    // A very dark grey uses the linear part of the Lab curve: #010101 is L* 0.27.
    expect(deltaE('#010101', '#000000')).toBeCloseTo(0.27, 2)
  })
})

describe('colourClashes', () => {
  const people = [
    { id: 'a', colour: '#3d85c6', isSystem: false, name: 'Ana' },
    { id: 'b', colour: '#ff9900', isSystem: false, name: 'Bea' },
    { id: 'c', colour: '#6d9eea', isSystem: true, name: 'Cinema' },
    { id: 'd', colour: null, isSystem: false, name: 'Dee' },
    { id: 'e', colour: '#4a86e8', isSystem: false, name: 'Eve' },
  ]

  it('names people with a too-close colour, closest first', () => {
    // Ana ≈ 13.2, Eve ≈ 15.8.
    expect(colourClashes('#6d9eeb', people).map((p) => p.name)).toEqual(['Ana', 'Eve'])
    // Ana and Eve are ≈ 20.3 apart: just over the line.
    expect(colourClashes('#4a86e8', people).map((p) => p.name)).toEqual(['Eve'])
  })

  it('leaves out system profiles, people without a colour and the person themselves', () => {
    expect(colourClashes('#6d9eeb', people, 'a').map((p) => p.name)).toEqual(['Eve'])
    expect(colourClashes('#6d9eea', people).map((p) => p.name)).not.toContain('Cinema')
  })

  it('lets distinct colours through (orange vs yellow is about 28)', () => {
    expect(deltaE('#ff9900', '#f1c232')).toBeGreaterThan(CLASH_DELTA_E)
    expect(colourClashes('#f1c232', people)).toEqual([])
  })
})
