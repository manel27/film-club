import { describe, expect, it } from 'vitest'
import { classifySessionError } from './backend'
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
    ['/%09/evil.com', '/'],
    ['/\t/evil.com', '/'],
    ['/\n/evil.com', '/'],
    ['/\x00', '/'],
    ['/\x7f', '/'],
    ['/%2F/evil.com', '/'],
    ['/%5Cevil.com', '/'],
    ['/%E0%A4%A', '/'],
    ['/films/caf%C3%A9', '/films/caf%C3%A9'],
  ])('%j -> %s', (input, expected) => {
    expect(safeNextPath(input)).toBe(expected)
  })

  it('compares against the given origin', () => {
    expect(safeNextPath('/films/1', 'https://example.github.io')).toBe('/films/1')
  })
})

describe('classifySessionError', () => {
  it.each([
    [null, 'valid'],
    [{ name: 'AuthApiError', status: 403, code: 'user_not_found' }, 'invalid'],
    [{ name: 'AuthApiError', status: 403, code: 'session_not_found' }, 'invalid'],
    [{ name: 'AuthApiError', status: 401, code: 'bad_jwt' }, 'invalid'],
    [{ name: 'AuthSessionMissingError', status: 400 }, 'invalid'],
    [{ name: 'AuthRetryableFetchError', status: 0 }, 'unknown'],
    [{ name: 'AuthApiError', status: 500 }, 'unknown'],
  ])('%j -> %s', (error, expected) => {
    expect(classifySessionError(error)).toBe(expected)
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
