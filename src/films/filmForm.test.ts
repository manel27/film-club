import { describe, expect, it } from 'vitest'
import {
  alreadyWatched,
  chooserForKind,
  comingSaturday,
  defaultChooser,
  functionErrorMessage,
  parseYear,
  screeningDateRange,
  toSaveBody,
  validScreeningDate,
  type FilmFormState,
} from './filmForm'
import type { Person } from './films'

const people: Person[] = [
  { id: 'p-manel', name: 'Manel', colour: '#000000', isSystem: false },
  { id: 'p-ada', name: 'Ada', colour: null, isSystem: false },
  { id: 'p-cinema', name: 'Cinema', colour: null, isSystem: true },
  { id: 'p-archive', name: 'Sheet archive', colour: null, isSystem: true },
]

const base: FilmFormState = {
  picked: { tmdb_id: 42, title: 'Glass River', original_title: null, year: 2001 },
  manual: false,
  title: '',
  year: '',
  screenedOn: '2026-11-28',
  kind: 'normal',
  assignedId: 'p-ada',
  turnHolderId: '',
}

describe('comingSaturday', () => {
  it('is today on a Saturday and the next Saturday otherwise (Lisbon time)', () => {
    expect(comingSaturday(new Date('2026-11-21T10:00:00Z'))).toBe('2026-11-21') // Saturday
    expect(comingSaturday(new Date('2026-11-22T10:00:00Z'))).toBe('2026-11-28') // Sunday
    expect(comingSaturday(new Date('2026-11-27T23:30:00Z'))).toBe('2026-11-28') // Friday night
    // 23:30 UTC on Friday 2026-07-31 is already Saturday 00:30 in Lisbon (summer time).
    expect(comingSaturday(new Date('2026-07-31T23:30:00Z'))).toBe('2026-08-01')
    expect(comingSaturday(new Date('2026-12-27T12:00:00Z'))).toBe('2027-01-02') // across a year
  })
})

describe('choosers', () => {
  it('defaults Maratona to Manel and Cinema to the Cinema profile', () => {
    expect(defaultChooser('maratona', people)).toBe('p-manel')
    expect(defaultChooser('cinema', people)).toBe('p-cinema')
    expect(defaultChooser('normal', people)).toBe('')
    expect(defaultChooser('maratona', people.slice(1))).toBe('')
  })

  it('replaces an empty choice or the old default, but never a person picked by hand', () => {
    expect(chooserForKind('', 'normal', 'maratona', people)).toBe('p-manel')
    expect(chooserForKind('p-cinema', 'cinema', 'maratona', people)).toBe('p-manel')
    expect(chooserForKind('p-manel', 'maratona', 'normal', people)).toBe('')
    expect(chooserForKind('p-ada', 'normal', 'maratona', people)).toBe('p-ada')
    expect(chooserForKind('p-ada', 'normal', 'cinema', people)).toBe('p-ada')
  })
})

describe('alreadyWatched', () => {
  it('names the date, and the kind unless normal', () => {
    expect(alreadyWatched('2026-01-10', 'normal')).toBe('Already watched on 2026/01/10')
    expect(alreadyWatched('2026-01-24', 'cinema')).toBe('Already watched on 2026/01/24 (Cinema)')
  })
})

describe('parseYear', () => {
  it('takes four-digit years from 1870 to 2100', () => {
    expect(parseYear(' 1999 ')).toBe(1999)
    expect(parseYear('1869')).toBeNull()
    expect(parseYear('2101')).toBeNull()
    expect(parseYear('99')).toBeNull()
    expect(parseYear('19a9')).toBeNull()
  })
})

describe('screening dates', () => {
  const now = new Date('2026-11-21T10:00:00Z')
  it('accepts real dates from 1990-01-01 to two years ahead (same as film-save)', () => {
    expect(screeningDateRange(now)).toEqual({ min: '1990-01-01', max: '2028-11-21' })
    for (const ok of ['1990-01-01', '2024-02-29', '2028-11-21']) {
      expect(validScreeningDate(ok, now)).toBe(true)
    }
    for (const bad of [
      '2026-02-30',
      '2026-13-01',
      '0000-01-01',
      '1989-12-31',
      '2028-11-22',
      '2026-1-1',
      '',
    ]) {
      expect(validScreeningDate(bad, now)).toBe(false)
    }
  })
})

describe('toSaveBody', () => {
  it('sends only the TMDB id for a picked film', () => {
    expect(toSaveBody(base)).toEqual({
      body: {
        tmdb_id: 42,
        screened_on: '2026-11-28',
        kind: 'normal',
        assigned_id: 'p-ada',
        turn_holder_id: null,
      },
    })
  })

  it('sends title and year without TMDB, and the id when editing', () => {
    const manual = { ...base, manual: true, title: ' Home Movie ', year: '2005' }
    expect(toSaveBody(manual, 7)).toEqual({
      body: {
        id: 7,
        tmdb_id: null,
        title: 'Home Movie',
        release_year: 2005,
        screened_on: '2026-11-28',
        kind: 'normal',
        assigned_id: 'p-ada',
        turn_holder_id: null,
      },
    })
    expect(toSaveBody({ ...manual, title: ' ' })).toEqual({ error: 'Enter the title.' })
    expect(toSaveBody({ ...manual, title: ' Home\n\t Movie ' })).toMatchObject({
      body: { title: 'Home Movie' },
    })
    for (const title of ['\u200b\u200b', '!!! ...', '\u{1F3AC}']) {
      expect(toSaveBody({ ...manual, title })).toEqual({
        error: 'The title needs at least one letter or number.',
      })
    }
    expect(toSaveBody({ ...manual, title: 'Ze\u200bro' })).toMatchObject({ body: {} })
    expect(toSaveBody({ ...manual, year: '' })).toEqual({
      error: 'Enter the release year (e.g. 1999).',
    })
  })

  it('needs a film, a date and a chooser', () => {
    expect(toSaveBody({ ...base, picked: null })).toEqual({
      error: 'Pick the film from TMDB, or save without TMDB.',
    })
    expect(toSaveBody({ ...base, screenedOn: '' })).toEqual({ error: 'Enter the screening date.' })
    expect(toSaveBody({ ...base, screenedOn: '2026-02-30' })).toEqual({
      error: expect.stringMatching(/^Enter a screening date from 1990\/01\/01 to /),
    })
    expect(toSaveBody({ ...base, assignedId: '' })).toEqual({ error: 'Choose who chose the film.' })
  })

  it('needs the turn-holder for a new Democrático, and drops it for other kinds', () => {
    const demo = { ...base, kind: 'democratico' as const }
    expect(toSaveBody(demo)).toEqual({ error: 'Choose whose turn it was.' })
    // Historic films may have none recorded.
    expect('body' in toSaveBody(demo, 3)).toBe(true)
    expect(toSaveBody({ ...demo, turnHolderId: 'p-manel' })).toMatchObject({
      body: { turn_holder_id: 'p-manel' },
    })
    expect(toSaveBody({ ...base, turnHolderId: 'p-manel' })).toMatchObject({
      body: { turn_holder_id: null },
    })
  })
})

describe('functionErrorMessage', () => {
  it('maps refusals to friendly text', () => {
    expect(
      functionErrorMessage({
        status: 409,
        error: 'duplicate',
        film: { id: 1, screened_on: '2026-01-10', kind: 'maratona' },
      }),
    ).toBe('Already watched on 2026/01/10 (Maratona).')
    expect(functionErrorMessage({ status: 409 })).toBe('This film is already listed.')
    expect(functionErrorMessage({ status: 403 })).toBe('Only moderators and admins can do that.')
    expect(functionErrorMessage({ status: 429 })).toMatch(/Too many searches/)
    expect(functionErrorMessage({ status: 502 })).toMatch(/save without TMDB/)
    expect(functionErrorMessage({ status: 404, error: 'tmdb_not_found' })).toMatch(/TMDB/)
    expect(functionErrorMessage({ status: 0 })).toBe("Couldn't reach the server. Try again.")
    expect(functionErrorMessage(new Error('raw details'))).toBe(
      "Couldn't reach the server. Try again.",
    )
    expect(functionErrorMessage({ status: 500, error: 'server_error' })).toBe(
      'Something went wrong. Try again.',
    )
  })
})
