import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'
import { RoleChip } from '../components/Chip'
import { Rating } from '../components/FilmViews'
import Scroll from '../components/Scroll'
import { tipsOff } from '../components/tipsOff'
import { fetchPeopleList } from '../films/api'
import { screeningDay, type Person } from '../films/films'
import { lisbonDate } from '../rotation/rotation'
import { fetchStatsData } from '../stats/api'
import { CountChart, OverTimeChart } from '../stats/StatsCharts'
import {
  chartGenres,
  computeStats,
  DIRECTOR_ROWS,
  MIN,
  parseStatsData,
  readYear,
  statsYears,
  type FilmStat,
  type Group,
  type Pair,
  type StatsData,
} from '../stats/stats'

const Avg = ({ value }: { value: number | null }) => (
  <Rating film={{ avgScore: value, isEasterEgg: false }} />
)

const FilmLink = ({ s }: { s: FilmStat }) => (
  <Link to={`/films/${s.film.id}`}>
    {s.film.releaseYear ? `${s.film.title} (${s.film.releaseYear})` : s.film.title}
  </Link>
)

/** A ranking or breakdown: a captioned table (first cell a row header) and the rule it follows. */
function Table(props: { caption: string; note?: string; head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="stats-block">
      <Scroll label={props.caption}>
        <table className="rotation-table">
          <caption>{props.caption}</caption>
          <thead>
            <tr>
              {props.head.map((h) => (
                <th key={h} scope="col">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {props.rows.length === 0 ? (
              <tr>
                <td colSpan={props.head.length} className="muted">
                  None in this period.
                </td>
              </tr>
            ) : (
              props.rows.map(([first, ...rest], i) => (
                <tr key={i}>
                  <th scope="row">{first}</th>
                  {rest.map((cell, j) => (
                    <td key={j}>{cell}</td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Scroll>
      {props.note && <p className="muted stats-note">{props.note}</p>}
    </div>
  )
}

const groupRows = (groups: Group[]) =>
  groups.map((g) => [g.label ?? 'Unknown', g.count, <Avg key="avg" value={g.avg} />])

const pairRows = (pairs: Pair[]) =>
  pairs.map((p) => [
    <span key="names" className="stats-pair">
      <RoleChip person={p.a} /> <RoleChip person={p.b} />
    </span>,
    p.diff.toFixed(2),
    p.shared,
  ])

/**
 * Stats (#/stats, PLAN 10.2): club numbers for all time or one year. One load
 * (stats_data() and the people); the year filter (?year=) works on it in the
 * browser, so changing it sends no request that could arrive late.
 */
export default function StatsPage() {
  const [loaded, setLoaded] = useState<{ data: StatsData; people: Person[] } | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const heading = useRef<HTMLHeadingElement>(null)
  const [params, setParams] = useSearchParams()

  useEffect(() => {
    let current = true
    Promise.all([fetchStatsData(), fetchPeopleList()]).then(
      ([raw, people]) => current && setLoaded({ data: parseStatsData(raw, lisbonDate()), people }),
      () => current && setFailed(true),
    )
    return () => {
      current = false
    }
  }, [attempt])

  const years = useMemo(() => (loaded ? statsYears(loaded.data) : []), [loaded])
  const year = readYear(params.get('year'), years)
  const stats = useMemo(
    () => loaded && computeStats(loaded.data, loaded.people, year),
    [loaded, year],
  )

  let body: ReactNode
  if (failed) {
    body = (
      <>
        <p role="alert" className="form-error">
          Couldn't load the stats. Check your connection.
        </p>
        <button
          type="button"
          className="button"
          onClick={() => {
            setFailed(false)
            setAttempt((n) => n + 1)
            heading.current?.focus() // the button goes away
          }}
        >
          Try again
        </button>
      </>
    )
  } else if (!stats) {
    body = (
      <p role="status" className="muted">
        Loading stats…
      </p>
    )
  } else {
    const o = stats.overview
    const today = lisbonDate()
    const period = year || 'all time'
    body = (
      <>
        <label className="field support-filter">
          Period
          <select
            value={year}
            onChange={(e) =>
              setParams(e.target.value ? { year: e.target.value } : {}, { replace: true })
            }
          >
            <option value="">All time</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        <p role="status" className="sr-only">
          {`Showing ${period}: ${o.films} ${o.films === 1 ? 'film' : 'films'} screened.`}
        </p>
        {o.films === 0 ? (
          <p className="muted">{year ? `No screenings in ${year}.` : 'No screenings yet.'}</p>
        ) : (
          <>
            <section className="film-section" aria-labelledby="stats-overview">
              <h2 id="stats-overview">Club overview</h2>
              <dl className="film-facts">
                <dt>Films screened</dt>
                <dd>{o.films}</dd>
                <dt>Scores given</dt>
                <dd>{o.scores}</dd>
                <dt>Club average</dt>
                <dd>
                  <Avg value={o.clubAvg} />
                </dd>
                <dt>Average attendance</dt>
                <dd>{o.avgAttendance?.toFixed(2) ?? '–'}</dd>
                {o.kinds.map((k) => (
                  <Fragment key={k.kind}>
                    <dt>{k.label}</dt>
                    <dd>{k.count}</dd>
                  </Fragment>
                ))}
                <dt>First screening</dt>
                <dd>{o.first && screeningDay(o.first, today)}</dd>
                <dt>Last screening</dt>
                <dd>{o.last && screeningDay(o.last, today)}</dd>
              </dl>
              <p className="muted">
                Averages leave out films with no scores; attendance is per screening.
              </p>
            </section>

            <section className="film-section" aria-labelledby="stats-over-time">
              <h2 id="stats-over-time">Over time</h2>
              <OverTimeChart periods={stats.overTime} />
              <Table
                caption={year ? `By month in ${year}` : 'By year'}
                note="Average leaves out films with no scores; attendance is per screening"
                head={[year ? 'Month' : 'Year', 'Films', 'Average', 'Attendance']}
                rows={stats.overTime.map((p) => [
                  p.label,
                  p.films,
                  <Avg key="a" value={p.avg} />,
                  p.attendance.toFixed(2),
                ])}
              />
            </section>

            <section className="film-section" aria-labelledby="stats-films">
              <h2 id="stats-films">Films</h2>
              <Table
                caption="Highest average"
                note={`Films with at least ${MIN.filmScores} scores`}
                head={['Film', 'Average', 'Scores']}
                rows={stats.top.map((s) => [
                  <FilmLink key="f" s={s} />,
                  <Avg key="a" value={s.avg} />,
                  s.scores,
                ])}
              />
              <Table
                caption="Lowest average"
                note={`Films with at least ${MIN.filmScores} scores`}
                head={['Film', 'Average', 'Scores']}
                rows={stats.bottom.map((s) => [
                  <FilmLink key="f" s={s} />,
                  <Avg key="a" value={s.avg} />,
                  s.scores,
                ])}
              />
              <Table
                caption="Most divisive"
                note={`Films with at least ${MIN.filmScores} scores, by the spread (standard deviation) of their scores`}
                head={['Film', 'Spread', 'Scores']}
                rows={stats.divisive.map((s) => [
                  <FilmLink key="f" s={s} />,
                  s.sd!.toFixed(2),
                  s.scores,
                ])}
              />
              <Table
                caption="Most attended"
                note="Films with at least 1 person present"
                head={['Film', 'Present']}
                rows={stats.attended.map((s) => [<FilmLink key="f" s={s} />, s.present])}
              />
            </section>

            <section ref={tipsOff} className="film-section" aria-labelledby="stats-people">
              <h2 id="stats-people">People</h2>
              <Table
                caption="Attendance"
                note={`Share of the ${o.films} ${o.films === 1 ? 'screening' : 'screenings'}${year ? ` in ${year}` : ''}`}
                head={['Person', 'Present', 'Share']}
                rows={stats.attendance.map((r) => [
                  <RoleChip key="p" person={r.person} />,
                  r.count,
                  `${r.pct}%`,
                ])}
              />
              <Table
                caption="Best chooser"
                note={`People who chose at least ${MIN.chosenFilms} films with scores: the mean of those films' averages`}
                head={['Person', 'Average', 'Films']}
                rows={stats.choosers.map((r) => [
                  <RoleChip key="p" person={r.person} />,
                  <Avg key="a" value={r.avg} />,
                  r.films,
                ])}
              />
              <Table
                caption="Kindest to harshest scorer"
                note={`People with at least ${MIN.scoresGiven} scores: the mean score they gave`}
                head={['Person', 'Mean score', 'Scores']}
                rows={stats.scorers.map((r) => [
                  <RoleChip key="p" person={r.person} />,
                  <Avg key="a" value={r.avg} />,
                  r.scores,
                ])}
              />
              <Table
                caption="Most alike"
                note={`Pairs who both scored at least ${MIN.sharedFilms} films: the mean difference between their scores`}
                head={['Pair', 'Difference', 'Shared films']}
                rows={pairRows(stats.alike)}
              />
              <Table
                caption="Least alike"
                note={`Pairs who both scored at least ${MIN.sharedFilms} films`}
                head={['Pair', 'Difference', 'Shared films']}
                rows={pairRows(stats.unalike)}
              />
            </section>

            <section className="film-section" aria-labelledby="stats-breakdowns">
              <h2 id="stats-breakdowns">Breakdowns</h2>
              <CountChart horizontal groups={chartGenres(stats.genres)} />
              <Table
                caption="By genre"
                note="A film counts once in each of its genres"
                head={['Genre', 'Films', 'Average']}
                rows={groupRows(stats.genres)}
              />
              <Table
                caption="By director"
                note={`Directors with at least ${MIN.directorFilms} films: the ${DIRECTOR_ROWS} with the most`}
                head={['Director', 'Films', 'Average']}
                rows={groupRows(stats.directors)}
              />
              <CountChart groups={stats.decades} />
              <Table
                caption="By release decade"
                head={['Decade', 'Films', 'Average']}
                rows={groupRows(stats.decades)}
              />
              <Table
                caption="By runtime"
                head={['Runtime', 'Films', 'Average']}
                rows={groupRows(stats.runtimes)}
              />
            </section>
          </>
        )}
      </>
    )
  }

  return (
    <main className="page rotation-page stats-page">
      <h1 ref={heading} tabIndex={-1}>
        Stats
      </h1>
      {body}
    </main>
  )
}
