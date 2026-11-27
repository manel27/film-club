import { describe, expect, it } from 'vitest'
import { parseId } from './ids'

describe('parseId', () => {
  it('accepts positive whole numbers', () => {
    expect(parseId('1')).toBe(1)
    expect(parseId('9007199254740991')).toBe(9007199254740991)
  })

  it('refuses everything else', () => {
    for (const bad of ['', '0', '-1', '1.5', '1e3', ' 1', '1\u200b', 'abc', '9007199254740992']) {
      expect(parseId(bad), JSON.stringify(bad)).toBeNull()
    }
  })
})
