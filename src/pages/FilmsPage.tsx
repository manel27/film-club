import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router'
import { useAuth } from '../auth/authContext'
import { Dot, FilmRow, PosterTile, ViewToggle } from '../components/FilmViews'
import NextUpCard from '../components/NextUp'
import { fetchFilmsData, type FilmsData } from '../films/api'
import {
  filterFilms,
  groupByWeek,
  isDateSort,
  KIND_LABELS,
  KINDS,
  readParams,
  sortFilms,
  SORTS,
  toParams,
  validFilters,
  type FilmItem,
  type FilmKind,
  type Filters,
  type PageState,
  type Person,
  type Sort,
} from '../films/films'

const STORAGE_KEY = 'film-club-films'

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

/**
 * The films page (#/): every film with filters, sorts and three views. Sorted by
 * screening date, the list and posters views group films by week; other sorts
 * show a flat list or the poster grid.
 */
export default function FilmsPage() {
  const { profile } = useAuth()
  const profileId = profile?.id
  const canScore = !!profile && profile.role !== 'viewer'
  const isStaff = profile?.role === 'admin' || profile?.role === 'moderator'
  const [data, setData] = useState<FilmsData | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  // E.g. "Deleted …" after deleting a film. Kept in state: restoring the saved view replaces the URL and its state.
  const { state: navState } = useLocation()
  const [notice] = useState((navState as { notice?: string } | null)?.notice)
  const noticeRef = useRef<HTMLParagraphElement>(null)
  useLayoutEffect(() => {
    if (!notice) return
    noticeRef.current?.focus()
    // Shown once: drop it from the history entry (React Router keeps it in
    // `usr`), so a reload or Back doesn't show it again.
    window.history.replaceState({ ...window.history.state, usr: null }, '')
  }, [notice])

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
  // not when the visitor's own change empties the URL). Only known keys and
  // values are restored.
  const [params, setParams] = useSearchParams()
  const search = params.toString()
  const ownChange = useRef(false)
  useEffect(() => {
    const saved = toParams(readParams(new URLSearchParams(readSaved()))).toString()
    if (!search && !ownChange.current && saved) setParams(saved, { replace: true })
    else save(search)
    ownChange.current = false
  }, [search, setParams])

  // Options come from the films themselves; values matching none are dropped.
  const options = data && {
    present: data.people.filter((p) => !p.isSystem).sort(byName),
    genres: unique(data.films.flatMap((f) => f.genres)),
    assigned: data.people.filter((p) => data.films.some((f) => f.assignedId === p.id)).sort(byName),
    years: unique(data.films.map((f) => f.screenedOn.slice(0, 4))).reverse(),
  }
  const state = readParams(params)
  if (options) {
    state.filters = validFilters(state.filters, {
      present: new Set(options.present.map((p) => p.id)),
      genres: new Set(options.genres),
      assigned: new Set(options.assigned.map((p) => p.id)),
      years: new Set(options.years),
      canScore,
    })
  }
  const { view, sort, filters } = state

  const change = (next: Partial<PageState>) => {
    const nextSearch = toParams({ ...state, ...next }).toString()
    if (nextSearch === search) return
    ownChange.current = true
    setParams(nextSearch, { replace: true })
  }
  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) =>
    change({ filters: { ...filters, [key]: value } })
  const clearFilters = () => change({ filters: readParams(new URLSearchParams()).filters })

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

  // ~300 films: cheap enough to recompute on every render.
  const people = new Map(data?.people.map((p) => [p.id, p]))
  const films = data ? sortFilms(filterFilms(data.films, filters, data.scored), sort) : []
  const count = films.length
  // Weeks only make sense when sorted by screening date; otherwise lists are flat.
  const byWeek = isDateSort(sort)
  // Posters by week falls back to the grid when there are no weeks.
  const shownView = view === 'posters' && !byWeek ? 'grid' : view
  // In poster views, the value sorted on (other than title and date) is shown on each tile.
  const note = (f: FilmItem) =>
    sort.startsWith('score') ? (
      <>
        <span className="sr-only">Average </span>
        {f.avgScore?.toFixed(2) ?? '–'}
      </>
    ) : sort.startsWith('year') ? (
      (f.releaseYear ?? '–')
    ) : undefined
  const { present, genre, assigned, kind, year, unscored } = filters
  const hasFilters = present.length > 0 || !!(genre || assigned || kind || year || unscored)
  const clearButton = (
    <button type="button" className="button button-secondary button-small" onClick={clearFilters}>
      Clear filters
    </button>
  )

  return (
    <main className="page films-page">
      <div className="films-head">
        <h1>Films</h1>
        {isStaff && (
          <Link to="/films/new" className="button button-small">
            Add film
          </Link>
        )}
        <ViewToggle
          views={['list', 'posters', 'grid']}
          value={shownView}
          onChange={(v) => change({ view: v })}
          off={(v) => (v === 'posters' && !byWeek ? 'only when sorted by screening date' : '')}
        />
      </div>
      {notice && (
        <p ref={noticeRef} role="status" className="form-notice" tabIndex={-1}>
          {notice}
        </p>
      )}
      {data && <NextUpCard people={data.people} />}

      {!data || !options ? (
        <p role="status" className="muted">
          Loading films…
        </p>
      ) : (
        <>
          <form className="film-filters" aria-label="Filters" onSubmit={(e) => e.preventDefault()}>
            <label className="field">
              Sort
              <select value={sort} onChange={(e) => change({ sort: e.target.value as Sort })}>
                {Object.entries(SORTS).map(([value, text]) => (
                  <option key={value} value={value}>
                    {text}
                  </option>
                ))}
              </select>
            </label>
            <PresentFilter
              people={options.present}
              selected={present}
              mode={filters.presentMode}
              onChange={(ids) => setFilter('present', ids)}
              onModeChange={(m) => setFilter('presentMode', m)}
            />
            <SelectFilter
              label="Genre"
              value={genre}
              onChange={(v) => setFilter('genre', v)}
              options={options.genres.map((g) => [g, g])}
            />
            <SelectFilter
              label="Chosen by"
              value={assigned}
              onChange={(v) => setFilter('assigned', v)}
              options={options.assigned.map((p) => [p.id, p.name])}
            />
            <SelectFilter
              label="Kind"
              value={kind}
              onChange={(v) => setFilter('kind', v as FilmKind | '')}
              options={KINDS.map((k) => [k, KIND_LABELS[k] ?? 'Normal'])}
            />
            <SelectFilter
              label="Year shown"
              value={year}
              onChange={(v) => setFilter('year', v)}
              options={options.years.map((y) => [y, y])}
            />
            {canScore && (
              <label className="check">
                <input
                  type="checkbox"
                  checked={unscored}
                  onChange={(e) => setFilter('unscored', e.target.checked)}
                />
                I haven't scored
              </label>
            )}
            {hasFilters && clearButton}
          </form>

          <p className="muted films-count" aria-live="polite">
            {count === 1 ? '1 film' : `${count} films`}
          </p>

          {count === 0 &&
            (data.films.length === 0 ? (
              <p>No films yet.</p>
            ) : (
              <div className="films-empty">
                <p>No films match these filters.</p>
                {clearButton}
              </div>
            ))}

          {shownView === 'grid'
            ? count > 0 && (
                <ul className="poster-grid poster-grid-flat">
                  {films.map((f) => (
                    <PosterTile key={f.id} film={f} note={note(f)} />
                  ))}
                </ul>
              )
            : !byWeek
              ? count > 0 && (
                  <ul className="film-list">
                    {films.map((f) => (
                      <FilmRow key={f.id} film={f} people={people} showDate />
                    ))}
                  </ul>
                )
              : groupByWeek(films).map((g) => (
                  <section key={g.weekStart} className="week">
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

const byName = (a: Person, b: Person) => a.name.localeCompare(b.name)

const unique = (values: string[]) => [...new Set(values)].sort((a, b) => a.localeCompare(b))

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
  const ref = useRef<HTMLDetailsElement>(null)
  // Layout effect: the listener must exist as soon as the filter is on screen. A passive
  // effect can still be pending then, so an early outside click was missed (flaky test).
  useLayoutEffect(() => {
    const close = (e: PointerEvent) => {
      if (ref.current?.open && !ref.current.contains(e.target as Node)) ref.current.open = false
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [])
  return (
    <details
      ref={ref}
      className="present-filter"
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || !ref.current?.open) return
        ref.current.open = false
        ref.current.querySelector('summary')?.focus()
      }}
    >
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
        {props.people.map((p) => (
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
