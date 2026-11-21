import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useAuth } from '../auth/authContext'
import { fetchFilmsData, type FilmsData } from '../films/api'
import {
  filterFilms,
  groupByWeek,
  KIND_LABELS,
  readParams,
  type FilmItem,
  type FilmKind,
  type Person,
} from '../films/films'

const STORAGE_KEY = 'film-club-films'
const POSTER_BASE = 'https://image.tmdb.org/t/p/w185'

function readSaved(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? ''
  } catch {
    return ''
  }
}

function save(value: string) {
  try {
    localStorage.setItem(STORAGE_KEY, value)
  } catch {
    // Private mode etc.: the URL still holds the state.
  }
}

/** The films page (#/): every film, grouped by week, with filters and two views. */
export default function FilmsPage() {
  const { profile } = useAuth()
  const profileId = profile?.id
  const [data, setData] = useState<FilmsData | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!profileId) return
    let current = true
    fetchFilmsData(profileId).then(
      (d) => current && setData(d),
      () => current && setFailed(true),
    )
    return () => {
      current = false
    }
  }, [profileId, attempt])

  // View, sort and filters live in the URL; the last choice is also kept in
  // localStorage and restored whenever the page is reached without one (but
  // not when the visitor's own change empties the URL).
  const [params, setParams] = useSearchParams()
  const search = params.toString()
  const { view, sort, filters } = readParams(params)
  const ownChange = useRef(false)
  useEffect(() => {
    const saved = readSaved()
    if (!search && !ownChange.current && saved) {
      setParams(new URLSearchParams(saved), { replace: true })
    } else save(search)
    ownChange.current = false
  }, [search, setParams])

  const setOwnParams = (next: (prev: URLSearchParams) => URLSearchParams) => {
    ownChange.current = true
    setParams(next, { replace: true })
  }
  const update = (key: string, value: string) =>
    setOwnParams((prev) => {
      const next = new URLSearchParams(prev)
      if (value) next.set(key, value)
      else next.delete(key)
      return next
    })
  const clearFilters = () =>
    setOwnParams(() => new URLSearchParams(view === 'posters' ? { view } : {}))

  // ~300 films: cheap enough to recompute on every render.
  const people = new Map(data?.people.map((p) => [p.id, p]))
  const groups = data ? groupByWeek(filterFilms(data.films, filters, data.scored), sort) : []

  if (failed) {
    return (
      <main className="page">
        <h1>Films</h1>
        <p role="alert" className="form-error">
          Couldn't load the films. Check your connection.
        </p>
        <button
          type="button"
          className="button"
          onClick={() => {
            setFailed(false)
            setAttempt((n) => n + 1)
          }}
        >
          Try again
        </button>
      </main>
    )
  }

  const count = groups.reduce((n, g) => n + g.films.length, 0)
  const canScore = profile?.role !== 'viewer'
  const { present, genre, assigned, kind, year, unscored } = filters
  const hasFilters = present.length > 0 || !!(genre || assigned || kind || year || unscored)

  return (
    <main className="page films-page">
      <div className="films-head">
        <h1>Films</h1>
        <div className="view-toggle" role="group" aria-label="View">
          {(['list', 'posters'] as const).map((v) => (
            <button
              key={v}
              type="button"
              className="button button-secondary button-small"
              aria-pressed={view === v}
              onClick={() => update('view', v === 'list' ? '' : v)}
            >
              {v === 'list' ? 'List' : 'Posters'}
            </button>
          ))}
        </div>
      </div>

      {!data ? (
        <p role="status" className="muted">
          Loading films…
        </p>
      ) : (
        <>
          <form className="film-filters" aria-label="Filters" onSubmit={(e) => e.preventDefault()}>
            <label className="field">
              Sort
              <select
                value={sort}
                onChange={(e) => update('sort', e.target.value === 'oldest' ? 'oldest' : '')}
              >
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
              </select>
            </label>
            <PresentFilter
              people={data.people.filter((p) => !p.isSystem)}
              selected={filters.present}
              mode={filters.presentMode}
              onChange={(ids) => update('present', ids.join(','))}
              onModeChange={(m) => update('presentMode', m === 'all' ? m : '')}
            />
            <SelectFilter
              label="Genre"
              value={filters.genre}
              onChange={(v) => update('genre', v)}
              options={unique(data.films.flatMap((f) => f.genres)).map((g) => [g, g])}
            />
            <SelectFilter
              label="Chosen by"
              value={filters.assigned}
              onChange={(v) => update('assigned', v)}
              options={data.people
                .filter((p) => data.films.some((f) => f.assignedId === p.id))
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((p) => [p.id, p.name])}
            />
            <SelectFilter
              label="Kind"
              value={filters.kind}
              onChange={(v) => update('kind', v)}
              options={(Object.keys(KIND_LABELS) as FilmKind[]).map((k) => [
                k,
                KIND_LABELS[k] ?? 'Normal',
              ])}
            />
            <SelectFilter
              label="Year shown"
              value={filters.year}
              onChange={(v) => update('year', v)}
              options={unique(data.films.map((f) => f.screenedOn.slice(0, 4)))
                .reverse()
                .map((y) => [y, y])}
            />
            {canScore && (
              <label className="check">
                <input
                  type="checkbox"
                  checked={filters.unscored}
                  onChange={(e) => update('unscored', e.target.checked ? '1' : '')}
                />
                I haven't scored
              </label>
            )}
            {hasFilters && (
              <button
                type="button"
                className="button button-secondary button-small"
                onClick={clearFilters}
              >
                Clear filters
              </button>
            )}
          </form>

          <p className="muted films-count" aria-live="polite">
            {count === 1 ? '1 film' : `${count} films`}
          </p>

          {groups.map((g) => (
            <section key={g.weekStart} className="week" aria-label={g.heading}>
              <h2>{g.heading}</h2>
              {view === 'list' ? (
                <ul className="film-list">
                  {g.films.map((f) => (
                    <FilmRow key={f.id} film={f} people={people} />
                  ))}
                </ul>
              ) : (
                <ul className="poster-grid">
                  {g.films.map((f) => (
                    <PosterTile key={f.id} film={f} />
                  ))}
                </ul>
              )}
            </section>
          ))}
        </>
      )}
    </main>
  )
}

const unique = (values: string[]) => [...new Set(values)].sort((a, b) => a.localeCompare(b))

const withYear = (f: FilmItem) => (f.releaseYear ? `${f.title} (${f.releaseYear})` : f.title)

/** A person's colour dot; without a label it is decorative. */
function Dot({ person, label }: { person: Person | undefined; label?: string }) {
  return (
    <span
      className="colour-dot"
      {...(label ? { role: 'img', 'aria-label': label, title: label } : { 'aria-hidden': true })}
      style={person?.colour ? { backgroundColor: person.colour } : undefined}
    />
  )
}

function FilmRow({ film, people }: { film: FilmItem; people: Map<string, Person> }) {
  const assigned = people.get(film.assignedId)
  const kind = KIND_LABELS[film.kind]
  return (
    <li className="film-row">
      <span className="film-title">
        <Dot person={assigned} label={`Chosen by ${assigned?.name ?? 'unknown'}`} /> {film.title}
        {film.releaseYear && <span className="muted"> ({film.releaseYear})</span>}
      </span>
      {kind && <span className="badge">{kind}</span>}
      <span
        className="film-avg"
        aria-label={film.avgScore == null ? 'No average' : `Average ${film.avgScore.toFixed(2)}`}
      >
        {film.avgScore == null ? '–' : film.avgScore.toFixed(2)}
      </span>
      {film.presentIds.length > 0 && (
        <span className="present-dots" role="group" aria-label="Present">
          {film.presentIds
            .map((id) => people.get(id))
            .sort((a, b) => (a?.name ?? '').localeCompare(b?.name ?? ''))
            .map((p, i) => (
              <Dot key={p?.id ?? i} person={p} label={p?.name ?? 'Unknown'} />
            ))}
        </span>
      )}
    </li>
  )
}

function PosterTile({ film }: { film: FilmItem }) {
  const name = withYear(film)
  return (
    <li className="poster" title={name}>
      {film.posterPath ? (
        <img
          src={`${POSTER_BASE}${film.posterPath}`}
          alt={name}
          loading="lazy"
          width={185}
          height={278}
        />
      ) : (
        <div className="poster-placeholder" role="img" aria-label={name}>
          <span>{film.title}</span>
          {film.releaseYear && <span className="muted">{film.releaseYear}</span>}
        </div>
      )}
    </li>
  )
}

function SelectFilter(props: {
  label: string
  value: string
  onChange: (value: string) => void
  options: [string, string][]
}) {
  return (
    <label className="field">
      {props.label}
      <select value={props.value} onChange={(e) => props.onChange(e.target.value)}>
        <option value="">Any</option>
        {props.options.map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </select>
    </label>
  )
}

function PresentFilter(props: {
  people: Person[]
  selected: string[]
  mode: 'any' | 'all'
  onChange: (ids: string[]) => void
  onModeChange: (mode: 'any' | 'all') => void
}) {
  const sorted = [...props.people].sort((a, b) => a.name.localeCompare(b.name))
  return (
    <details className="present-filter">
      <summary>Present{props.selected.length > 0 && ` (${props.selected.length})`}</summary>
      <fieldset>
        <legend>Present at the screening</legend>
        <div className="present-mode">
          {(['any', 'all'] as const).map((m) => (
            <label key={m} className="check">
              <input
                type="radio"
                name="presentMode"
                checked={props.mode === m}
                onChange={() => props.onModeChange(m)}
              />
              {m === 'any' ? 'Any of them' : 'All of them'}
            </label>
          ))}
        </div>
        {sorted.map((p) => (
          <label key={p.id} className="check">
            <input
              type="checkbox"
              checked={props.selected.includes(p.id)}
              onChange={(e) =>
                props.onChange(
                  e.target.checked
                    ? [...props.selected, p.id]
                    : props.selected.filter((id) => id !== p.id),
                )
              }
            />
            <Dot person={p} />
            {p.name}
          </label>
        ))}
      </fieldset>
    </details>
  )
}
