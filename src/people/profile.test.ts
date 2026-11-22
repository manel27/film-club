import { describe, expect, it } from 'vitest'
import type { FilmItem, Person } from '../films/films'
import { parseName, profileStats, renameError } from './profile'

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
  ...extra,
})

describe('profileStats', () => {
  const films = [
    film(1, { presentIds: ['me'], assignedId: 'me', avgScore: 8 }),
    film(2, { presentIds: ['me', 'x'], assignedId: 'me', avgScore: 6 }),
    film(3, { assignedId: 'me' }), // no scores yet: left out of the chosen average
    film(4, { presentIds: ['x'] }),
    // The easter egg: chosen by me, scored 11, commented: counts for nothing.
    film(99, { assignedId: 'me', presentIds: ['me'] }),
  ]
  const scores = new Map([
    [1, 9],
    [4, 5],
    [99, 11],
  ])

  it('counts watched, chosen, scores and comments, and averages, without the easter egg', () => {
    expect(profileStats('me', films, scores, [1, 1, 4, 99], new Set([99]))).toEqual({
      watched: 2,
      chosen: 3,
      scores: 2,
      avgGiven: 7,
      avgChosen: 7,
      comments: 3,
    })
  })

  it('gives null averages when there is nothing to average', () => {
    expect(profileStats('nobody', films, new Map(), [], new Set([99]))).toEqual({
      watched: 0,
      chosen: 0,
      scores: 0,
      avgGiven: null,
      avgChosen: null,
      comments: 0,
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

  it('refuses empty, too long and taken names', () => {
    expect(parseName('   ', people, 'me')).toEqual({ error: 'Enter a name.' })
    expect(parseName('x'.repeat(51), people, 'me')).toEqual({
      error: 'Use at most 50 characters.',
    })
    expect(parseName(' ada ', people, 'me')).toEqual({ error: 'Someone already has that name.' })
  })

  it('counts characters like the database (an emoji is one)', () => {
    expect(parseName('🎬'.repeat(50), people, 'me')).toEqual({ name: '🎬'.repeat(50) })
  })
})

describe('renameError', () => {
  it('explains the unique and length checks, and falls back to the usual messages', () => {
    expect(renameError({ code: '23505' })).toBe('Someone already has that name.')
    expect(renameError({ code: '23514' })).toBe('Use 1 to 50 characters.')
    expect(renameError({ code: '42501' })).toBe("You can't change that.")
  })
})
