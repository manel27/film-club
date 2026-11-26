import { memo } from 'react'
import { Link } from 'react-router'
import { KIND_LABELS, ratingBand, screeningDay, type FilmItem, type Person } from '../films/films'
import { ymd } from '../rotation/rotation'
import { RoleChip } from './Chip'
import { tipsOff } from './tipsOff'

// Shared by the films page and profiles: a film as a list row or a poster tile, and the view toggle.

const POSTER_BASE = 'https://image.tmdb.org/t/p/w185'
const THUMB_BASE = 'https://image.tmdb.org/t/p/w92'

export type View = 'list' | 'posters' | 'grid'

// Inline icons (stroke = currentColor, so they follow the theme).
const VIEWS: Record<View, [string, React.ReactNode]> = {
  list: ['List', <path d="M4 6h.01M9 6h11M4 12h.01M9 12h11M4 18h.01M9 18h11" />],
  posters: [
    'Poster list',
    <>
      <rect x="3" y="3" width="5" height="7.5" rx="1" />
      <rect x="3" y="13.5" width="5" height="7.5" rx="1" />
      <path d="M12 6.5h9M12 17.5h9" />
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

/** Joined view buttons. */
export function ViewToggle(props: { views: View[]; value: View; onChange: (view: View) => void }) {
  return (
    <div className="view-toggle" role="group" aria-label="View">
      {props.views.map((v) => {
        const [name, icon] = VIEWS[v]
        return (
          <button
            key={v}
            type="button"
            className="button button-secondary button-small"
            aria-pressed={props.value === v}
            aria-label={name}
            title={name}
            onClick={() => props.onChange(v)}
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

/** A person's colour dot (decorative: the name is shown next to it). */
export function Dot({ person }: { person: Person | undefined }) {
  return (
    <span
      className="colour-dot"
      aria-hidden="true"
      style={person?.colour ? { backgroundColor: person.colour } : undefined}
    />
  )
}

/** An average with its band's emoji ("7.35 👌"), read as "average 7.35, good". The easter egg gets no emoji. */
export function Rating({ film }: { film: FilmItem }) {
  const band = film.avgScore == null || film.isEasterEgg ? null : ratingBand(film.avgScore)
  return (
    <span className="film-avg">
      <span aria-hidden="true">
        {film.avgScore?.toFixed(2) ?? '–'}
        {band && ` ${band.emoji}`}
      </span>
      <span className="sr-only">{ratingText(film)}</span>
    </span>
  )
}

function ratingText(film: FilmItem): string {
  if (film.avgScore == null) return 'No average'
  const avg = `average ${film.avgScore.toFixed(2)}`
  return film.isEasterEgg ? avg : `${avg}, ${ratingBand(film.avgScore).label}`
}

const byName = (a: Person | undefined, b: Person | undefined) =>
  (a?.name ?? '').localeCompare(b?.name ?? '')

/**
 * A film as one row: "Chooser · Title (Year) | 7.35 👌 | present names", with the
 * screening date and kind on a small line below. `poster` adds a thumbnail on the
 * left; `note` is shown after the kind badge (e.g. a profile's "scored, not present").
 * One Tab stop per film (its title): the name chips are mouse shortcuts. Memoised:
 * pass a stable `people` map so a re-sort only moves rows (only the title Link re-renders).
 */
export const FilmRow = memo(function FilmRow(props: {
  film: FilmItem
  people: Map<string, Person>
  /** useHref('/people'): see Chip. */
  peopleHref: string
  poster?: boolean
  note?: React.ReactNode
}) {
  const { film, people } = props
  const kind = KIND_LABELS[film.kind]
  return (
    <li className="film-row">
      {props.poster &&
        (film.posterPath ? (
          <img
            className="film-thumb"
            src={`${THUMB_BASE}${film.posterPath}`}
            alt=""
            loading="lazy"
            width={46}
            height={69}
          />
        ) : (
          <span className="film-thumb poster-placeholder" aria-hidden="true" />
        ))}
      <div className="film-row-body">
        <div className="film-row-main">
          <span className="film-title">
            <span className="sr-only">Chosen by </span>
            <RoleChip
              person={people.get(film.assignedId)}
              tabbable={false}
              peopleHref={props.peopleHref}
            />
            <span aria-hidden="true"> · </span>
            <Link to={`/films/${film.id}`}>{film.title}</Link>
            {film.releaseYear && <span className="muted"> ({film.releaseYear})</span>}
          </span>
          <Rating film={film} />
          {film.presentIds.length > 0 && (
            <span className="present-names" role="group" aria-label="Present">
              {film.presentIds
                .map((id) => people.get(id))
                .sort(byName)
                .map((p, i) => (
                  <RoleChip
                    key={p?.id ?? i}
                    person={p}
                    tabbable={false}
                    peopleHref={props.peopleHref}
                  />
                ))}
            </span>
          )}
        </div>
        <div className="muted film-meta">
          <span className="film-date">{ymd(film.screenedOn)}</span>
          {kind && <span className="badge">{kind}</span>}
          {props.note}
        </div>
      </div>
    </li>
  )
})

/**
 * A poster linking to the film. Its date, chooser and rating show as an overlay on
 * hover or focus, or under the poster on touch screens (CSS). They are inside the
 * link, so screen readers hear them as part of its name.
 */
export const PosterTile = memo(function PosterTile(props: {
  film: FilmItem
  people: Map<string, Person>
  note?: React.ReactNode
}) {
  const { film, note } = props
  const name = withYear(film)
  const chooser = props.people.get(film.assignedId)?.name ?? 'Unknown'
  return (
    <li className="poster">
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
        <span className="poster-details" aria-hidden="true">
          <span className="film-date">{ymd(film.screenedOn)}</span>
          <span>{chooser}</span>
          <Rating film={film} />
        </span>
        <span className="sr-only">{`, ${ymd(film.screenedOn)}, chosen by ${chooser}, ${ratingText(film)}`}</span>
      </Link>
      {note != null && <span className="muted poster-note">{note}</span>}
    </li>
  )
})

/** The film already added for the next screening; the whole card links to it. */
export function NextFilmCard(props: {
  film: FilmItem
  people: Map<string, Person>
  today: string
}) {
  const { film } = props
  const kind = KIND_LABELS[film.kind]
  return (
    <section ref={tipsOff} className="card next-film" aria-labelledby="next-film-heading">
      {film.posterPath ? (
        <img
          className="next-film-poster"
          src={`${POSTER_BASE}${film.posterPath}`}
          alt=""
          width={185}
          height={278}
        />
      ) : (
        <span className="next-film-poster poster-placeholder" aria-hidden="true">
          {film.title}
        </span>
      )}
      <div className="next-film-body">
        <h2 id="next-film-heading">Next film</h2>
        <p className="next-film-title">
          {/* Stretched over the whole card (CSS); the chooser's chip sits above it. */}
          <Link to={`/films/${film.id}`} className="card-link" aria-describedby="next-film-when">
            {film.title}
          </Link>
          {film.releaseYear && <span className="muted"> ({film.releaseYear})</span>}
        </p>
        <p id="next-film-when" className="muted film-meta">
          <span>{screeningDay(film.screenedOn, props.today)}</span>
          {/* Read as one description: "Sat 5 Dec 2026 Maratona". */}{' '}
          {kind && <span className="badge">{kind}</span>}
        </p>
        <p>
          Chosen by <RoleChip person={props.people.get(film.assignedId)} />
        </p>
      </div>
    </section>
  )
}
