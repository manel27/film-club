import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router'
import { useAuth } from '../auth/authContext'
import { fetchFilm, filmWrites, type FilmDetailData, type FilmRecord } from '../films/api'
import { parseScore, permissions } from '../films/filmDetail'
import { KIND_LABELS, type Person } from '../films/films'
import { textOn } from '../lib/colour'

type Perms = ReturnType<typeof permissions>
type Run = (write: () => Promise<void>) => Promise<boolean>

function errorMessage(error: unknown): string {
  const { code, message } = (error ?? {}) as { code?: string; message?: string }
  if (code === '42501') return message?.includes('locked') ? message : "You can't change that."
  return message || 'Something went wrong. Try again.'
}

const BackLink = () => (
  // The films page brings back its last view and filters by itself.
  <Link to="/" className="back-link">
    ← All films
  </Link>
)

/** A film's page (#/films/:id): details, attendance, scores and comments. */
export default function FilmPage() {
  const { id } = useParams()
  const filmId = /^\d+$/.test(id ?? '') ? Number(id) : null
  const { profile } = useAuth()
  // undefined = loading, null = no such film
  const [data, setData] = useState<FilmDetailData | null | undefined>(undefined)
  const [failed, setFailed] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(
    async () => filmId !== null && fetchFilm(filmId).then(setData, () => setFailed(true)),
    [filmId],
  )
  useEffect(() => {
    void load()
  }, [load])

  const run: Run = async (write) => {
    setError('')
    try {
      await write()
      return true
    } catch (e) {
      setError(errorMessage(e))
      return false
    } finally {
      await load()
    }
  }

  if (failed || data === null || filmId === null) {
    return (
      <main className="page">
        <h1>{failed ? "Couldn't load the film" : 'Film not found'}</h1>
        <p>
          <BackLink />
        </p>
      </main>
    )
  }
  if (data === undefined) {
    return (
      <main className="page">
        <p role="status" className="muted">
          Loading film…
        </p>
      </main>
    )
  }

  const { film, people } = data
  const byId = new Map(people.map((p) => [p.id, p]))
  const perms = permissions(profile, film.scores_locked)
  const kind = KIND_LABELS[film.kind]
  const assigned = byId.get(film.assigned_id)
  const turnHolder = film.turn_holder_id ? byId.get(film.turn_holder_id) : undefined

  return (
    <main className="page film-page">
      <BackLink />
      {film.is_easter_egg && <LostTheGame />}
      <div className="film-header">
        {film.poster_path && (
          <img
            className="film-poster"
            src={`https://image.tmdb.org/t/p/w500${film.poster_path}`}
            alt={`Poster of ${film.title}`}
            width={500}
            height={750}
          />
        )}
        <div>
          <h1>
            {film.title} {kind && <span className="badge">{kind}</span>}
          </h1>
          {film.original_title && film.original_title !== film.title && (
            <p className="muted">{film.original_title}</p>
          )}
          <dl className="film-facts">
            <Fact label="Year" value={film.release_year} />
            <Fact label="Directed by" value={film.directors.join(', ')} />
            <Fact label="Genres" value={film.genres.join(', ')} />
            <Fact label="Runtime" value={film.runtime_min && `${film.runtime_min} min`} />
            <Fact label="Shown on" value={film.screened_on.replaceAll('-', '/')} />
            <Fact label="Chosen by" value={assigned && <Chip person={assigned} />} />
            <Fact label="Missed their turn" value={turnHolder && <Chip person={turnHolder} />} />
          </dl>
          {film.overview && <p className="film-overview">{film.overview}</p>}
        </div>
      </div>

      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}

      <Attendance
        film={film}
        people={people}
        byId={byId}
        perms={perms}
        me={profile?.id}
        run={run}
      />
      <Scores data={data} byId={byId} perms={perms} me={profile?.id} run={run} />
      <Comments film={film} byId={byId} perms={perms} me={profile?.id} run={run} />
    </main>
  )
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  if (!value) return null
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  )
}

/** A person's name on their own colour, with black or white text. */
function Chip({ person }: { person: Person | undefined }) {
  const style = person?.colour
    ? { backgroundColor: person.colour, color: textOn(person.colour) }
    : undefined
  return (
    <span className="chip" style={style}>
      {person?.name ?? 'Unknown'}
    </span>
  )
}

const byName = (a: Person | undefined, b: Person | undefined) =>
  (a?.name ?? '').localeCompare(b?.name ?? '')

interface SectionProps {
  byId: Map<string, Person>
  perms: Perms
  me: string | undefined
  run: Run
}

function Attendance({
  film,
  people,
  byId,
  perms,
  me,
  run,
}: SectionProps & { film: FilmRecord; people: Person[] }) {
  const present = new Set(film.attendance.map((a) => a.profile_id))
  const toggle = (id: string, on: boolean) => run(() => filmWrites.setPresent(film.id, id, on))
  return (
    <section className="film-section">
      <h2>Present</h2>
      {present.size === 0 ? (
        <p className="muted">Nobody marked as present.</p>
      ) : (
        <ul className="chips">
          {[...present]
            .map((id) => byId.get(id))
            .sort(byName)
            .map((p, i) => (
              <li key={p?.id ?? i}>
                <Chip person={p} />
              </li>
            ))}
        </ul>
      )}
      {perms.isStaff ? (
        <details className="edit-attendance">
          <summary>Edit attendance</summary>
          <fieldset>
            <legend className="sr-only">Who was present</legend>
            {people
              .filter((p) => !p.isSystem)
              .sort(byName)
              .map((p) => (
                <label key={p.id} className="check">
                  <input
                    type="checkbox"
                    checked={present.has(p.id)}
                    onChange={(e) => toggle(p.id, e.target.checked)}
                  />
                  {p.name}
                </label>
              ))}
          </fieldset>
        </details>
      ) : (
        perms.canWrite &&
        me && (
          <button
            type="button"
            className="button button-secondary button-small"
            onClick={() => toggle(me, !present.has(me))}
          >
            {present.has(me) ? "I wasn't there" : 'I was there'}
          </button>
        )
      )}
    </section>
  )
}

const LockIcon = () => (
  <svg
    viewBox="0 0 24 24"
    width="18"
    height="18"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    aria-hidden="true"
  >
    <rect x="4" y="11" width="16" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
)

function Scores({ data, byId, perms, me, run }: SectionProps & { data: FilmDetailData }) {
  const { film } = data
  const scores = [...film.scores].sort((a, b) =>
    byName(byId.get(a.profile_id), byId.get(b.profile_id)),
  )
  // The easter egg's 11s count nowhere else (film_stats leaves them out), but are shown here.
  const average =
    film.is_easter_egg && scores.length > 0
      ? scores.reduce((sum, s) => sum + s.score, 0) / scores.length
      : data.avgScore
  const remove = (profileId: string) => {
    if (confirm(`Delete ${byId.get(profileId)?.name ?? 'this'}'s score?`)) {
      void run(() => filmWrites.deleteScore(film.id, profileId))
    }
  }

  return (
    <section className="film-section">
      <h2>Scores</h2>
      {film.scores_locked && (
        <p className="locked">
          <LockIcon /> These scores are locked: nobody can change them.
        </p>
      )}
      {scores.length === 0 ? (
        <p className="muted">No scores yet.</p>
      ) : (
        <table className="scores">
          <thead>
            <tr>
              <th scope="col">Person</th>
              <th scope="col">Score</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {scores.map((s) => (
              <tr key={s.profile_id}>
                <th scope="row">{byId.get(s.profile_id)?.name ?? 'Unknown'}</th>
                <td>{s.score.toFixed(2)}</td>
                <td>
                  {perms.score(s.profile_id) && (
                    <button
                      type="button"
                      className="button button-secondary button-small"
                      aria-label={`Delete ${byId.get(s.profile_id)?.name ?? ''}'s score`}
                      onClick={() => remove(s.profile_id)}
                    >
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Average</th>
              <td>{average == null ? '–' : average.toFixed(2)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      )}
      {me && perms.score(me) && (
        <ScoreForm film={film} people={[...byId.values()]} perms={perms} me={me} run={run} />
      )}
    </section>
  )
}

function ScoreForm({
  film,
  people,
  perms,
  me,
  run,
}: Omit<SectionProps, 'byId' | 'me'> & { film: FilmRecord; people: Person[]; me: string }) {
  const current = (id: string) =>
    film.scores.find((s) => s.profile_id === id)?.score.toFixed(2) ?? ''
  const [who, setWho] = useState(me)
  const [value, setValue] = useState(() => current(me))
  const [invalid, setInvalid] = useState('')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const parsed = parseScore(value)
    if ('error' in parsed) return setInvalid(parsed.error)
    setInvalid('')
    await run(() => filmWrites.saveScore(film.id, who, parsed.score))
  }

  return (
    <form className="score-form" onSubmit={submit} noValidate>
      {perms.isStaff && (
        <label className="field">
          Score for
          <select
            value={who}
            onChange={(e) => {
              setWho(e.target.value)
              setValue(current(e.target.value))
              setInvalid('')
            }}
          >
            {people
              .filter((p) => !p.isSystem)
              .sort(byName)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.id === me ? `${p.name} (you)` : p.name}
                </option>
              ))}
          </select>
        </label>
      )}
      <label className="field">
        {who === me ? 'Your score' : 'Score'}
        <input
          type="number"
          inputMode="decimal"
          min={0}
          max={10}
          step={0.01}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-invalid={!!invalid}
          aria-describedby={invalid ? 'score-error' : undefined}
        />
      </label>
      <button type="submit" className="button button-small">
        Save score
      </button>
      {invalid && (
        <p id="score-error" className="form-error">
          {invalid}
        </p>
      )}
    </form>
  )
}

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', {
    timeZone: 'Europe/Lisbon',
    dateStyle: 'medium',
    timeStyle: 'short',
  })

function Comments({ film, byId, perms, me, run }: SectionProps & { film: FilmRecord }) {
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState<{ id: number; body: string } | null>(null)

  const post = async (e: FormEvent) => {
    e.preventDefault()
    if (me && (await run(() => filmWrites.addComment(film.id, me, draft.trim())))) setDraft('')
  }
  const saveEdit = async (e: FormEvent) => {
    e.preventDefault()
    if (editing && (await run(() => filmWrites.editComment(editing.id, editing.body.trim())))) {
      setEditing(null)
    }
  }

  return (
    <section className="film-section">
      <h2>Comments</h2>
      {film.comments.length === 0 && <p className="muted">No comments yet.</p>}
      <ul className="comments">
        {film.comments.map((c) => (
          <li key={c.id} className="comment">
            <p className="comment-meta">
              <Chip person={byId.get(c.author_id)} />{' '}
              <span className="muted">
                {when(c.created_at)}
                {c.edited_at && ' (edited)'}
              </span>
            </p>
            {editing?.id === c.id ? (
              <form onSubmit={saveEdit} className="comment-form">
                <label className="sr-only" htmlFor={`edit-${c.id}`}>
                  Edit comment
                </label>
                <textarea
                  id={`edit-${c.id}`}
                  value={editing.body}
                  maxLength={4000}
                  onChange={(e) => setEditing({ id: c.id, body: e.target.value })}
                />
                <div className="comment-actions">
                  <button
                    type="submit"
                    className="button button-small"
                    disabled={!editing.body.trim()}
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    className="button button-secondary button-small"
                    onClick={() => setEditing(null)}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <>
                <p className="comment-body">{c.body}</p>
                {perms.comment(c.author_id) && (
                  <div className="comment-actions">
                    <button
                      type="button"
                      className="button button-secondary button-small"
                      onClick={() => setEditing({ id: c.id, body: c.body })}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="button button-secondary button-small"
                      onClick={() => {
                        if (confirm('Delete this comment?')) {
                          void run(() => filmWrites.deleteComment(c.id))
                        }
                      }}
                    >
                      Delete
                    </button>
                  </div>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
      {perms.canWrite && (
        <form onSubmit={post} className="comment-form">
          <label htmlFor="new-comment">Add a comment</label>
          <textarea
            id="new-comment"
            value={draft}
            maxLength={4000}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button type="submit" className="button button-small" disabled={!draft.trim()}>
            Post
          </button>
        </form>
      )}
    </section>
  )
}

// Deterministic "random" spread, so rendering stays pure.
const CONFETTI = Array.from({ length: 60 }, (_, i) => ({
  left: `${(i * 37) % 100}%`,
  delay: `${((i * 53) % 30) / 10}s`,
  colour: ['var(--accent)', 'var(--accent-2)', 'var(--highlight)', 'var(--danger)'][i % 4],
}))

/** The Jurassic Shark 2 joke (plan 4.4). The confetti is off with reduced motion. */
function LostTheGame() {
  return (
    <>
      <p className="lost-game">You just lost the game!</p>
      <div className="confetti" aria-hidden="true">
        {CONFETTI.map((c, i) => (
          <span key={i} style={{ left: c.left, animationDelay: c.delay, background: c.colour }} />
        ))}
      </div>
    </>
  )
}
