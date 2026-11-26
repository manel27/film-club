import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useAuth } from '../auth/authContext'
import { fetchFilm, fetchPeopleList, findDuplicates, saveFilm, searchTmdb } from '../films/api'
import { permissions } from '../films/filmDetail'
import {
  alreadyWatched,
  chooserForKind,
  cinemaProfile,
  comingSaturday,
  functionErrorMessage,
  parseYear,
  REASON_MAX,
  screeningDateRange,
  toSaveBody,
  type FilmFormState,
  type TmdbResult,
} from '../films/filmForm'
import { KIND_LABELS, KINDS, type FilmKind, type Person } from '../films/films'

const SEARCH_DELAY_MS = 350

const byName = (a: Person, b: Person) => a.name.localeCompare(b.name)

/** Add film (#/films/new) and edit film (#/films/:id/edit). Staff only; the server checks too. */
export default function FilmFormPage() {
  const { id } = useParams()
  return <FilmForm key={id ?? 'new'} id={id} />
}

function FilmForm({ id }: { id: string | undefined }) {
  const filmId = id === undefined ? undefined : /^\d+$/.test(id) ? Number(id) : NaN
  const { profile } = useAuth()
  const isStaff = permissions(profile, false).isStaff
  const navigate = useNavigate()
  const back = filmId === undefined ? '/' : `/films/${id}`

  const [people, setPeople] = useState<Person[] | null>(null)
  const [form, setForm] = useState<FilmFormState | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    if (!isStaff || Number.isNaN(filmId)) return
    let current = true
    const load = async () => {
      const list = await fetchPeopleList()
      if (filmId === undefined) {
        return {
          list,
          state: {
            picked: null,
            manual: false,
            title: '',
            year: '',
            screenedOn: comingSaturday(),
            kind: 'normal' as FilmKind,
            assignedId: '',
            turnHolderId: '',
            reason: '',
          },
        }
      }
      const data = await fetchFilm(filmId, list)
      if (!data) return null
      const f = data.film
      return {
        list,
        state: {
          picked: f.tmdb_id
            ? {
                tmdb_id: f.tmdb_id,
                title: f.title,
                original_title: f.original_title,
                year: f.release_year,
              }
            : null,
          manual: !f.tmdb_id,
          title: f.title,
          year: f.release_year ? String(f.release_year) : '',
          screenedOn: f.screened_on,
          kind: f.kind,
          assignedId: f.assigned_id,
          turnHolderId: f.turn_holder_id ?? '',
          reason: f.democratico_reason ?? '',
        },
      }
    }
    load().then(
      (r) => {
        if (!current) return
        if (!r) return setMissing(true)
        setPeople(r.list)
        setForm(r.state)
      },
      () => current && setLoadFailed(true),
    )
    return () => {
      current = false
    }
  }, [isStaff, filmId])

  if (!isStaff) {
    return (
      <Shell back={back} title={filmId === undefined ? 'Add film' : 'Edit film'}>
        <p role="alert" className="form-error">
          Only moderators and admins can add or edit films.
        </p>
      </Shell>
    )
  }
  if (Number.isNaN(filmId) || missing) {
    return <Shell back="/" title="Film not found" />
  }
  if (loadFailed) {
    return (
      <Shell back={back} title="Edit film">
        <p role="alert" className="form-error">
          Couldn't load the form. Check your connection and reload.
        </p>
      </Shell>
    )
  }
  if (!people || !form) {
    return (
      <Shell back={back} title={filmId === undefined ? 'Add film' : 'Edit film'}>
        <p role="status" className="muted">
          Loading…
        </p>
      </Shell>
    )
  }
  return (
    <Shell back={back} title={filmId === undefined ? 'Add film' : 'Edit film'}>
      <Fields
        filmId={filmId}
        people={people}
        initial={form}
        onSaved={(saved) => navigate(`/films/${saved}`)}
      />
    </Shell>
  )
}

function Shell({
  back,
  title,
  children,
}: {
  back: string
  title: string
  children?: React.ReactNode
}) {
  return (
    <main className="page film-form-page">
      <Link to={back} className="back-link">
        ← Back
      </Link>
      <h1>{title}</h1>
      {children}
    </main>
  )
}

function Fields({
  filmId,
  people,
  initial,
  onSaved,
}: {
  filmId: number | undefined
  people: Person[]
  initial: FilmFormState
  onSaved: (id: number) => void
}) {
  const [s, setS] = useState(initial)
  const set = (patch: Partial<FilmFormState>) => setS((old) => ({ ...old, ...patch }))
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const [error, setError] = useState('')

  // Duplicate check (plan 4.3): the same rule the database applies on save.
  const candidate = s.manual
    ? s.title.trim() && parseYear(s.year)
      ? { title: s.title.trim(), year: parseYear(s.year), tmdbId: null, originalTitle: null }
      : null
    : s.picked && {
        title: s.picked.title,
        year: s.picked.year,
        tmdbId: s.picked.tmdb_id,
        originalTitle: s.picked.original_title,
      }
  const key = candidate && JSON.stringify(candidate)
  const [dupes, setDupes] = useState<{ key: string; films: DupeFilm[] } | null>(null)
  useEffect(() => {
    if (!key) return
    let current = true
    const timer = setTimeout(() => {
      findDuplicates(JSON.parse(key)).then(
        (films) => current && setDupes({ key, films: films.filter((f) => f.id !== filmId) }),
        // The database still refuses a duplicate on save.
        () => current && setDupes({ key, films: [] }),
      )
    }, SEARCH_DELAY_MS)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [key, filmId])
  const clashes = key && dupes?.key === key ? dupes.films : []

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (savingRef.current) return
    const result = toSaveBody(s, filmId)
    if ('error' in result) return setError(result.error)
    savingRef.current = true
    setSaving(true)
    setError('')
    try {
      onSaved(await saveFilm(result.body))
    } catch (err) {
      setError(functionErrorMessage(err))
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  const choosers = people.filter((p) => !p.isSystem).sort(byName)
  const cinema = cinemaProfile(people)

  return (
    <form className="form film-form" onSubmit={submit} noValidate>
      <fieldset className="film-form-film">
        <legend>Film</legend>
        {s.manual ? (
          <>
            <label className="field">
              Title
              <input
                value={s.title}
                maxLength={300}
                autoFocus
                onChange={(e) => set({ title: e.target.value })}
              />
            </label>
            <label className="field">
              Release year
              <input
                value={s.year}
                inputMode="numeric"
                maxLength={4}
                onChange={(e) => set({ year: e.target.value })}
              />
            </label>
            <p className="muted">Saved with no TMDB match: an admin can link it later.</p>
            <button
              type="button"
              className="button button-secondary button-small"
              onClick={() => set({ manual: false, picked: null })}
            >
              Search TMDB instead
            </button>
          </>
        ) : s.picked ? (
          <>
            <p>
              <strong>{s.picked.title}</strong>
              {s.picked.year && ` (${s.picked.year})`}
              {s.picked.original_title && s.picked.original_title !== s.picked.title && (
                <span className="muted"> · {s.picked.original_title}</span>
              )}
            </p>
            <button
              type="button"
              className="button button-secondary button-small"
              autoFocus
              onClick={() => set({ picked: null })}
            >
              Change film
            </button>
          </>
        ) : (
          <TmdbSearch
            onPick={(r) => set({ picked: r })}
            onManual={(query) => set({ manual: true, title: query })}
          />
        )}
      </fieldset>

      {clashes.length > 0 && (
        <p role="alert" className="form-error">
          {alreadyWatched(clashes[0].screened_on, clashes[0].kind)}:{' '}
          <Link to={`/films/${clashes[0].id}`}>{clashes[0].title}</Link>
        </p>
      )}

      <label className="field">
        Screening date
        <input
          type="date"
          required
          {...screeningDateRange()}
          value={s.screenedOn}
          onChange={(e) => set({ screenedOn: e.target.value })}
        />
      </label>
      <label className="field">
        Kind
        <select
          value={s.kind}
          onChange={(e) => {
            const kind = e.target.value as FilmKind
            set({ kind, assignedId: chooserForKind(s.assignedId, s.kind, kind, people) })
          }}
        >
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k] ?? 'Normal'}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Chosen by
        <select required value={s.assignedId} onChange={(e) => set({ assignedId: e.target.value })}>
          <option value="">Choose…</option>
          {cinema && <option value={cinema.id}>Cinema (no proposer)</option>}
          {choosers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      {s.kind === 'democratico' && (
        <label className="field">
          Whose turn it was (missed it)
          <select
            required={filmId === undefined}
            value={s.turnHolderId}
            onChange={(e) => set({ turnHolderId: e.target.value })}
          >
            <option value="">{filmId === undefined ? 'Choose…' : 'Not recorded'}</option>
            {choosers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {s.kind === 'democratico' && (
        <label className="field">
          Why was it chosen? (optional, up to {REASON_MAX} characters)
          <input
            value={s.reason}
            maxLength={REASON_MAX}
            onChange={(e) => set({ reason: e.target.value })}
          />
        </label>
      )}

      {/* A refused duplicate is already shown by the warning above: one alert, not two. */}
      {error && clashes.length === 0 && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <div className="actions">
        <button type="submit" className="button" disabled={saving || clashes.length > 0}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  )
}

type DupeFilm = Awaited<ReturnType<typeof findDuplicates>>[number]

/** TMDB search-as-you-type. Films already watched are shown but can't be picked. */
function TmdbSearch({
  onPick,
  onManual,
}: {
  onPick: (r: TmdbResult) => void
  onManual: (query: string) => void
}) {
  const [query, setQuery] = useState('')
  const q = query.trim()
  const [found, setFound] = useState<{ q: string; results: TmdbResult[] | null; error: string }>()

  useEffect(() => {
    if (q.length < 2) return
    let current = true
    const timer = setTimeout(() => {
      searchTmdb(q).then(
        (results) => current && setFound({ q, results, error: '' }),
        (e) => current && setFound({ q, results: null, error: functionErrorMessage(e) }),
      )
    }, SEARCH_DELAY_MS)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [q])

  const shown = q.length >= 2 && found?.q === q ? found : undefined
  return (
    <>
      <label className="field">
        Search TMDB
        <input
          type="search"
          value={query}
          autoFocus
          autoComplete="off"
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <p role="status" className="muted">
        {q.length >= 2 && !shown
          ? 'Searching…'
          : shown?.results?.length === 0
            ? 'No matches on TMDB.'
            : shown?.results
              ? `${shown.results.length} ${shown.results.length === 1 ? 'match' : 'matches'} on TMDB.`
              : ''}
      </p>
      {shown?.error && (
        <p role="alert" className="form-error">
          {shown.error}
        </p>
      )}
      {shown?.results && shown.results.length > 0 && (
        <ul className="tmdb-results" aria-label="TMDB results">
          {shown.results.map((r) => (
            <li key={r.tmdb_id}>
              <button
                type="button"
                className="tmdb-result"
                // aria-disabled, not disabled: still reachable by keyboard, so the
                // "Already watched" text can be read, but it can't be picked.
                aria-disabled={r.watched ? true : undefined}
                onClick={() => !r.watched && onPick(r)}
              >
                {r.poster_path ? (
                  <img src={`https://image.tmdb.org/t/p/w92${r.poster_path}`} alt="" width={46} />
                ) : (
                  <span className="tmdb-no-poster" />
                )}
                <span>
                  <strong>{r.title}</strong>
                  {r.year && ` (${r.year})`}
                  {r.original_title && r.original_title !== r.title && (
                    <span className="muted"> · {r.original_title}</span>
                  )}
                  {r.directors.length > 0 && (
                    <span className="muted tmdb-directors">{r.directors.join(', ')}</span>
                  )}
                  {r.watched && (
                    <span className="tmdb-watched">
                      {alreadyWatched(r.watched.screened_on, r.watched.kind)}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        className="button button-secondary button-small"
        onClick={() => onManual(q)}
      >
        Not on TMDB? Save without TMDB
      </button>
    </>
  )
}
