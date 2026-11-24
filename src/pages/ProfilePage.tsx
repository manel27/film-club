import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { useAuth } from '../auth/authContext'
import { FilmRow, PosterTile, ViewToggle } from '../components/FilmViews'
import { fetchProfileData, renameProfile, type ProfileData } from '../films/api'
import { sortFilms, type FilmItem, type Person } from '../films/films'
import { textOn } from '../lib/colour'
import { parseName, profileStats, profileTabs, renameError, ROLE_NAMES } from '../people/profile'
import { lisbonDate } from '../rotation/rotation'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const TABS = [
  ['watched', 'Watched'],
  ['not-watched', 'Not watched'],
] as const
type Tab = (typeof TABS)[number][0]

const avg = (n: number | null) => (n == null ? '–' : n.toFixed(2))

/** A person's page (#/people/:id). Keyed by id, so nothing carries over between people. */
export default function ProfilePage() {
  const { id = '' } = useParams()
  return <Profile key={id} id={id} />
}

function NotFound() {
  return (
    <main className="page">
      <h1>Person not found</h1>
      <p>
        <Link to="/people">← All people</Link>
      </p>
    </main>
  )
}

function Profile({ id }: { id: string }) {
  const valid = UUID.test(id)
  const { profile: me } = useAuth()
  const [data, setData] = useState<ProfileData | undefined>(undefined)
  const [failed, setFailed] = useState(false)
  // Tab and view live in the URL, so Back from a film returns to them.
  const [params, setParams] = useSearchParams()
  const tab: Tab = params.get('tab') === 'not-watched' ? 'not-watched' : 'watched'
  const view = params.get('view') === 'grid' ? 'grid' : 'list'
  const set = (key: string, value: string, fallback: string) => {
    const next = new URLSearchParams(params)
    if (value === fallback) next.delete(key)
    else next.set(key, value)
    setParams(next, { replace: true })
  }

  // Only the first load can fail the page; a failed reload keeps what is shown.
  const load = useCallback(
    () =>
      fetchProfileData(id).then(
        (d) => {
          setData(d)
          setFailed(false)
        },
        () => setFailed(true),
      ),
    [id],
  )
  useEffect(() => {
    if (valid) void load()
  }, [load, valid])

  const person = data?.people.find((p) => p.id === id)
  // System profiles (Cinema, Sheet archive) aren't people: no profile page.
  if (!valid || (data && (!person || person.isSystem))) return <NotFound />
  if (!data || !person) {
    return (
      <main className="page">
        {failed ? (
          <>
            <p role="alert" className="form-error">
              Couldn't load this profile. Check your connection.
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
            Loading profile…
          </p>
        )}
      </main>
    )
  }

  const stats = profileStats(id, data.films, data.scores, data.commentFilmIds)
  const people = new Map(data.people.map((p) => [p.id, p]))
  // ~330 films: cheap enough to recompute on every render.
  const lists: Record<Tab, FilmItem[]> = profileTabs(
    id,
    sortFilms(data.films, 'newest'),
    lisbonDate(),
  )
  const shown = lists[tab]
  // Only on "Not watched": scoring without attendance is allowed (plan 4.2).
  const marker = (f: FilmItem) =>
    tab === 'not-watched' && data.scores.has(f.id) ? 'Scored, not present' : undefined
  const style = person.colour
    ? { backgroundColor: person.colour, color: textOn(person.colour) }
    : undefined
  const canRename = me?.id === id && me.role !== 'viewer'

  // ARIA tabs keyboard: arrows move (and wrap), Home and End jump to the first and last tab.
  const onTabKey = (e: KeyboardEvent) => {
    const i = TABS.findIndex(([t]) => t === tab)
    const to = { ArrowLeft: i - 1, ArrowRight: i + 1, Home: 0, End: TABS.length - 1 }[e.key]
    if (to === undefined) return
    e.preventDefault()
    const [next] = TABS[(to + TABS.length) % TABS.length]
    set('tab', next, 'watched')
    document.getElementById(`tab-${next}`)?.focus()
  }

  return (
    <main className="page profile-page">
      <Link to="/people" className="back-link">
        ← All people
      </Link>
      <h1>
        <span className="chip profile-chip" style={style}>
          {person.name}
        </span>
      </h1>
      {person.role && <span className="badge">{ROLE_NAMES[person.role]}</span>}
      {canRename && <RenameForm id={id} name={person.name} people={data.people} reload={load} />}

      <dl className="film-facts profile-stats">
        <dt>Films watched</dt>
        <dd>{stats.watched}</dd>
        <dt>Films chosen</dt>
        <dd>{stats.chosen}</dd>
        <dt>Average of the films they chose</dt>
        <dd>{avg(stats.avgChosen)}</dd>
        <dt>Scores given</dt>
        <dd>{stats.scores}</dd>
        <dt>Average score given</dt>
        <dd>{avg(stats.avgGiven)}</dd>
        <dt>Comments</dt>
        <dd>{stats.comments}</dd>
      </dl>
      <p className="muted">Attendance before 2023 may be incomplete.</p>

      <div className="films-head">
        <div role="tablist" aria-label="Films" className="tabs">
          {TABS.map(([t, label]) => (
            <button
              key={t}
              id={`tab-${t}`}
              type="button"
              role="tab"
              aria-selected={tab === t}
              aria-controls="profile-films"
              tabIndex={tab === t ? 0 : -1}
              className="tab"
              onClick={() => set('tab', t, 'watched')}
              onKeyDown={onTabKey}
            >
              {label} ({lists[t].length})
            </button>
          ))}
        </div>
        <ViewToggle
          views={['list', 'grid']}
          value={view}
          onChange={(v) => set('view', v, 'list')}
        />
      </div>
      <div id="profile-films" role="tabpanel" aria-labelledby={`tab-${tab}`} tabIndex={0}>
        {shown.length === 0 ? (
          <p className="muted">No films here.</p>
        ) : view === 'list' ? (
          <ul className="film-list">
            {shown.map((f) => {
              const m = marker(f)
              return (
                <FilmRow
                  key={f.id}
                  film={f}
                  people={people}
                  showDate
                  note={m && <span className="badge">{m}</span>}
                />
              )
            })}
          </ul>
        ) : (
          <ul className="poster-grid poster-grid-flat">
            {shown.map((f) => (
              <PosterTile key={f.id} film={f} note={marker(f)} />
            ))}
          </ul>
        )}
      </div>
    </main>
  )
}

/** "Edit name" on your own profile. RLS and the profiles trigger are the real guards. */
function RenameForm(props: {
  id: string
  name: string
  people: Person[]
  reload: () => Promise<void>
}) {
  const { refreshProfile } = useAuth()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const editButton = useRef<HTMLButtonElement>(null)
  const noticeRef = useRef<HTMLParagraphElement>(null)
  // After the form closes, focus goes to the notice (saved) or back to the button (cancelled).
  const focusNext = useRef<'notice' | 'button' | null>(null)
  useLayoutEffect(() => {
    if (editing) return
    if (focusNext.current === 'notice') noticeRef.current?.focus()
    if (focusNext.current === 'button') editButton.current?.focus()
    focusNext.current = null
  }, [editing])

  const close = (to: 'notice' | 'button') => {
    focusNext.current = to
    setEditing(false)
    setError('')
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busyRef.current) return
    const parsed = parseName(value, props.people, props.id)
    if ('error' in parsed) return setError(parsed.error)
    busyRef.current = true
    setBusy(true)
    setError('')
    try {
      // Sent even when it matches the name shown: that copy may be stale (renamed in another tab).
      await renameProfile(props.id, parsed.name)
      // The header shows the name too.
      await Promise.all([refreshProfile(), props.reload()])
      setNotice('Name saved.')
      close('notice')
    } catch (err) {
      setError(renameError(err))
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  return (
    <div className="rename">
      <p ref={noticeRef} role="status" tabIndex={-1} className={notice ? 'form-notice' : 'sr-only'}>
        {notice}
      </p>
      {editing ? (
        <form className="rename-form" onSubmit={submit} noValidate>
          <label className="field">
            Display name
            <input
              type="text"
              autoComplete="nickname"
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              aria-invalid={!!error}
              aria-describedby={error ? 'name-error' : undefined}
            />
          </label>
          <div className="actions">
            <button type="submit" className="button button-small" disabled={busy}>
              {busy ? 'Saving…' : 'Save name'}
            </button>
            <button
              type="button"
              className="button button-secondary button-small"
              disabled={busy}
              onClick={() => close('button')}
            >
              Cancel
            </button>
          </div>
          {error && (
            <p id="name-error" role="alert" className="form-error">
              {error}
            </p>
          )}
        </form>
      ) : (
        <button
          ref={editButton}
          type="button"
          className="button button-secondary button-small"
          onClick={() => {
            setValue(props.name)
            setNotice('')
            setEditing(true)
          }}
        >
          Edit name
        </button>
      )}
    </div>
  )
}
