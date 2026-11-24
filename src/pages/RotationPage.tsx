import { useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../auth/authContext'
import Chip, { PersonName } from '../components/Chip'
import { NextUp } from '../components/NextUp'
import { KIND_LABELS, type Person } from '../films/films'
import { rotationWrites, type RotationData } from '../rotation/api'
import { lisbonDate, mondayOf, ymd } from '../rotation/rotation'
import { useRotation, type Rotation } from '../rotation/useRotation'

const byName = (a: Person, b: Person) => a.name.localeCompare(b.name)

/** A real calendar date written YYYY-MM-DD (the database checks the same). */
const isDate = (v: string) => {
  const t = Date.parse(`${v}T12:00:00Z`)
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(t) && new Date(t).toISOString().startsWith(v)
}

/**
 * A status line that is always in the page (so screen readers announce a new
 * text) and takes focus when something is saved.
 */
function useNotice() {
  const [notice, setNotice] = useState({ text: '', n: 0 })
  const ref = useRef<HTMLParagraphElement>(null)
  useLayoutEffect(() => {
    if (notice.n) ref.current?.focus()
  }, [notice])
  const element = (
    <p ref={ref} role="status" tabIndex={-1} className={notice.text ? 'form-notice' : 'sr-only'}>
      {notice.text}
    </p>
  )
  return [element, (text: string) => setNotice((n) => ({ text, n: n.n + 1 }))] as const
}

/** A table that scrolls sideways on its own on a narrow screen, keyboard-reachable. */
function Scroll({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="table-scroll" role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  )
}

/**
 * The rotation (#/rotation, plan 9): standings and who's next, then past
 * choosers, passes and the adjustment log. Staff (admin and moderators) also
 * record passes, next-chooser decisions and adjustments.
 */
export default function RotationPage() {
  const rotation = useRotation()
  const { profile } = useAuth()
  const { data, failed, retry } = rotation
  const isStaff = profile?.role === 'admin' || profile?.role === 'moderator'

  if (!data) {
    return (
      <main className="page rotation-page">
        <h1>Rotation</h1>
        {failed ? (
          <>
            <p role="alert" className="form-error">
              Couldn't load the rotation. Check your connection.
            </p>
            <button type="button" className="button" onClick={retry}>
              Try again
            </button>
          </>
        ) : (
          <p role="status" className="muted">
            Loading the rotation…
          </p>
        )}
      </main>
    )
  }

  const byId = new Map(data.people.map((p) => [p.id, p]))
  return (
    <main className="page rotation-page">
      <h1>Rotation</h1>
      <NextUp rotation={rotation} />
      {profile?.role === 'admin' && <EpochForm rotation={rotation} epoch={data.epoch} />}
      {data.epoch && (
        <>
          {isStaff && <StaffTools rotation={rotation} data={data} />}
          <PastChoosers data={data} byId={byId} />
          <Passes rotation={rotation} data={data} byId={byId} />
          <AdjustmentLog data={data} byId={byId} />
        </>
      )}
    </main>
  )
}

interface Props {
  data: RotationData
  byId: Map<string, Person>
}

function PastChoosers({ data, byId }: Props) {
  const today = lisbonDate()
  const past = data.chosen.filter((f) => f.screenedOn >= data.epoch! && f.screenedOn <= today)
  return (
    <section className="film-section">
      <h2>Past choosers</h2>
      {past.length === 0 ? (
        <p className="muted">No screenings since {ymd(data.epoch!)}.</p>
      ) : (
        <Scroll label="Past choosers">
          <table className="rotation-table">
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Film</th>
                <th scope="col">Chosen by</th>
              </tr>
            </thead>
            <tbody>
              {past.map((f) => (
                <tr key={f.id}>
                  <td>{ymd(f.screenedOn)}</td>
                  <td>
                    <Link to={`/films/${f.id}`}>{f.title}</Link>{' '}
                    {KIND_LABELS[f.kind] && <span className="badge">{KIND_LABELS[f.kind]}</span>}
                  </td>
                  <td>
                    <Chip person={byId.get(f.assignedId)} />
                    {f.turnHolderId && (
                      <span className="muted">
                        {' '}
                        (missed: <PersonName person={byId.get(f.turnHolderId)} />)
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Scroll>
      )}
    </section>
  )
}

function Passes({ rotation, data, byId }: Props & { rotation: Rotation }) {
  const { profile } = useAuth()
  const { run, busy, error } = rotation
  const isStaff = profile?.role === 'admin' || profile?.role === 'moderator'
  // Members: their own pass, only from the coming week on (R4; RLS enforces it).
  // Staff can still correct any pass.
  const canRemove = (p: { weekStart: string; profileId: string }) =>
    isStaff ||
    (profile?.role === 'member' &&
      p.profileId === profile.id &&
      !!data.weekStart &&
      p.weekStart >= data.weekStart)
  return (
    <section className="film-section">
      <h2>Passes</h2>
      {data.passes.length === 0 ? (
        <p className="muted">Nobody has passed.</p>
      ) : (
        <Scroll label="Passes">
          <table className="rotation-table">
            <thead>
              <tr>
                <th scope="col">Week of</th>
                <th scope="col">Can't make it</th>
                <th scope="col">Recorded by</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.passes.map((p) => (
                <tr key={`${p.weekStart} ${p.profileId}`}>
                  <td>{ymd(p.weekStart)}</td>
                  <td>
                    <Chip person={byId.get(p.profileId)} />
                  </td>
                  <td>{p.createdBy ? <PersonName person={byId.get(p.createdBy)} /> : '–'}</td>
                  <td>
                    {canRemove(p) && (
                      <button
                        type="button"
                        className="button button-secondary button-small"
                        aria-label={`Remove ${byId.get(p.profileId)?.name ?? ''}'s pass for ${ymd(p.weekStart)}`}
                        disabled={busy}
                        onClick={() =>
                          void run('passes', () => rotationWrites.unpass(p.weekStart, p.profileId))
                        }
                      >
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Scroll>
      )}
      {error?.section === 'passes' && (
        <p role="alert" className="form-error">
          {error.message}
        </p>
      )}
    </section>
  )
}

/** What an adjustment did, e.g. "set to 3", "+1", "−2", "cleared owed turn". */
function change(a: RotationData['adjustments'][number]): string {
  const parts = []
  if (a.setTo != null) parts.push(`set to ${a.setTo}`)
  if (a.delta != null) parts.push(a.delta < 0 ? `−${-a.delta}` : `+${a.delta}`)
  if (a.clearOwedTurn) parts.push('cleared owed turn')
  return parts.join(', ')
}

function AdjustmentLog({ data, byId }: Props) {
  return (
    <section className="film-section">
      <h2>Adjustments</h2>
      {data.adjustments.length === 0 ? (
        <p className="muted">No adjustments.</p>
      ) : (
        <Scroll label="Adjustments">
          <table className="rotation-table">
            <thead>
              <tr>
                <th scope="col">From</th>
                <th scope="col">Person</th>
                <th scope="col">Change</th>
                <th scope="col">Reason</th>
                <th scope="col">By</th>
              </tr>
            </thead>
            <tbody>
              {data.adjustments.map((a) => (
                <tr key={a.id}>
                  <td>{ymd(lisbonDate(a.effectiveAt))}</td>
                  <td>
                    <Chip person={byId.get(a.profileId)} />
                  </td>
                  <td>{change(a)}</td>
                  <td>{a.reason}</td>
                  <td>{a.createdBy ? <PersonName person={byId.get(a.createdBy)} /> : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Scroll>
      )}
    </section>
  )
}

/** Staff forms: a pass for someone, a next-chooser decision, an adjustment. */
function StaffTools({ rotation, data }: { rotation: Rotation; data: RotationData }) {
  const { run, busy, error } = rotation
  const today = lisbonDate()
  // Everyone in the rotation (not viewers or system profiles), even before go-live.
  const people = data.people.filter((p) => !p.isSystem && p.role !== 'viewer').sort(byName)
  const week = data.weekStart ?? mondayOf(data.epoch! > today ? data.epoch! : today)

  const [notice, showNotice] = useNotice()
  const [passWho, setPassWho] = useState('')
  const [passDay, setPassDay] = useState(week)
  const [nextWho, setNextWho] = useState('')
  const [nextDay, setNextDay] = useState(week)
  const [adj, setAdj] = useState({
    who: '',
    kind: 'set_to' as 'set_to' | 'delta' | 'clear',
    value: '',
    from: data.epoch! > today ? data.epoch! : today,
    reason: '',
  })
  const [invalid, setInvalid] = useState('')

  const submit =
    (section: string, done: string, write: () => Promise<void>, reset: () => void) =>
    async (e: FormEvent) => {
      e.preventDefault()
      if (await run(section, write)) {
        reset()
        showNotice(done)
      }
    }

  const submitAdjustment = (e: FormEvent) => {
    e.preventDefault()
    const value = adj.value.trim()
    const n = Number(value)
    const problem = !isDate(adj.from)
      ? 'Enter a date.'
      : adj.from < data.epoch!
        ? `Choose a date on or after the rotation start (${ymd(data.epoch!)}).`
        : adj.kind === 'clear'
          ? ''
          : !/^-?\d{1,4}$/.test(value)
            ? 'Enter a whole number.'
            : adj.kind === 'set_to' && n < 0
              ? 'Points start at 0.'
              : adj.kind === 'set_to' && n > 1000
                ? 'At most 1000 points.'
                : adj.kind === 'delta' && n === 0
                  ? "A correction can't be 0."
                  : adj.kind === 'delta' && Math.abs(n) > 1000
                    ? 'At most 1000 points at a time.'
                    : ''
    setInvalid(problem)
    if (problem) return
    void submit(
      'adjust',
      'Adjustment saved.',
      () =>
        rotationWrites.adjust({
          profile_id: adj.who,
          ...(adj.kind === 'set_to' ? { set_to: n } : {}),
          ...(adj.kind === 'delta' ? { delta: n } : {}),
          ...(adj.kind === 'clear' ? { clear_owed_turn: true } : {}),
          reason: adj.reason.trim(),
          effective_on: adj.from,
        }),
      () => setAdj((a) => ({ ...a, who: '', value: '', reason: '' })),
    )(e)
  }

  const errorFor = (section: string) =>
    error?.section === section && (
      <p role="alert" className="form-error">
        {error.message}
      </p>
    )
  const personSelect = (value: string, onChange: (v: string) => void) => (
    <label className="field">
      Person
      <select required value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose…</option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </label>
  )

  return (
    <section className="film-section staff-tools">
      <h2>Staff</h2>
      {notice}
      <form
        className="rotation-form"
        aria-labelledby="pass-heading"
        onSubmit={submit(
          'pass',
          'Pass recorded.',
          () => rotationWrites.pass(mondayOf(passDay), passWho),
          () => setPassWho(''),
        )}
      >
        <h3 id="pass-heading">Record a pass</h3>
        {personSelect(passWho, setPassWho)}
        <label className="field">
          Week (any day in it)
          <input
            type="date"
            required
            value={passDay}
            onChange={(e) => setPassDay(e.target.value)}
          />
        </label>
        <button type="submit" className="button button-small" disabled={busy}>
          Record pass
        </button>
        {errorFor('pass')}
      </form>

      <form
        className="rotation-form"
        aria-labelledby="decide-heading"
        onSubmit={submit(
          'decide',
          'Decision saved.',
          () => rotationWrites.decide(mondayOf(nextDay), nextWho),
          () => setNextWho(''),
        )}
      >
        <h3 id="decide-heading">Decide who's next</h3>
        <p className="muted">After a tie or a Democrático, record what the group decided.</p>
        {personSelect(nextWho, setNextWho)}
        <label className="field">
          Week (any day in it)
          <input
            type="date"
            required
            value={nextDay}
            onChange={(e) => setNextDay(e.target.value)}
          />
        </label>
        <button type="submit" className="button button-small" disabled={busy}>
          Save decision
        </button>
        {errorFor('decide')}
      </form>

      <form
        className="rotation-form"
        aria-labelledby="adjust-heading"
        onSubmit={submitAdjustment}
        noValidate
      >
        <h3 id="adjust-heading">Adjust points</h3>
        {personSelect(adj.who, (who) => setAdj({ ...adj, who }))}
        <fieldset className="adjust-kind">
          <legend>Change</legend>
          {(
            [
              ['set_to', 'Set points to (starting value)'],
              ['delta', 'Add or subtract (correction)'],
              ['clear', 'Clear owed turn'],
            ] as const
          ).map(([kind, label]) => (
            <label key={kind} className="check">
              <input
                type="radio"
                name="adjust-kind"
                checked={adj.kind === kind}
                onChange={() => setAdj({ ...adj, kind })}
              />
              {label}
            </label>
          ))}
        </fieldset>
        {adj.kind !== 'clear' && (
          <label className="field">
            {adj.kind === 'set_to' ? 'Points' : 'Points to add (negative to subtract)'}
            <input
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={adj.value}
              onChange={(e) => setAdj({ ...adj, value: e.target.value })}
              aria-invalid={!!invalid}
              aria-describedby={
                [adj.kind === 'delta' && 'adjust-floor', invalid && 'adjust-invalid']
                  .filter(Boolean)
                  .join(' ') || undefined
              }
            />
          </label>
        )}
        {adj.kind === 'delta' && (
          <p id="adjust-floor" className="muted">
            Points never go below 0: a larger subtraction leaves 0.
          </p>
        )}
        <label className="field">
          Effective from
          <input
            type="date"
            required
            min={data.epoch!}
            value={adj.from}
            aria-describedby="adjust-from-hint"
            onChange={(e) => setAdj({ ...adj, from: e.target.value })}
          />
        </label>
        <p id="adjust-from-hint" className="muted">
          Applies from the start of that day, before that day's screenings.
        </p>
        {data.chosen.some((f) => f.screenedOn === adj.from) && (
          <p className="form-notice">
            This applies before that day's screening. Choose the next day to apply it after.
          </p>
        )}
        <label className="field">
          Reason
          <input
            type="text"
            required
            maxLength={500}
            value={adj.reason}
            onChange={(e) => setAdj({ ...adj, reason: e.target.value })}
          />
        </label>
        <button
          type="submit"
          className="button button-small"
          disabled={busy || !adj.who || !adj.reason.trim() || !adj.from}
        >
          Save adjustment
        </button>
        {invalid && (
          <p id="adjust-invalid" role="alert" className="form-error">
            {invalid}
          </p>
        )}
        {errorFor('adjust')}
      </form>
    </section>
  )
}

/** Admin only (R3): the go-live date everything is computed from. */
function EpochForm({ rotation, epoch }: { rotation: Rotation; epoch: string | null }) {
  const { run, busy, error } = rotation
  const [value, setValue] = useState(epoch ?? lisbonDate())
  const [invalid, setInvalid] = useState('')
  const [notice, showNotice] = useNotice()
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!isDate(value)) return setInvalid('Enter a date.')
    setInvalid('')
    if (value === epoch) return
    const question = epoch
      ? `Change the rotation start date from ${ymd(epoch)} to ${ymd(value)}?`
      : `Start the rotation on ${ymd(value)}?`
    if (!confirm(`${question} All points and owed turns are recalculated from that date.`)) return
    if (await run('epoch', () => rotationWrites.setEpoch(value))) {
      showNotice('Rotation start date saved.')
    }
  }
  return (
    <section className="film-section">
      <h2>Rotation start date</h2>
      {notice}
      <form className="rotation-form" aria-label="Rotation start date" onSubmit={submit} noValidate>
        <p className="muted">
          Points and owed turns count from this day (go-live). Changing it recomputes everything.
        </p>
        <label className="field">
          Start date
          <input
            type="date"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-invalid={!!invalid}
            aria-describedby={invalid ? 'epoch-invalid' : undefined}
          />
        </label>
        <button type="submit" className="button button-small" disabled={busy}>
          Save start date
        </button>
        {invalid && (
          <p id="epoch-invalid" role="alert" className="form-error">
            {invalid}
          </p>
        )}
        {error?.section === 'epoch' && (
          <p role="alert" className="form-error">
            {error.message}
          </p>
        )}
      </form>
    </section>
  )
}
