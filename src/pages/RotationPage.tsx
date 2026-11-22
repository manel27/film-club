import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../auth/authContext'
import Chip from '../components/Chip'
import { NextUp } from '../components/NextUp'
import { KIND_LABELS, type Person } from '../films/films'
import { rotationWrites, type RotationData } from '../rotation/api'
import { lisbonDate, mondayOf, ymd } from '../rotation/rotation'
import { useRotation, type Rotation } from '../rotation/useRotation'

const byName = (a: Person, b: Person) => a.name.localeCompare(b.name)

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
  return (
    <section className="film-section">
      <h2>Past choosers</h2>
      {data.chosen.length === 0 ? (
        <p className="muted">No screenings since {ymd(data.epoch!)}.</p>
      ) : (
        <table className="rotation-table">
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Film</th>
              <th scope="col">Chosen by</th>
            </tr>
          </thead>
          <tbody>
            {data.chosen.map((f) => (
              <tr key={f.id}>
                <td>{ymd(f.screenedOn)}</td>
                <td>
                  <Link to={`/films/${f.id}`}>{f.title}</Link>{' '}
                  {KIND_LABELS[f.kind] && <span className="badge">{KIND_LABELS[f.kind]}</span>}
                </td>
                <td>
                  <Chip person={byId.get(f.assignedId)} />
                  {f.turnHolderId && (
                    <span className="muted"> (missed: {byId.get(f.turnHolderId)?.name})</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

function Passes({ rotation, data, byId }: Props & { rotation: Rotation }) {
  const { profile } = useAuth()
  const { run, busy, error } = rotation
  const isStaff = profile?.role === 'admin' || profile?.role === 'moderator'
  const thisWeek = mondayOf(lisbonDate())
  const canRemove = (id: string) => isStaff || (profile?.role === 'member' && id === profile.id)
  return (
    <section className="film-section">
      <h2>Passes</h2>
      {data.passes.length === 0 ? (
        <p className="muted">Nobody has passed.</p>
      ) : (
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
                <td>{p.createdBy ? byId.get(p.createdBy)?.name : '–'}</td>
                <td>
                  {p.weekStart >= thisWeek && canRemove(p.profileId) && (
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
                <td>{a.createdBy ? (byId.get(a.createdBy)?.name ?? 'Unknown') : '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

/** Staff forms: a pass for someone, a next-chooser decision, an adjustment. */
function StaffTools({ rotation, data }: { rotation: Rotation; data: RotationData }) {
  const { run, busy, error } = rotation
  const today = lisbonDate()
  // Before go-live there are no standings yet: everyone but system profiles.
  const inRotation = new Set(data.standings.map((s) => s.profileId))
  const people = data.people
    .filter((p) => !p.isSystem && (inRotation.size === 0 || inRotation.has(p.id)))
    .sort(byName)
  const week = data.weekStart ?? mondayOf(data.epoch! > today ? data.epoch! : today)

  const [notice, setNotice] = useState('')
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
      setNotice('')
      if (await run(section, write)) {
        reset()
        setNotice(done)
      }
    }

  const submitAdjustment = (e: FormEvent) => {
    e.preventDefault()
    const value = adj.value.trim()
    const n = Number(value)
    const problem =
      adj.kind === 'clear'
        ? ''
        : !/^-?\d{1,6}$/.test(value)
          ? 'Enter a whole number.'
          : adj.kind === 'set_to' && n < 0
            ? 'Points start at 0.'
            : adj.kind === 'delta' && n === 0
              ? "A correction can't be 0."
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
      {notice && (
        <p role="status" className="form-notice">
          {notice}
        </p>
      )}
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
              aria-describedby={invalid ? 'adjust-invalid' : undefined}
            />
          </label>
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
