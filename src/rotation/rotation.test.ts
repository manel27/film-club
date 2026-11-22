import { describe, expect, it } from 'vitest'
import {
  comingWeek,
  computeStandings,
  lisbonDate,
  nextUp,
  orderStandings,
  type RotationAdjustment,
  type RotationFilm,
  type RotationInput,
  type RotationPass,
} from './rotation'

// Plan 6.3: four members, go-live on Monday 2026-03-02, screenings on Saturdays.
const EPOCH = '2026-03-02'
const WEEK = ['2026-03-02', '2026-03-09', '2026-03-16', '2026-03-23', '2026-03-30']
const SAT = ['2026-03-07', '2026-03-14', '2026-03-21', '2026-03-28']
const PEOPLE = ['ana', 'bea', 'gui', 'rocha']

let nextId = 1
const film = (f: Partial<RotationFilm> & Pick<RotationFilm, 'screenedOn' | 'assignedId'>) => ({
  id: nextId++,
  dayOrder: 1,
  kind: 'normal' as const,
  turnHolderId: null,
  presentIds: [],
  ...f,
})
const adj = (a: Partial<RotationAdjustment> & Pick<RotationAdjustment, 'profileId'>) => ({
  id: nextId++,
  delta: null,
  setTo: null,
  clearOwedTurn: false,
  effectiveAt: '2026-03-02T00:00:00Z',
  ...a,
})
const pass = (weekStart: string, profileId: string): RotationPass => ({ weekStart, profileId })

const START = [
  adj({ profileId: 'ana', setTo: 3 }),
  adj({ profileId: 'bea', setTo: 2 }),
  adj({ profileId: 'gui', setTo: 2 }),
  adj({ profileId: 'rocha', setTo: 0 }),
]
const W1 = film({ screenedOn: SAT[0], assignedId: 'ana', presentIds: ['ana', 'bea', 'gui'] })
const W2 = film({
  screenedOn: SAT[1],
  kind: 'democratico',
  assignedId: 'rocha',
  turnHolderId: 'bea',
  presentIds: ['ana', 'gui', 'rocha'],
})
const W3 = film({ screenedOn: SAT[2], assignedId: 'bea', presentIds: PEOPLE })
const W4 = film({ screenedOn: SAT[3], assignedId: 'gui', presentIds: ['gui', 'rocha'] })

function run(today: string, more: Partial<RotationInput> = {}) {
  const result = computeStandings({
    epoch: EPOCH,
    today,
    people: PEOPLE,
    films: [],
    adjustments: START,
    passes: [],
    ...more,
  })
  if (!result) throw new Error('no standings')
  const points = Object.fromEntries(result.standings.map((s) => [s.profileId, s.points]))
  const owed = orderStandings(
    result.standings.filter((s) => s.owedRank != null),
    (id) => id,
  ).map((s) => s.profileId)
  return { ...result, points, owed }
}

/** "Who's next" for the coming week of a run. */
function next(
  r: ReturnType<typeof run>,
  passes: RotationPass[] = [],
  decided: string | null = null,
) {
  const passing = new Set(passes.filter((p) => p.weekStart === r.weekStart).map((p) => p.profileId))
  return nextUp(r.standings, passing, decided)
}

describe('worked example (plan 6.3)', () => {
  it('starts from the staff starting values', () => {
    const r = run('2026-03-02')
    expect(r.points).toEqual({ ana: 3, bea: 2, gui: 2, rocha: 0 })
    expect(r.weekStart).toBe(WEEK[0])
    expect(next(r)).toEqual({ kind: 'points', ids: ['ana'] })
  })

  it('week 1: normal, Ana chooses → Ana resets; Bea/Gui tie, the group picks Bea', () => {
    const r = run(SAT[0], { films: [W1] })
    expect(r.points).toEqual({ ana: 0, bea: 3, gui: 3, rocha: 0 })
    expect(r.weekStart).toBe(WEEK[1])
    expect(orderStandings(r.standings, (id) => id).map((s) => s.profileId)).toEqual([
      'bea',
      'gui',
      'ana',
      'rocha',
    ])
    expect(next(r)).toEqual({ kind: 'tie', ids: ['bea', 'gui'] })
    expect(next(r, [], 'bea')).toEqual({ kind: 'decided', ids: ['bea'] })
  })

  it('week 2: Democrático resets nobody and gives Bea an owed turn that beats higher points', () => {
    const r = run(SAT[1], { films: [W1, W2] })
    expect(r.points).toEqual({ ana: 1, bea: 3, gui: 4, rocha: 1 })
    expect(r.owed).toEqual(['bea'])
    expect(r.standings.find((s) => s.profileId === 'bea')?.owedSince).toBe(SAT[1])
    expect(orderStandings(r.standings, (id) => id)[0].profileId).toBe('bea')
    expect(next(r)).toEqual({ kind: 'owed', ids: ['bea'] })
  })

  it('week 3: Bea chooses a normal screening → she resets and her owed turn clears', () => {
    const r = run(SAT[2], { films: [W1, W2, W3] })
    expect(r.points).toEqual({ ana: 2, bea: 0, gui: 5, rocha: 2 })
    expect(r.owed).toEqual([])
    expect(next(r)).toEqual({ kind: 'points', ids: ['gui'] })
  })

  it('week 4: a passer still gains +1 when present, and is skipped for the week passed', () => {
    const passes = [pass(WEEK[4], 'rocha')] // recorded during week 4
    const r = run(SAT[3], { films: [W1, W2, W3, W4], passes })
    expect(r.points).toEqual({ ana: 2, bea: 0, gui: 0, rocha: 3 })
    expect(r.weekStart).toBe(WEEK[4])
    expect(next(r, passes)).toEqual({ kind: 'points', ids: ['ana'] })
  })

  it('variant of week 3: Bea passes → owed turn cleared, Gui (4) chooses, Bea keeps 3', () => {
    const passes = [pass(WEEK[2], 'bea')]
    const before = run('2026-03-15', { films: [W1, W2], passes })
    expect(before.weekStart).toBe(WEEK[2])
    expect(before.owed).toEqual([])
    expect(before.points.bea).toBe(3)
    expect(next(before, passes)).toEqual({ kind: 'points', ids: ['gui'] })

    // Gui chooses week 3 without Bea; afterwards she has no special priority.
    const w3 = film({ screenedOn: SAT[2], assignedId: 'gui', presentIds: ['ana', 'gui', 'rocha'] })
    const after = run(SAT[2], { films: [W1, W2, w3], passes })
    expect(after.points).toEqual({ ana: 2, bea: 3, gui: 0, rocha: 2 })
    expect(after.owed).toEqual([])
    expect(next(after)).toEqual({ kind: 'points', ids: ['bea'] })
  })
})

describe('rules (plan 6.1)', () => {
  it('normal: everyone present +1, the chooser resets to 0 even if absent (6.4)', () => {
    const f = film({ screenedOn: SAT[0], assignedId: 'gui', presentIds: ['ana', 'bea'] })
    expect(run(SAT[0], { films: [f] }).points).toEqual({ ana: 4, bea: 3, gui: 0, rocha: 0 })
  })

  it('Democrático: nobody resets, everyone present +1 (proposer too)', () => {
    const f = film({
      screenedOn: SAT[0],
      kind: 'democratico',
      assignedId: 'ana',
      presentIds: ['ana', 'rocha'],
    })
    const r = run(SAT[0], { films: [f] })
    expect(r.points).toEqual({ ana: 4, bea: 2, gui: 2, rocha: 1 })
    expect(r.owed).toEqual([]) // no turn-holder recorded (as for history)
  })

  it('Cinema and Maratona change no points and no owed turns (6.4)', () => {
    const films = [
      W2,
      film({ screenedOn: SAT[2], kind: 'cinema', assignedId: 'bea', presentIds: PEOPLE }),
      film({
        screenedOn: SAT[2],
        dayOrder: 2,
        kind: 'maratona',
        assignedId: 'bea',
        presentIds: PEOPLE,
      }),
    ]
    const r = run(SAT[2], { films })
    expect(r.points).toEqual({ ana: 4, bea: 2, gui: 3, rocha: 1 })
    expect(r.owed).toEqual(['bea'])
    // A week with only a cinema trip still waits for its chooser.
    expect(r.weekStart).toBe(WEEK[2])
  })

  it('absent people keep their points', () => {
    const f = film({ screenedOn: SAT[0], assignedId: 'ana', presentIds: [] })
    expect(run(SAT[0], { films: [f] }).points).toEqual({ ana: 0, bea: 2, gui: 2, rocha: 0 })
  })

  it('a passer keeps their points and is skipped; the next highest chooses', () => {
    const passes = [pass(WEEK[0], 'ana')]
    const r = run('2026-03-03', { passes })
    expect(r.points.ana).toBe(3)
    expect(next(r, passes)).toEqual({ kind: 'tie', ids: ['bea', 'gui'] })
  })

  it('everyone starts at 0 at go-live; adjustments set or correct points', () => {
    expect(run(EPOCH, { adjustments: [] }).points).toEqual({ ana: 0, bea: 0, gui: 0, rocha: 0 })
    const adjustments = [
      ...START,
      adj({ profileId: 'ana', delta: -2, effectiveAt: '2026-03-03T10:00:00Z' }),
      adj({ profileId: 'bea', delta: 3, effectiveAt: '2026-03-03T10:00:00Z' }),
      adj({ profileId: 'gui', setTo: 7, effectiveAt: '2026-03-03T11:00:00Z' }),
    ]
    expect(run('2026-03-03', { adjustments }).points).toEqual({ ana: 1, bea: 5, gui: 7, rocha: 0 })
  })

  it('ignores films, adjustments and passes before the epoch, and films after today', () => {
    const r = run(SAT[0], {
      films: [
        film({ screenedOn: '2026-02-28', assignedId: 'bea', presentIds: PEOPLE }),
        film({ screenedOn: '2026-03-08', assignedId: 'gui', presentIds: PEOPLE }), // tomorrow
        W1,
      ],
      adjustments: [
        ...START,
        adj({ profileId: 'rocha', setTo: 9, effectiveAt: '2026-03-01T12:00:00Z' }),
      ],
      passes: [pass('2026-02-23', 'bea')],
    })
    expect(r.points).toEqual({ ana: 0, bea: 3, gui: 3, rocha: 0 })
  })

  it('is not started without an epoch, or before it', () => {
    const base = { people: PEOPLE, films: [], adjustments: [], passes: [] }
    expect(computeStandings({ ...base, epoch: null, today: SAT[0] })).toBeNull()
    expect(computeStandings({ ...base, epoch: EPOCH, today: '2026-03-01' })).toBeNull()
  })

  it('only people in the rotation are listed (present outsiders are ignored)', () => {
    const f = film({ screenedOn: SAT[0], assignedId: 'cinema', presentIds: ['ana', 'viewer'] })
    const r = run(SAT[0], { films: [f] })
    expect(r.standings.map((s) => s.profileId)).toEqual(PEOPLE)
    expect(r.points.ana).toBe(4)
  })
})

describe('edge cases (plan 6.4)', () => {
  const demo = (date: string, holder: string, order = 1) =>
    film({
      screenedOn: date,
      dayOrder: order,
      kind: 'democratico',
      assignedId: 'gui',
      turnHolderId: holder,
    })

  it('an owed person who misses another Democrático stays owed once, keeping their place', () => {
    const r = run(SAT[2], {
      films: [demo(SAT[0], 'bea'), demo(SAT[1], 'ana'), demo(SAT[2], 'bea')],
    })
    expect(r.owed).toEqual(['bea', 'ana'])
    expect(r.standings.find((s) => s.profileId === 'bea')?.owedSince).toBe(SAT[0])
  })

  it('several owed turns: oldest first; a passer is skipped for the next owed', () => {
    const r = run(SAT[1], { films: [demo(SAT[0], 'rocha'), demo(SAT[1], 'ana')] })
    expect(r.owed).toEqual(['rocha', 'ana'])
    expect(next(r)).toEqual({ kind: 'owed', ids: ['rocha'] })
    const passes = [pass(WEEK[2], 'rocha')]
    const r2 = run(SAT[1], { films: [demo(SAT[0], 'rocha'), demo(SAT[1], 'ana')], passes })
    expect(r2.owed).toEqual(['ana'])
    expect(next(r2, passes)).toEqual({ kind: 'owed', ids: ['ana'] })
  })

  it('same-day films run in day_order', () => {
    const r = run(SAT[0], {
      films: [
        film({ screenedOn: SAT[0], dayOrder: 2, assignedId: 'bea', presentIds: ['ana'] }),
        demo(SAT[0], 'bea'),
      ],
    })
    // The Democrático (first) made Bea owed; her normal screening (second) cleared it.
    expect(r.owed).toEqual([])
  })

  it('choosing a Cinema or Maratona trip does not clear an owed turn', () => {
    const r = run(SAT[1], {
      films: [demo(SAT[0], 'bea'), film({ screenedOn: SAT[1], kind: 'cinema', assignedId: 'bea' })],
    })
    expect(r.owed).toEqual(['bea'])
  })

  it('staff can clear an owed turn by hand (points unchanged)', () => {
    const clear = adj({
      profileId: 'bea',
      clearOwedTurn: true,
      effectiveAt: '2026-03-08T09:00:00Z',
    })
    const r = run('2026-03-08', { films: [demo(SAT[0], 'bea')], adjustments: [...START, clear] })
    expect(r.owed).toEqual([])
    expect(r.points.bea).toBe(2)
  })

  it('an adjustment applies before same-day screenings (its Lisbon date)', () => {
    // Entered on the evening of the screening day: it still applies before that screening.
    const late = adj({ profileId: 'ana', setTo: 10, effectiveAt: '2026-03-07T20:00:00Z' })
    const r = run(SAT[0], { films: [W1], adjustments: [...START, late] })
    expect(r.points.ana).toBe(0)
  })

  it('a pass for a later week does not clear an owed turn yet', () => {
    const r = run(SAT[1], { films: [W1, W2], passes: [pass(WEEK[4], 'bea')] })
    expect(r.owed).toEqual(['bea'])
  })

  it('nobody left: everyone passes', () => {
    const passes = PEOPLE.map((id) => pass(WEEK[0], id))
    expect(next(run(EPOCH, { passes }), passes)).toEqual({ kind: 'none', ids: [] })
  })
})

describe('dates', () => {
  it('the coming week moves on once this week’s screening has happened', () => {
    expect(comingWeek('2026-03-06', EPOCH, [W1])).toBe(WEEK[0])
    expect(comingWeek(SAT[0], EPOCH, [W1])).toBe(WEEK[1])
    expect(comingWeek('2026-03-08', EPOCH, [W1])).toBe(WEEK[1])
  })

  it('Lisbon dates follow DST', () => {
    expect(lisbonDate('2026-07-14T23:30:00Z')).toBe('2026-07-15') // UTC+1
    expect(lisbonDate('2026-01-14T23:30:00Z')).toBe('2026-01-14') // UTC+0
  })
})
