import { describe, expect, it } from 'vitest'
import type { FilmItem, Person } from '../films/films'
import {
  mean,
  normaliseName,
  parseName,
  personSaveError,
  profileStats,
  profileTabs,
  renameError,
} from './profile'

const film = (id: number, extra: Partial<FilmItem> = {}): FilmItem => ({
  id,
  title: `Film ${id}`,
  releaseYear: 2000,
  posterPath: null,
  genres: [],
  screenedOn: '2026-01-03',
  dayOrder: 1,
  kind: 'normal',
  assignedId: 'other',
  presentIds: [],
  avgScore: null,
  isEasterEgg: false,
  ...extra,
})

describe('mean', () => {
  it('rounds like Postgres round(avg, 2): exact hundredths, half away from zero', () => {
    expect(mean([7.01, 7])?.toFixed(2)).toBe('7.01') // 7.005 in floats is 7.00499…
    expect(mean([0.1, 0.2])).toBe(0.15)
    expect(mean([1, 1, 2])).toBe(1.33)
    expect(mean([1, 2, 2])).toBe(1.67)
    expect(mean([])).toBeNull()
  })
})

describe('profileStats', () => {
  const films = [
    film(1, { presentIds: ['me'], assignedId: 'me', avgScore: 8 }),
    film(2, { presentIds: ['me', 'x'], assignedId: 'me', avgScore: 6 }),
    film(3, { assignedId: 'me' }), // no scores yet: left out of the chosen average
    film(4, { presentIds: ['x'] }),
    // In the future and a Maratona: still counted as chosen (decision P4).
    film(5, { assignedId: 'me', kind: 'maratona', screenedOn: '2099-01-01' }),
    // The easter egg: chosen by me, scored 11, commented: counts for nothing.
    film(99, { assignedId: 'me', presentIds: ['me'], isEasterEgg: true }),
  ]
  const scores = new Map([
    [1, 9],
    [4, 5],
    [99, 11],
  ])

  it('counts present, watched (present or scored), chosen, scores, comments and averages, without the easter egg', () => {
    expect(profileStats('me', films, scores, [1, 1, 4, 99], '2026-01-03')).toEqual({
      present: 2,
      watched: 3, // 1 and 2 present, 4 scored without attendance
      chosen: 4,
      scores: 2,
      avgGiven: 7,
      avgChosen: 7,
      comments: 3,
    })
  })

  it('counts present and watched only for films screened up to today, like the tabs', () => {
    const today = film(6, { screenedOn: '2026-01-04', presentIds: ['me'] })
    const scoredToday = film(7, { screenedOn: '2026-01-04' })
    const future = film(8, { screenedOn: '2026-01-05', presentIds: ['me'] })
    const s = new Map([
      [7, 6],
      [8, 9],
    ])
    expect(profileStats('me', [today, scoredToday, future], s, [], '2026-01-04')).toMatchObject({
      present: 1, // today counts, the future film doesn't
      watched: 2,
    })
  })

  it('gives null averages when there is nothing to average', () => {
    expect(profileStats('nobody', films, new Map(), [], '2026-01-03')).toEqual({
      present: 0,
      watched: 0,
      chosen: 0,
      scores: 0,
      avgGiven: null,
      avgChosen: null,
      comments: 0,
    })
  })

  it('splits the tabs by presence and by present-or-scored, without the easter egg or future screenings (P3, P4)', () => {
    const tabs = profileTabs('me', films, scores, '2026-01-03')
    const ids = Object.fromEntries(Object.entries(tabs).map(([t, fs]) => [t, fs.map((f) => f.id)]))
    expect(ids).toEqual({
      present: [1, 2],
      'not-present': [3, 4],
      watched: [1, 2, 4], // 4: scored, not present
      'not-watched': [3],
    })
    // Today counts as shown; a future film is in no tab even when present and scored.
    const today = film(6, { screenedOn: '2026-01-04' })
    const future = film(7, { screenedOn: '2026-01-05', presentIds: ['me'] })
    expect(profileTabs('me', [today, future], new Map([[7, 8]]), '2026-01-04')).toEqual({
      present: [],
      'not-present': [today],
      watched: [],
      'not-watched': [today],
    })
  })
})

describe('parseName', () => {
  const people: Person[] = [
    { id: 'me', name: 'Quinn', colour: null, isSystem: false },
    { id: 'ada', name: 'Ada', colour: null, isSystem: false },
  ]

  it('trims and accepts a new name, or your own in another case', () => {
    expect(parseName('  Quinn Q.  ', people, 'me')).toEqual({ name: 'Quinn Q.' })
    expect(parseName('QUINN', people, 'me')).toEqual({ name: 'QUINN' })
  })

  it('collapses any whitespace and strips zero-width and format characters', () => {
    expect(normaliseName(' Ana\t\n  Lu​z⁠﻿ ')).toBe('Ana Luz')
    expect(parseName('Ana　　Luz', people, 'me')).toEqual({ name: 'Ana Luz' })
    // A look-alike of someone else's name is still theirs.
    expect(parseName('A‍da', people, 'me')).toEqual({
      error: 'Someone already has that name.',
    })
  })

  it('refuses empty, invisible, too long, letterless, control and taken names', () => {
    expect(parseName('   ', people, 'me')).toEqual({ error: 'Enter a name.' })
    expect(parseName('​‌‍⁠﻿', people, 'me')).toEqual({
      error: 'Enter a name.',
    })
    expect(parseName('x'.repeat(51), people, 'me')).toEqual({
      error: 'Use at most 50 characters.',
    })
    expect(parseName('...', people, 'me')).toEqual({ error: 'Use at least one letter or digit.' })
    expect(parseName('Bo\u0007b', people, 'me')).toEqual({
      error: "Names can't contain control characters.",
    })
    expect(parseName(' ada ', people, 'me')).toEqual({ error: 'Someone already has that name.' })
  })

  it('counts characters like the database (an emoji is one), and accepts any script', () => {
    expect(parseName('A' + '🎬'.repeat(49), people, 'me')).toEqual({ name: 'A' + '🎬'.repeat(49) })
    expect(parseName('Ζωή 李 7', people, 'me')).toEqual({ name: 'Ζωή 李 7' })
  })
})

describe('renameError', () => {
  it('explains the unique and name checks, and falls back to the usual messages', () => {
    expect(renameError({ code: '23505' })).toBe('Someone already has that name.')
    expect(renameError({ code: '23514' })).toBe('Use 1 to 50 characters, with a letter or digit.')
    expect(renameError({ code: '42501' })).toBe("You can't change that.")
  })
})

describe('personSaveError', () => {
  it("explains the guard's refusals, otherwise like a rename", () => {
    const guard = (message: string) => ({ code: '42501', message })
    expect(personSaveError(guard('The last admin cannot be demoted'))).toBe(
      'The club needs at least one admin.',
    )
    expect(personSaveError(guard('Admins cannot change their own role'))).toBe(
      "You can't change your own role.",
    )
    expect(personSaveError({ code: '23505' })).toBe('Someone already has that name.')
    expect(personSaveError(guard('Only the admin can change role, colour or sheet keyword'))).toBe(
      "You can't change that.",
    )
  })
})
