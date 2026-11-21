import { describe, expect, it } from 'vitest'
import { textOn } from '../lib/colour'
import { fakeProfile } from '../test/fakeAuthBackend'
import { parseScore, permissions } from './filmDetail'

describe('parseScore', () => {
  it.each([
    ['0', 0],
    ['10', 10],
    ['7.25', 7.25],
    [' 7,5 ', 7.5],
    ['10.00', 10],
  ])('accepts %j', (text, score) => {
    expect(parseScore(text)).toEqual({ score })
  })

  it.each([
    ['', 'Enter a number from 0 to 10.'],
    ['abc', 'Enter a number from 0 to 10.'],
    ['-1', 'Enter a number from 0 to 10.'],
    ['7.255', 'Use at most two decimals.'],
    ['10.01', 'Scores go from 0 to 10.'],
    ['11', 'Scores go from 0 to 10.'],
  ])('rejects %j', (text, error) => {
    expect(parseScore(text)).toEqual({ error })
  })
})

describe('permissions', () => {
  const me = (role: 'admin' | 'moderator' | 'member' | 'viewer') =>
    permissions(fakeProfile({ id: 'me', role }), false)

  it('lets members change only their own attendance, score and comments', () => {
    const p = me('member')
    expect([p.attendance('me'), p.score('me'), p.comment('me')]).toEqual([true, true, true])
    expect([p.attendance('x'), p.score('x'), p.comment('x')]).toEqual([false, false, false])
  })

  it("lets moderators change anyone's attendance and scores, but not others' comments", () => {
    const p = me('moderator')
    expect([p.attendance('x'), p.score('x'), p.comment('x'), p.comment('me')]).toEqual([
      true,
      true,
      false,
      true,
    ])
  })

  it("lets the admin change others' comments", () => {
    expect(me('admin').comment('x')).toBe(true)
  })

  it('lets viewers change nothing', () => {
    const p = me('viewer')
    expect([p.canWrite, p.attendance('me'), p.score('me'), p.comment('me')]).toEqual([
      false,
      false,
      false,
      false,
    ])
  })

  it('locks scores for everyone, admin included', () => {
    expect(permissions(fakeProfile({ id: 'me', role: 'admin' }), true).score('me')).toBe(false)
  })
})

describe('textOn', () => {
  it('picks readable text for a person colour', () => {
    expect(textOn('#ffffff')).toBe('#000000')
    expect(textOn('#ffd200')).toBe('#000000')
    expect(textOn('#0b3d91')).toBe('#ffffff')
    expect(textOn('#000000')).toBe('#ffffff')
  })
})
