import { describe, expect, it } from 'vitest'
import {
  alreadyWatched,
  chooserForKind,
  comingSaturday,
  defaultChooser,
  functionErrorMessage,
  normaliseReason,
  normaliseText,
  parseYear,
  reasonLength,
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
  reason: '',
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
        democratico_reason: null,
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
        democratico_reason: null,
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

  it("normalises a Democrático's reason and sends it only for a Democrático", () => {
    const demo = { ...base, kind: 'democratico' as const, turnHolderId: 'p-manel' }
    expect(toSaveBody({ ...demo, reason: ' \u200bNobody\n\t agreed\ufeff ' })).toMatchObject({
      body: { democratico_reason: 'Nobody agreed' },
    })
    // Blank: whitespace, controls, invisible characters, joiners only.
    for (const reason of ['', ' \n\t ', '\u200b\u200d', '\u0007\u0000', '\u200d\u200d']) {
      expect(toSaveBody({ ...demo, reason })).toMatchObject({ body: { democratico_reason: null } })
    }
    // Joiners and tags inside emoji and words are kept; controls become spaces.
    const family = '\u{1F468}\u200d\u{1F469}\u200d\u{1F467}'
    const scotland = '\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}'
    const persian = '\u0645\u06cc\u200c\u062e\u0648\u0627\u0647\u0645'
    expect(normaliseReason(`${family}\u0007${scotland}\u0000${persian}\u202e`)).toBe(
      `${family} ${scotland} ${persian}`,
    )
    expect(reasonLength(family)).toBe(5)
    expect(reasonLength(null)).toBe(0)
    // 200 emoji are 400 UTF-16 units: still 200 characters.
    expect(toSaveBody({ ...demo, reason: '\u{1F3AC}'.repeat(200) })).toMatchObject({
      body: { democratico_reason: '\u{1F3AC}'.repeat(200) },
    })
    expect(toSaveBody({ ...demo, reason: 'a'.repeat(201) })).toEqual({
      error: 'Keep the reason to 200 characters or fewer.',
    })
    // Typed, then the kind changed: not sent (and not checked).
    expect(toSaveBody({ ...base, reason: 'a'.repeat(300) })).toMatchObject({
      body: { democratico_reason: null },
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
    expect(functionErrorMessage({ status: 400, error: 'reason_too_long' })).toBe(
      'Keep the reason to 200 characters or fewer.',
    )
    expect(functionErrorMessage({ status: 400, error: 'invalid' })).toBe(
      "That value isn't allowed.",
    )
    expect(functionErrorMessage({ status: 0 })).toBe("Couldn't reach the server. Try again.")
    expect(functionErrorMessage(new Error('raw details'))).toBe(
      "Couldn't reach the server. Try again.",
    )
    expect(functionErrorMessage({ status: 500, error: 'server_error' })).toBe(
      'Something went wrong. Try again.',
    )
  })
})

describe('normaliseText', () => {
  it('keeps paragraphs: one or two line breaks stay', () => {
    expect(normaliseText('One.\nTwo.\n\nThree.')).toBe('One.\nTwo.\n\nThree.')
  })

  it('turns every kind of line break into \\n', () => {
    expect(normaliseText('a\r\nb\rc\u0085d\u2028e\u2029f')).toBe('a\nb\nc\nd\ne\nf')
  })

  it('allows at most one blank line in a row', () => {
    expect(normaliseText('a\n\n\n\nb')).toBe('a\n\nb')
    expect(normaliseText('a\n \n\t\n \nb')).toBe('a\n\nb')
  })

  it('removes spaces next to a line break and collapses other whitespace and controls', () => {
    expect(normaliseText('a  \t \n   b\u0007\u00a0c')).toBe('a\nb c')
  })

  it('strips invisible format characters but keeps joiners and tags', () => {
    expect(
      normaliseText('\u200bHi\ufeff \u{1f468}\u200d\u{1f469} \u{1f3f4}\u{e0067}\u{e007f}'),
    ).toBe('Hi \u{1f468}\u200d\u{1f469} \u{1f3f4}\u{e0067}\u{e007f}')
  })

  it('trims, and returns null when nothing visible is left', () => {
    expect(normaliseText('\n\n  Hi  \n\n')).toBe('Hi')
    for (const blank of ['', ' \n\r\n ', '\u200b\n\u200d', '\u2028\u00a0']) {
      expect(normaliseText(blank), JSON.stringify(blank)).toBeNull()
    }
  })
})
