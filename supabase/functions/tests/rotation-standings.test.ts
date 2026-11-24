// The SQL view rotation_standings against the TS algorithm
// (src/rotation/rotation.ts) on the same data: everything in the LOCAL
// database (the seed) plus a scenario added step by step that touches every
// rule and edge case of plan 6. After each step both must agree exactly.
// Uses the local stack's secret key and removes what it adds.
// Run: npm run functions:test
import { createClient } from 'npm:@supabase/supabase-js@2.119.0'
import { assertEquals } from 'jsr:@std/assert@1.0.14'
import { computeStandings, type RotationInput } from '../../../src/rotation/rotation.ts'

const status = new TextDecoder().decode(
  (await new Deno.Command('npx', { args: ['supabase', 'status', '-o', 'env'], stderr: 'null' })
    .output()).stdout,
)
const env = Object.fromEntries(
  [...status.matchAll(/^(\w+)="?([^"\n]*)"?$/gm)].map((m) => [m[1], m[2]]),
)
const apiUrl = env.API_URL
if (!apiUrl || !['127.0.0.1', 'localhost'].includes(new URL(apiUrl).hostname)) {
  throw new Error('These tests need the LOCAL Supabase stack: run `npm run db:start` first.')
}
const db = createClient(apiUrl, env.SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const P = (n: string) => `00000000-0000-4000-8000-0000000000${n}` // seed profile ids
const [ORLA, TAMSIN, KWAME, YUSUF, VIGGO, WREN] = ['a1', 'a2', 'a3', 'a4', 'b1', 'b2'].map(P)
const TAG = 'TSvSQL'

// Rows, or null from maybeSingle() (callers use ?. there).
async function ok<T>(request: PromiseLike<{ data: T; error: unknown }>): Promise<NonNullable<T>> {
  const { data, error } = await request
  if (error) throw error
  return data as NonNullable<T>
}

/** Every rotation input in the database, as the TS algorithm takes it. */
const lisbonToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon' }).format(new Date())

async function inputs(today: string): Promise<RotationInput> {
  const [setting, people, films, adjustments, passes] = await Promise.all([
    ok(db.from('app_settings').select('value').eq('key', 'rotation_epoch').maybeSingle()),
    ok(db.from('profiles').select('id').neq('role', 'viewer').eq('is_system', false)),
    ok(
      db.from('films').select(
        'id, screened_on, day_order, kind, assigned_id, turn_holder_id, attendance(profile_id)',
      ),
    ),
    ok(
      db.from('rotation_adjustments').select(
        'id, profile_id, delta, set_to, clear_owed_turn, effective_at',
      ),
    ),
    ok(db.from('rotation_passes').select('week_start, profile_id')),
  ])
  return {
    epoch: (setting?.value as string | undefined) ?? null,
    today,
    people: people.map((p) => p.id),
    films: films.map((f) => ({
      id: f.id,
      screenedOn: f.screened_on,
      dayOrder: f.day_order,
      kind: f.kind,
      assignedId: f.assigned_id,
      turnHolderId: f.turn_holder_id,
      presentIds: f.attendance.map((a: { profile_id: string }) => a.profile_id),
    })),
    adjustments: adjustments.map((a) => ({
      id: a.id,
      profileId: a.profile_id,
      delta: a.delta,
      setTo: a.set_to,
      clearOwedTurn: a.clear_owed_turn,
      effectiveAt: a.effective_at,
    })),
    passes: passes.map((p) => ({ weekStart: p.week_start, profileId: p.profile_id })),
  }
}

/** Both sides as sorted rows; returns the TS result for extra checks. */
async function assertSame(step: string): Promise<ReturnType<typeof computeStandings>> {
  // Both sides on the same Lisbon day: retry if midnight passed in between.
  const today = lisbonToday()
  const ts = computeStandings(await inputs(today))
  const sql = await ok(db.from('rotation_standings').select('*'))
  if (lisbonToday() !== today) return assertSame(step)
  const expected = (ts?.standings ?? []).map((s) => ({
    profile_id: s.profileId,
    points: s.points,
    owed_rank: s.owedRank,
    owed_since: s.owedSince,
    week_start: ts!.weekStart,
  }))
  const byId = (a: { profile_id: string }, b: { profile_id: string }) =>
    a.profile_id.localeCompare(b.profile_id)
  assertEquals(sql.sort(byId), expected.sort(byId), step)
  return ts
}

let filmNo = 0
async function film(f: {
  date: string
  kind?: string
  assigned: string
  holder?: string
  order?: number
  present?: string[]
}) {
  const { id } = await ok(
    db.from('films').insert({
      title: `${TAG} film ${++filmNo}`,
      release_year: 2000 + filmNo,
      screened_on: f.date,
      kind: f.kind ?? 'normal',
      assigned_id: f.assigned,
      turn_holder_id: f.holder ?? null,
      day_order: f.order ?? 1,
    }).select('id').single(),
  )
  if (f.present?.length) {
    await ok(db.from('attendance').insert(f.present.map((p) => ({ film_id: id, profile_id: p }))))
  }
}
const adjust = (row: Record<string, unknown>) =>
  ok(db.from('rotation_adjustments').insert({ reason: TAG, ...row }))
const passes: { week_start: string; profile_id: string }[] = []
const pass = (week_start: string, profile_id: string) => {
  passes.push({ week_start, profile_id })
  return ok(db.from('rotation_passes').insert({ week_start, profile_id }))
}
const setEpoch = (value: string | null) =>
  value === null
    ? ok(db.from('app_settings').delete().eq('key', 'rotation_epoch'))
    : ok(db.from('app_settings').upsert({ key: 'rotation_epoch', value }))

Deno.test('rotation_standings (SQL) equals computeStandings (TS) on the same data', async () => {
  const saved = await ok(
    db.from('app_settings').select('value').eq('key', 'rotation_epoch').maybeSingle(),
  )
  try {
    const seed = await assertSame('the seed as it is')
    assertEquals(seed?.standings.find((s) => s.profileId === KWAME)?.owedRank, 1)

    await adjust({ profile_id: WREN, delta: 2, effective_at: '2026-03-02T10:00:00Z' })
    // Entered on the screening day: applies before that day's screenings.
    await adjust({ profile_id: VIGGO, set_to: 5, effective_at: '2026-03-07T21:00:00Z' })
    await assertSame('a correction and a starting value')

    // The chooser is absent and still resets; then a Democrático the same day.
    await film({ date: '2026-03-07', assigned: YUSUF, present: [ORLA, KWAME, VIGGO, WREN] })
    await film({
      date: '2026-03-07',
      order: 2,
      kind: 'democratico',
      assigned: ORLA,
      holder: TAMSIN,
      present: [KWAME],
    })
    await assertSame('normal with an absent chooser, then a Democrático (second owed turn)')

    // Kwame misses again: still one owed turn. Cinema and Maratona change nothing.
    await film({ date: '2026-03-14', kind: 'democratico', assigned: VIGGO, holder: KWAME })
    await film({ date: '2026-03-14', order: 2, kind: 'cinema', assigned: KWAME, present: [ORLA] })
    await film({
      date: '2026-03-14',
      order: 3,
      kind: 'maratona',
      assigned: TAMSIN,
      present: [WREN],
    })
    await assertSame('owed again, cinema, maratona')

    // A pass clears Kwame's owed turn; staff clear Tamsin's by hand.
    await pass('2026-03-16', KWAME)
    await adjust({
      profile_id: TAMSIN,
      clear_owed_turn: true,
      effective_at: '2026-03-17T09:00:00Z',
    })
    const cleared = await assertSame('a pass and a manual clear')
    assertEquals(cleared?.standings.filter((s) => s.owedRank !== null), [])

    await adjust({ profile_id: ORLA, delta: -1, effective_at: '2026-03-21T08:00:00Z' })
    await film({
      date: '2026-03-21',
      assigned: TAMSIN,
      present: [ORLA, TAMSIN, KWAME, YUSUF, VIGGO, WREN],
    })
    await pass('2027-01-04', YUSUF) // far ahead: not counted yet
    await assertSame('a negative correction, a full house, a future pass')

    // This week's screening happened today: the coming week is next week.
    await film({ date: lisbonToday(), assigned: ORLA, present: [ORLA, WREN] })
    const plus7 = await assertSame('the coming week moves on after this week’s screening')
    assertEquals(plus7!.weekStart > lisbonToday(), true)

    // July, with a mid-week epoch (Wednesday 2026-07-15).
    await pass('2026-07-13', YUSUF) // its Monday is before the epoch: not counted
    // 23:30 UTC on the 14th is already the 15th in Lisbon (UTC+1): counted.
    await adjust({ profile_id: KWAME, delta: 3, effective_at: '2026-07-14T23:30:00Z' })
    // Same day: entry order, a set_to then a delta.
    await adjust({ profile_id: ORLA, set_to: 4, effective_at: '2026-07-16T20:00:00Z' })
    await adjust({ profile_id: ORLA, delta: -2, effective_at: '2026-07-16T08:00:00Z' })
    await adjust({ profile_id: WREN, delta: -50, effective_at: '2026-07-17T08:00:00Z' }) // floor at 0
    await assertSame('a correction below 0 stops at 0')
    await adjust({ profile_id: WREN, delta: 1, effective_at: '2026-07-17T09:00:00Z' })
    // Two films on the same date with the same day_order: id decides.
    await film({
      date: '2026-07-18',
      kind: 'democratico',
      assigned: VIGGO,
      holder: YUSUF,
      present: [TAMSIN, VIGGO],
    })
    await film({ date: '2026-07-18', assigned: YUSUF, present: [YUSUF, KWAME] })
    await assertSame('July data under the January epoch')
    await setEpoch('2026-07-15')
    const july = await assertSame('a mid-week epoch')
    const points = (id: string) => july?.standings.find((s) => s.profileId === id)?.points
    assertEquals([points(KWAME), points(ORLA), points(WREN), points(YUSUF)], [4, 0, 2, 0])

    await setEpoch('2026-03-02')
    await assertSame('a later epoch')
    await setEpoch('2099-01-05')
    assertEquals(await assertSame('an epoch in the future'), null)
    await setEpoch(null)
    assertEquals(await assertSame('no epoch'), null)
  } finally {
    await setEpoch((saved?.value as string | undefined) ?? null)
    await ok(db.from('films').delete().like('title', `${TAG} film %`))
    await ok(db.from('rotation_adjustments').delete().eq('reason', TAG))
    for (const p of passes) await ok(db.from('rotation_passes').delete().match(p))
  }
})
