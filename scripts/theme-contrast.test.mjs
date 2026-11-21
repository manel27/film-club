// WCAG AA contrast check over the theme tokens in src/index.css (plan 9).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')

/** WCAG 2.x relative luminance of a #rrggbb colour. @param {string} hex */
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** @param {string} a @param {string} b */
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** { theme: { token: '#hex' } } for every [data-theme='…'] block. */
const themes = Object.fromEntries(
  [...css.matchAll(/\[data-theme='([\w-]+)'\]\s*\{([^}]*)\}/g)].map(([, name, block]) => [
    name,
    Object.fromEntries(
      [...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})\b/gi)].map((m) => m.slice(1)),
    ),
  ]),
)

// 4.5:1 for normal text; 3:1 for focus rings and control borders (1.4.11).
/** @type {[string, string, number][]} */
const PAIRS = [
  ['text', 'bg', 4.5],
  ['text', 'surface', 4.5],
  ['muted', 'bg', 4.5],
  ['muted', 'surface', 4.5],
  ['accent', 'bg', 4.5],
  ['accent', 'surface', 4.5],
  ['accent-text', 'accent', 4.5],
  ['danger', 'bg', 4.5],
  ['danger', 'surface', 4.5],
  // Text on the destructive button (.button-danger).
  ['bg', 'danger', 4.5],
  ['focus', 'bg', 3],
  ['focus', 'surface', 3],
  ['border', 'bg', 3],
  ['border', 'surface', 3],
]

it('finds the three themes', () => {
  expect(Object.keys(themes).sort()).toEqual(['batman', 'letterboxd', 'superman'])
})

describe.each(Object.keys(themes))('%s theme', (theme) => {
  it.each(PAIRS)('--%s on --%s is at least %s:1', (fg, bg, min) => {
    expect(contrast(themes[theme][fg], themes[theme][bg])).toBeGreaterThanOrEqual(min)
  })
})
