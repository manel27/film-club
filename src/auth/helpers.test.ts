import { describe, expect, it } from 'vitest'
import { loginErrorMessage } from './errors'
import { loginPathFor, safeNextPath } from './redirect'

describe('loginErrorMessage', () => {
  it.each([
    [
      { name: 'AuthApiError', status: 400, code: 'invalid_credentials' },
      'Wrong email or password.',
    ],
    [{ name: 'AuthApiError', status: 400 }, 'Wrong email or password.'],
    [{ name: 'AuthApiError', status: 429, code: 'over_request_rate_limit' }, 'Too many attempts'],
    [{ name: 'AuthApiError', status: 400, code: 'user_banned' }, 'disabled'],
    [{ name: 'AuthRetryableFetchError', status: 0 }, "Couldn't reach the server"],
    [new TypeError('Failed to fetch'), "Couldn't reach the server"],
    [{ name: 'AuthApiError', status: 503 }, "Couldn't reach the server"],
    [{ name: 'AuthApiError', status: 422, code: 'something_else' }, 'Something went wrong'],
    [undefined, 'Something went wrong'],
  ])('maps %o', (error, expected) => {
    expect(loginErrorMessage(error)).toContain(expected)
  })

  it('never echoes the server message', () => {
    const message = loginErrorMessage({ status: 422, message: 'secret detail for someone@x' })
    expect(message).not.toContain('secret detail')
  })
})

describe('safeNextPath', () => {
  it.each([
    ['/films/12', '/films/12'],
    ['/films?sort=oldest', '/films?sort=oldest'],
    [null, '/'],
    [undefined, '/'],
    ['', '/'],
    ['films', '/'],
    ['//evil.example', '/'],
    ['/\\evil.example', '/'],
    ['https://evil.example', '/'],
    ['/login', '/'],
    ['/login?next=%2F', '/'],
  ])('%s -> %s', (input, expected) => {
    expect(safeNextPath(input)).toBe(expected)
  })
})

describe('loginPathFor', () => {
  it('adds no destination for home', () => {
    expect(loginPathFor('/')).toBe('/login')
  })

  it('encodes the destination', () => {
    expect(loginPathFor('/films/12?sort=oldest')).toBe('/login?next=%2Ffilms%2F12%3Fsort%3Doldest')
  })
})
