import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useAuth } from '../auth/authContext'
import { fetchFilm, filmWrites, type FilmDetailData, type FilmRecord } from '../films/api'
import { errorMessage, parseScore, permissions } from '../films/filmDetail'
import { KIND_LABELS, type Person } from '../films/films'
import Chip from '../components/Chip'
import { fetchEpoch } from '../rotation/api'
import { lisbonDate } from '../rotation/rotation'

type Section = 'attendance' | 'scores' | 'comments' | 'delete'
/** Runs one write at a time, then reloads the film. Resolves true on success. */
type Run = (section: Section, write: () => Promise<void>) => Promise<boolean>

const BackLink = () => (
  // The films page brings back its last view and filters by itself.
  <Link to="/" className="back-link">
    ← All films
  </Link>
)

/** Focuses the element with this id after the next render (once it exists). */
function useFocusLater() {
  const target = useRef('')
  useEffect(() => {
    if (target.current) document.getElementById(target.current)?.focus()
    target.current = ''
  })
  return (id: string) => {
    target.current = id
  }
}

/** A film's page (#/films/:id). Keyed by id, so nothing carries over between films. */
export default function FilmPage() {
  const { id = '' } = useParams()
  return <Film key={id} id={id} />
}

function Film({ id }: { id: string }) {
  const n = Number(id)
  const filmId = /^\d+$/.test(id) && Number.isSafeInteger(n) && n > 0 ? n : null
  const { profile } = useAuth()
  // undefined = loading, null = no such film
  const [data, setData] = useState<FilmDetailData | null | undefined>(undefined)
  const [failed, setFailed] = useState(false)
  const [error, setError] = useState<{ section: Section; message: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const people = useRef<Person[] | undefined>(undefined)
  const navigate = useNavigate()

  // Only the first load can fail the page; a failed reload keeps what is shown.
  const load = useCallback(async () => {
    if (filmId === null) return
    try {
      const d = await fetchFilm(filmId, people.current)
      people.current = d?.people
      setData(d)
      setFailed(false)
    } catch {
      setFailed(true)
    }
  }, [filmId])
  useEffect(() => {
    void load()
  }, [load])

  const run: Run = async (section, write) => {
    if (busyRef.current) return false
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      await write()
      return true
    } catch (e) {
      setError({ section, message: errorMessage(e) })
      return false
    } finally {
      await load()
      busyRef.current = false
      setBusy(false)
    }
  }

  // Not run(): a reload after a successful delete would flash "Film not found".
  const deleteFilm = async (film: FilmRecord) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      await filmWrites.deleteFilm(film.id)
      navigate('/', { replace: true, state: { notice: `Deleted "${film.title}".` } })
    } catch (e) {
      setError({ section: 'delete', message: errorMessage(e) })
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  if (filmId === null || data === null) {
    return (
      <main className="page">
        <h1>Film not found</h1>
        {/* E.g. "This film was deleted." from a write that found it gone. */}
        {error && (
          <p role="alert" className="form-error">
            {error.message}
          </p>
        )}
        <p>
          <BackLink />
        </p>
      </main>
    )
  }
  if (data === undefined) {
    return (
      <main className="page">
        {failed ? (
          <>
            <p role="alert" className="form-error">
              Couldn't load the film. Check your connection.
            </p>
            <button
              type="button"
              className="button"
              onClick={() => {
                setFailed(false)
                void load()
              }}
            >
              Try again
            </button>
          </>
        ) : (
          <p role="status" className="muted">
            Loading film…
          </p>
        )}
      </main>
    )
  }

  const { film } = data
  const byId = new Map(data.people.map((p) => [p.id, p]))
  const kind = KIND_LABELS[film.kind]
  const assigned = byId.get(film.assigned_id)
  const turnHolder = film.turn_holder_id ? byId.get(film.turn_holder_id) : undefined
  const perms = permissions(profile, film.scores_locked)
  const errorFor = (section: Section) =>
    error?.section === section && (
      <p role="alert" className="form-error">
        {error.message}
      </p>
    )
  const props: SectionProps = { byId, perms, me: profile?.id, run, busy, errorFor }

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
          <h1>{film.title}</h1>
          {permissions(profile, false).isStaff && (
            <Link to={`/films/${film.id}/edit`} className="button button-secondary button-small">
              Edit
            </Link>
          )}{' '}
          {perms.deleteFilm && (
            <DeleteFilm
              film={film}
              busy={busy}
              error={error?.section === 'delete' ? error.message : ''}
              onDelete={() => void deleteFilm(film)}
              // Fresh counts on open; after a failed delete, what is there now
              // (maybe "Film not found", which keeps the message).
              reload={() => void load()}
            />
          )}
          {/* Also outside the dialog, so closing it never hides a failure. */}
          {errorFor('delete')}
          {film.original_title && film.original_title !== film.title && (
            <p className="muted">{film.original_title}</p>
          )}
          {kind && <span className="badge">{kind}</span>}
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

      <Attendance film={film} people={data.people} {...props} />
      <Scores data={data} {...props} />
      <Comments film={film} {...props} />
    </main>
  )
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** "Delete film" and its confirmation dialog (native <dialog>: focus, Escape and inertness for free). */
function DeleteFilm({
  film,
  busy,
  error,
  onDelete,
  reload,
}: {
  film: FilmRecord
  busy: boolean
  error: string
  onDelete: () => void
  reload: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  // Deleting a counted screening changes the rotation (plan 11): say so.
  const [epoch, setEpoch] = useState<string | null>(null)
  useEffect(() => {
    let current = true
    fetchEpoch().then(
      (e) => current && setEpoch(e),
      () => {},
    )
    return () => {
      current = false
    }
  }, [])
  const inRotation =
    (film.kind === 'normal' || film.kind === 'democratico') &&
    !!epoch &&
    film.screened_on >= epoch &&
    film.screened_on <= lisbonDate()
  return (
    <>
      <button
        type="button"
        className="button button-danger button-small"
        onClick={() => {
          dialog.current?.showModal()
          cancel.current?.focus()
          reload()
        }}
      >
        Delete film
      </button>
      <dialog
        ref={dialog}
        className="confirm-dialog"
        aria-labelledby="delete-film-heading"
        aria-describedby="delete-film-loss"
        // Escape can't close it while the delete runs: its outcome must be seen.
        onCancel={(e) => busy && e.preventDefault()}
        onClose={() => error && reload()}
      >
        <h2 id="delete-film-heading">Delete "{film.title}"?</h2>
        <div id="delete-film-loss">
          <p>This also deletes, for good:</p>
          <ul>
            <li>{count(film.scores.length, 'score', 'scores')}</li>
            <li>{count(film.attendance.length, 'attendance mark', 'attendance marks')}</li>
            <li>{count(film.comments.length, 'comment', 'comments')}</li>
          </ul>
          {inRotation && <p>Rotation points will be recalculated without this screening.</p>}
        </div>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <div className="actions">
          {/* First, so showModal() focuses it rather than the destructive button. */}
          <button
            ref={cancel}
            type="button"
            className="button button-secondary"
            disabled={busy}
            onClick={() => dialog.current?.close()}
          >
            Cancel
          </button>
          <button type="button" className="button button-danger" disabled={busy} onClick={onDelete}>
            {busy ? 'Deleting…' : 'Yes, delete film'}
          </button>
        </div>
      </dialog>
    </>
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

const byName = (a: Person | undefined, b: Person | undefined) =>
  (a?.name ?? '').localeCompare(b?.name ?? '')

interface SectionProps {
  byId: Map<string, Person>
  perms: ReturnType<typeof permissions>
  me: string | undefined
  run: Run
  busy: boolean
  /** The last write error, if it came from this section. */
  errorFor: (section: Section) => React.ReactNode
}

function Attendance({
  film,
  people,
  byId,
  perms,
  me,
  run,
  busy,
  errorFor,
}: SectionProps & { film: FilmRecord; people: Person[] }) {
  const present = new Set(film.attendance.map((a) => a.profile_id))
  const toggle = (id: string, on: boolean) =>
    run('attendance', () => filmWrites.setPresent(film.id, id, on))
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
          <fieldset disabled={busy}>
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
            disabled={busy}
            onClick={() => toggle(me, !present.has(me))}
          >
            {present.has(me) ? "I wasn't there" : 'I was there'}
          </button>
        )
      )}
      {errorFor('attendance')}
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

function Scores({ data, ...props }: SectionProps & { data: FilmDetailData }) {
  const { byId, perms, me, run, busy, errorFor } = props
  const { film } = data
  const focusLater = useFocusLater()
  const scores = [...film.scores].sort((a, b) =>
    byName(byId.get(a.profile_id), byId.get(b.profile_id)),
  )
  // The easter egg's 11s count nowhere else (film_stats leaves them out), but are shown here.
  const average =
    film.is_easter_egg && scores.length > 0
      ? scores.reduce((sum, s) => sum + s.score, 0) / scores.length
      : data.avgScore
  const remove = async (profileId: string) => {
    if (!confirm(`Delete ${byId.get(profileId)?.name ?? 'this'}'s score?`)) return
    if (await run('scores', () => filmWrites.deleteScore(film.id, profileId))) {
      focusLater('score-input')
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
                <th scope="row">
                  <Link to={`/people/${s.profile_id}`}>
                    {byId.get(s.profile_id)?.name ?? 'Unknown'}
                  </Link>
                </th>
                <td>{s.score.toFixed(2)}</td>
                <td>
                  {perms.score(s.profile_id) && (
                    <button
                      type="button"
                      className="button button-secondary button-small"
                      aria-label={`Delete ${byId.get(s.profile_id)?.name ?? ''}'s score`}
                      disabled={busy}
                      onClick={() => void remove(s.profile_id)}
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
      {me && perms.score(me) && <ScoreForm film={film} {...props} me={me} />}
      {errorFor('scores')}
    </section>
  )
}

function ScoreForm({
  film,
  byId,
  perms,
  me,
  run,
  busy,
}: SectionProps & { film: FilmRecord; me: string }) {
  const [who, setWho] = useState(me)
  const saved = film.scores.find((s) => s.profile_id === who)?.score.toFixed(2) ?? ''
  const [value, setValue] = useState(saved)
  const [invalid, setInvalid] = useState('')
  // Follow the saved score when it changes (saved, deleted, changed elsewhere, other person).
  const [shown, setShown] = useState(saved)
  if (shown !== saved) {
    setShown(saved)
    setValue(saved)
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const parsed = parseScore(value)
    if ('error' in parsed) return setInvalid(parsed.error)
    setInvalid('')
    void run('scores', () => filmWrites.saveScore(film.id, who, parsed.score))
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
              setInvalid('')
            }}
          >
            {[...byId.values()]
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
        {/* Text, not number: number inputs drop a decimal comma ("7,5"). */}
        <input
          id="score-input"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-invalid={!!invalid}
          aria-describedby={invalid ? 'score-error' : undefined}
        />
      </label>
      <button type="submit" className="button button-small" disabled={busy}>
        Save score
      </button>
      {invalid && (
        <p id="score-error" role="alert" className="form-error">
          {invalid}
        </p>
      )}
    </form>
  )
}

const when = (iso: string, legacy: boolean) =>
  new Date(iso).toLocaleString('en-GB', {
    timeZone: 'Europe/Lisbon',
    dateStyle: 'medium',
    // Sheet notes have a date only; their time is made up.
    ...(legacy ? {} : { timeStyle: 'short' }),
  })

function Comments({
  film,
  byId,
  perms,
  me,
  run,
  busy,
  errorFor,
}: SectionProps & { film: FilmRecord }) {
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState<{ id: number; body: string } | null>(null)
  const focusLater = useFocusLater()

  const post = async (e: FormEvent) => {
    e.preventDefault()
    if (me && (await run('comments', () => filmWrites.addComment(film.id, me, draft.trim())))) {
      setDraft('')
    }
  }
  const stopEditing = (id: number) => {
    setEditing(null)
    focusLater(`edit-${id}-button`)
  }
  const saveEdit = async (e: FormEvent) => {
    e.preventDefault()
    if (
      editing &&
      (await run('comments', () => filmWrites.editComment(editing.id, editing.body.trim())))
    ) {
      stopEditing(editing.id)
    }
  }
  const remove = async (id: number) => {
    if (
      confirm('Delete this comment?') &&
      (await run('comments', () => filmWrites.deleteComment(id)))
    ) {
      focusLater('comments-heading')
    }
  }

  return (
    <section className="film-section">
      <h2 id="comments-heading" tabIndex={-1}>
        Comments
      </h2>
      {film.comments.length === 0 ? (
        <p className="muted">No comments yet.</p>
      ) : (
        <ul className="comments">
          {film.comments.map((c) => (
            <li key={c.id} className="comment">
              <p className="comment-meta">
                <Chip person={byId.get(c.author_id)} />{' '}
                <span className="muted">
                  {when(c.created_at, c.is_legacy)}
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
                    autoFocus
                    onChange={(e) => setEditing({ id: c.id, body: e.target.value })}
                  />
                  <div className="comment-actions">
                    <button
                      type="submit"
                      className="button button-small"
                      disabled={busy || !editing.body.trim()}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      className="button button-secondary button-small"
                      onClick={() => stopEditing(c.id)}
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
                        id={`edit-${c.id}-button`}
                        type="button"
                        className="button button-secondary button-small"
                        onClick={() => setEditing({ id: c.id, body: c.body })}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="button button-secondary button-small"
                        disabled={busy}
                        onClick={() => void remove(c.id)}
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
      )}
      {perms.canWrite && (
        <form onSubmit={post} className="comment-form">
          <label htmlFor="new-comment">Add a comment</label>
          <textarea
            id="new-comment"
            value={draft}
            maxLength={4000}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button type="submit" className="button button-small" disabled={busy || !draft.trim()}>
            Post
          </button>
        </form>
      )}
      {errorFor('comments')}
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
