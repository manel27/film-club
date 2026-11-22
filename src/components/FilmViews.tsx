import { Link } from 'react-router'
import { KIND_LABELS, weekHeading, type FilmItem, type Person } from '../films/films'

// Shared by the films page and profiles: a film as a list row or a poster tile, and the view toggle.

const POSTER_BASE = 'https://image.tmdb.org/t/p/w185'

export type View = 'list' | 'posters' | 'grid'

// Inline icons (stroke = currentColor, so they follow the theme).
const VIEWS: Record<View, [string, React.ReactNode]> = {
  list: ['List', <path d="M4 6h.01M9 6h11M4 12h.01M9 12h11M4 18h.01M9 18h11" />],
  posters: [
    'Posters by week',
    <>
      <path d="M3 4h18" />
      <rect x="3" y="9" width="7.5" height="12" rx="1.5" />
      <rect x="13.5" y="9" width="7.5" height="12" rx="1.5" />
    </>,
  ],
  grid: [
    'Poster grid',
    <>
      <rect x="3" y="3" width="7.5" height="7.5" rx="2.5" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="2.5" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="2.5" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2.5" />
    </>,
  ],
}

/** Joined view buttons. `off(view)` gives the reason a view can't be picked now, if any. */
export function ViewToggle(props: {
  views: View[]
  value: View
  onChange: (view: View) => void
  off?: (view: View) => string
}) {
  return (
    <div className="view-toggle" role="group" aria-label="View">
      {props.views.map((v) => {
        const [name, icon] = VIEWS[v]
        const off = props.off?.(v)
        return (
          <button
            key={v}
            type="button"
            className="button button-secondary button-small"
            aria-pressed={props.value === v}
            aria-disabled={off ? true : undefined}
            aria-label={name}
            title={off ? `${name}: ${off}` : name}
            onClick={() => !off && props.onChange(v)}
          >
            <svg
              viewBox="0 0 24 24"
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              aria-hidden="true"
            >
              {icon}
            </svg>
          </button>
        )
      })}
    </div>
  )
}

const withYear = (f: FilmItem) => (f.releaseYear ? `${f.title} (${f.releaseYear})` : f.title)

/** A person's colour dot; without a label it is decorative. */
export function Dot({ person, label }: { person: Person | undefined; label?: string }) {
  return (
    <span
      className="colour-dot"
      {...(label ? { role: 'img', 'aria-label': label, title: label } : { 'aria-hidden': true })}
      style={person?.colour ? { backgroundColor: person.colour } : undefined}
    />
  )
}

/** `note` is shown after the kind badge (e.g. a profile's "scored, not present"). */
export function FilmRow(props: {
  film: FilmItem
  people: Map<string, Person>
  showDate?: boolean
  note?: React.ReactNode
}) {
  const { film, people } = props
  const assigned = people.get(film.assignedId)
  const kind = KIND_LABELS[film.kind]
  const chosenBy = <Dot person={assigned} label={`Chosen by ${assigned?.name ?? 'unknown'}`} />
  return (
    <li className="film-row">
      {props.showDate && <span className="muted film-date">{weekHeading([film.screenedOn])}</span>}
      <span className="film-title">
        {assigned && !assigned.isSystem ? (
          <Link to={`/people/${assigned.id}`} className="dot-link">
            {chosenBy}
          </Link>
        ) : (
          chosenBy
        )}{' '}
        <Link to={`/films/${film.id}`}>{film.title}</Link>
        {film.releaseYear && <span className="muted"> ({film.releaseYear})</span>}
      </span>
      {kind && <span className="badge">{kind}</span>}
      {props.note}
      {film.avgScore == null ? (
        <span className="film-avg">
          <span aria-hidden="true">–</span>
          <span className="sr-only">No average</span>
        </span>
      ) : (
        <span className="film-avg">
          <span className="sr-only">Average </span>
          {film.avgScore.toFixed(2)}
        </span>
      )}
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

export function PosterTile({ film, note }: { film: FilmItem; note?: React.ReactNode }) {
  const name = withYear(film)
  return (
    <li className="poster" title={name}>
      <Link to={`/films/${film.id}`}>
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
      </Link>
      {note != null && <span className="muted poster-note">{note}</span>}
    </li>
  )
}
