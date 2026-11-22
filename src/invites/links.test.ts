import { describe, expect, it } from 'vitest'
import {
  adminLinkErrorMessage,
  INVALID_LINK_MESSAGE,
  linkErrorMessage,
  linkLabel,
  passwordProblem,
  watchedLine,
} from './links'

describe('linkErrorMessage', () => {
  it('gives one message for every bad link', () => {
    expect(linkErrorMessage({ status: 404, error: 'invalid_link' })).toBe(INVALID_LINK_MESSAGE)
    expect(INVALID_LINK_MESSAGE).toMatch(/Ask Manel for a new link/)
  })

  it('explains the rate limit, a taken email, bad input and the network', () => {
    expect(linkErrorMessage({ status: 429 })).toMatch(/Wait an hour/)
    expect(linkErrorMessage({ status: 409, error: 'email_taken' })).toMatch(
      /already has an account/,
    )
    expect(linkErrorMessage({ status: 400 })).toMatch(/Check the email and password/)
    expect(linkErrorMessage({ status: 0 })).toMatch(/Couldn't reach the server/)
    expect(linkErrorMessage({ status: 500 })).toBe('Something went wrong. Try again.')
  })
})

describe('adminLinkErrorMessage', () => {
  it('maps refusals to friendly text', () => {
    expect(adminLinkErrorMessage({ status: 409 })).toMatch(/colour and login/)
    expect(adminLinkErrorMessage({ status: 403 })).toBe('Only the admin can do that.')
    expect(adminLinkErrorMessage({ status: 401 })).toMatch(/session has ended/)
  })
})

describe('passwordProblem', () => {
  it('needs 8 to 72 characters, typed the same twice', () => {
    expect(passwordProblem('1234567', '1234567')).toBe('Use at least 8 characters.')
    expect(passwordProblem('x'.repeat(73), 'x'.repeat(73))).toBe('Use at most 72 characters.')
    expect(passwordProblem('12345678', '12345679')).toBe("The passwords don't match.")
    expect(passwordProblem('12345678', '12345678')).toBeNull()
  })
})

describe('watchedLine', () => {
  it('counts screenings, or welcomes someone new', () => {
    expect(watchedLine(0)).toBe('Welcome to the club!')
    expect(watchedLine(1)).toBe("You've been at 1 club screening so far.")
    expect(watchedLine(42)).toBe("You've been at 42 club screenings so far.")
  })
})

describe('linkLabel', () => {
  const now = new Date('2026-11-22T12:00:00Z')
  const link = { id: '1', profileId: 'p', kind: 'invite' as const }

  it('says until when a link is open, in Lisbon time', () => {
    expect(linkLabel({ ...link, expiresAt: '2026-12-06T12:00:00Z' }, now)).toBe(
      'Invite open until 6 Dec 2026, 12:00',
    )
  })

  it('says when a link expired (summer time in Lisbon)', () => {
    expect(linkLabel({ ...link, kind: 'reset', expiresAt: '2026-07-01T09:00:00Z' }, now)).toBe(
      'Reset link expired 1 Jul 2026, 10:00',
    )
  })
})
