import { describe, expect, it } from 'vitest'
import { fakeProfile } from '../test/fakeAuthBackend'
import { errorMessage, NO_ROWS, parseScore, permissions } from './filmDetail'

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

describe('errorMessage', () => {
  it.each([
    [
      { code: '42501', message: 'new row violates row-level security policy' },
      "You can't change that.",
    ],
    [{ code: '42501', message: 'Scores for this film are locked' }, 'These scores are locked.'],
    [{ code: '23505', message: 'duplicate key value' }, 'That was already saved — refreshed.'],
    [{ code: '23514', message: 'Score must be between 0 and 10' }, "That value isn't allowed."],
    [{ code: '22P02', message: 'invalid input syntax' }, "That value isn't allowed."],
    [{ code: '', message: 'TypeError: Failed to fetch' }, "Couldn't reach the server. Try again."],
    [{ code: 'XX000', message: 'internal' }, 'Something went wrong. Try again.'],
    [NO_ROWS, 'This was changed or removed elsewhere.'],
  ])('never shows raw database text (%j)', (error, message) => {
    expect(errorMessage(error)).toBe(message)
  })
})
