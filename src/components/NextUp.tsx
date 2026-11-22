import { useEffect, useRef } from 'react'
import { useAuth } from '../auth/authContext'
import { rotationWrites } from '../rotation/api'
import { nextUp, orderStandings, ymd } from '../rotation/rotation'
import { useRotation, type Rotation } from '../rotation/useRotation'
import Chip from './Chip'

/**
 * "Next up" (plan 6.2, 9): the standings with owed turns pinned on top, who
 * chooses in the coming week (or a tie to talk out), and "I can't make it"
 * for the logged-in member.
 */
export function NextUp({ rotation }: { rotation: Rotation }) {
  const { profile } = useAuth()
  const { data, run, busy, error } = rotation
  const passButton = useRef<HTMLButtonElement>(null)
  // Disabled while busy, the button loses focus: give it back once done.
  const refocus = useRef(false)
  useEffect(() => {
    if (!refocus.current || busy) return
    refocus.current = false
    passButton.current?.focus()
  })
  if (!data) return null
  const byId = new Map(data.people.map((p) => [p.id, p]))
  const name = (id: string) => byId.get(id)?.name ?? ''
  const week = data.weekStart

  let body: React.ReactNode
  if (!data.epoch) {
    body = <p className="muted">The rotation starts at go-live: no points or turns yet.</p>
  } else if (!week) {
    body = <p className="muted">The rotation starts on {ymd(data.epoch)}.</p>
  } else {
    const passing = new Set(data.passes.filter((p) => p.weekStart === week).map((p) => p.profileId))
    const decision = data.decisions.find((d) => d.weekStart === week)
    const next = nextUp(data.standings, passing, decision?.profileId ?? null)
    const mine = profile && data.standings.some((s) => s.profileId === profile.id)
    const canPass = mine && profile.role !== 'viewer'
    const iPass = !!profile && passing.has(profile.id)
    body = (
      <>
        <p className="next-chooser">
          <span className="muted">Week of {ymd(week)}: </span>
          {next.kind === 'none' ? (
            'nobody available, everyone is passing.'
          ) : next.kind === 'tie' ? (
            <strong>{next.ids.map(name).join(' / ')}: talk it out</strong>
          ) : (
            <>
              <Chip person={byId.get(next.ids[0])} />
              {next.kind === 'owed' && ' (owed turn)'}
              {next.kind === 'decided' &&
                ` (decided${decision?.decidedBy ? ` by ${name(decision.decidedBy)}` : ''})`}
            </>
          )}
        </p>
        {passing.size > 0 && (
          <p className="muted">Can't make it: {[...passing].map(name).sort().join(', ')}</p>
        )}
        <ol className="standings" aria-label="Standings">
          {orderStandings(data.standings, name).map((s) => (
            <li key={s.profileId}>
              <Chip person={byId.get(s.profileId)} />
              <span className="standing-points">
                {s.points} {s.points === 1 ? 'point' : 'points'}
              </span>
              {s.owedSince && (
                <span className="badge">
                  owed turn (missed the Democrático on {ymd(s.owedSince)})
                </span>
              )}
            </li>
          ))}
        </ol>
        {canPass && (
          <button
            ref={passButton}
            type="button"
            className="button button-secondary button-small"
            disabled={busy}
            onClick={() => {
              refocus.current = true
              void run('next-up', () =>
                iPass
                  ? rotationWrites.unpass(week, profile.id)
                  : rotationWrites.pass(week, profile.id),
              )
            }}
          >
            {iPass ? 'I can make it after all' : "I can't make it"}
          </button>
        )}
        {error?.section === 'next-up' && (
          <p role="alert" className="form-error">
            {error.message}
          </p>
        )}
      </>
    )
  }

  return (
    <section className="card next-up" aria-labelledby="next-up-heading">
      <h2 id="next-up-heading">Next up</h2>
      {body}
    </section>
  )
}

/** The films page's card: loads the rotation by itself. */
export default function NextUpCard() {
  const rotation = useRotation()
  if (rotation.failed && !rotation.data) {
    return (
      <section className="card next-up" aria-labelledby="next-up-heading">
        <h2 id="next-up-heading">Next up</h2>
        <p role="alert" className="form-error">
          Couldn't load the rotation.
        </p>
        <button type="button" className="button button-small" onClick={rotation.retry}>
          Try again
        </button>
      </section>
    )
  }
  if (!rotation.data) {
    return (
      <p role="status" className="muted">
        Loading the rotation…
      </p>
    )
  }
  return <NextUp rotation={rotation} />
}
