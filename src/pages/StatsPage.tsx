import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { Link, useSearchParams } from 'react-router'
import { RoleChip } from '../components/Chip'
import { Rating } from '../components/FilmViews'
import Scroll from '../components/Scroll'
import { tabKeyIndex } from '../components/tabKeys'
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

/** Rows a table card shows until "Show all". */
const TOP = 5

/**
 * A ranking or breakdown as a card: its caption as the visible heading, the rule it
 * follows under that, then the table (first cell a row header). The <caption> stays
 * for table navigation but is sr-only, so the name isn't shown twice. Over TOP rows:
 * the first TOP and a Show all / Show fewer toggle (state reset by the panel's key).
 */
function Table(props: { caption: string; note?: string; head: string[]; rows: ReactNode[][] }) {
  const id = useId()
  const [all, setAll] = useState(false)
  const n = props.rows.length
  return (
    <div className="stats-card">
      <h2 className="stats-card-title">{props.caption}</h2>
      {props.note && <p className="muted stats-note">{props.note}</p>}
      {/* Not the bare caption: the heading and the table already say it. */}
      <Scroll label={`${props.caption}, scrolls sideways`}>
        <table id={id} className="rotation-table">
          <caption className="sr-only">{props.caption}</caption>
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
            {n === 0 ? (
              <tr>
                <td colSpan={props.head.length} className="muted">
                  None in this period.
                </td>
              </tr>
            ) : (
              (all ? props.rows : props.rows.slice(0, TOP)).map(([first, ...rest], i) => (
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
      {n > TOP && (
        <button
          type="button"
          className="button button-secondary button-small stats-more"
          aria-expanded={all}
          aria-controls={id}
          onClick={() => setAll(!all)}
        >
          {/* The visible words start the name (WCAG 2.5.3); the rest says which table. */}
          {all ? 'Show fewer' : `Show all (${n})`}{' '}
          <span className="sr-only">rows: {props.caption}</span>
        </button>
      )}
    </div>
  )
}

/**
 * A chart as a card beside its table, titled like the table cards. Hidden from screen
 * readers as a whole (the table beside it has the same numbers), so the title is no heading.
 */
const ChartCard = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="stats-card" aria-hidden="true">
    <p className="stats-card-title">{title}</p>
    {children}
  </div>
)

/** One big-number tile of the overview: a term and its value, inside the <dl>. */
const Tile = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="stats-tile">
    <dt>{label}</dt>
    <dd>{children}</dd>
  </div>
)

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

const TABS = [
  ['overview', 'Overview'],
  ['films', 'Films'],
  ['people', 'People'],
  ['breakdowns', 'Breakdowns'],
] as const
type Tab = (typeof TABS)[number][0]

/**
 * Stats (#/stats, PLAN 10.2): club numbers for all time or one year. One load
 * (stats_data() and the people); the year filter (?year=) works on it in the
 * browser, so changing it sends no request that could arrive late. A dashboard
 * of four tabs (?tab=, Overview by default); the year applies to all of them.
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
  const tab: Tab = TABS.find(([t]) => t === params.get('tab'))?.[0] ?? 'overview'
  // The last tab and year written. React Router commits a navigation in a transition, so a
  // second change can come from a render that still shows the old URL: it merges into these,
  // not into that render's values. Synced to the URL on each commit (Back, a typed URL).
  const latest = useRef({ tab, year })
  useLayoutEffect(() => {
    latest.current = { tab, year }
  }, [tab, year])
  // Written from the validated values, so a bad tab or year in the URL is dropped.
  const go = (change: { tab: Tab } | { year: string }) => {
    const { tab: t, year: y } = (latest.current = { ...latest.current, ...change })
    setParams({ ...(t !== 'overview' && { tab: t }), ...(y && { year: y }) }, { replace: true })
  }
  const stats = useMemo(
    () => loaded && computeStats(loaded.data, loaded.people, year),
    [loaded, year],
  )

  // ARIA tabs keyboard, from the pressed tab (i).
  const onTabKey = (e: KeyboardEvent, i: number) => {
    const to = tabKeyIndex(e.key, i, TABS.length)
    if (to === undefined) return
    e.preventDefault()
    const [next] = TABS[to]
    go({ tab: next })
    document.getElementById(`stats-tab-${next}`)?.focus()
  }

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
          <select value={year} onChange={(e) => go({ year: e.target.value })}>
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
            <div role="tablist" aria-label="Stats" className="tabs stats-tabs">
              {TABS.map(([t, label], i) => (
                <button
                  key={t}
                  id={`stats-tab-${t}`}
                  type="button"
                  role="tab"
                  aria-selected={tab === t}
                  aria-controls="stats-panel"
                  tabIndex={tab === t ? 0 : -1}
                  className="tab"
                  onClick={() => go({ tab: t })}
                  onKeyDown={(e) => onTabKey(e, i)}
                >
                  {label}
                </button>
              ))}
            </div>
            {/* Keyed on tab and year: Show all resets, and no card inherits another's state. */}
            <div
              key={`${tab}-${year}`}
              ref={tipsOff}
              id="stats-panel"
              role="tabpanel"
              aria-labelledby={`stats-tab-${tab}`}
              tabIndex={0}
            >
              {tab === 'overview' && (
                <>
                  <dl className="stats-tiles">
                    <Tile label="Films screened">{o.films}</Tile>
                    <Tile label="Scores given">{o.scores}</Tile>
                    <Tile label="Club average">
                      <Avg value={o.clubAvg} />
                    </Tile>
                    <Tile label="Average attendance">{o.avgAttendance?.toFixed(2) ?? '–'}</Tile>
                    {o.kinds.map((k) => (
                      <Tile key={k.kind} label={k.label}>
                        {k.count}
                      </Tile>
                    ))}
                    <Tile label="First screening">{o.first && screeningDay(o.first, today)}</Tile>
                    <Tile label="Last screening">{o.last && screeningDay(o.last, today)}</Tile>
                  </dl>
                  <p className="muted">
                    Averages leave out films with no scores; attendance is per screening.
                  </p>
                  <div className="stats-grid">
                    <ChartCard title="Over time">
                      <OverTimeChart periods={stats.overTime} />
                    </ChartCard>
                    <Table
                      caption={year ? `By month in ${year}` : 'By year'}
                      head={[year ? 'Month' : 'Year', 'Films', 'Average', 'Attendance']}
                      rows={stats.overTime.map((p) => [
                        p.label,
                        p.films,
                        <Avg key="a" value={p.avg} />,
                        p.attendance.toFixed(2),
                      ])}
                    />
                  </div>
                </>
              )}
              {tab === 'films' && (
                <div className="stats-grid">
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
                </div>
              )}
              {tab === 'people' && (
                <div className="stats-grid">
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
                </div>
              )}
              {tab === 'breakdowns' && (
                <div className="stats-grid">
                  <ChartCard title="Films by genre">
                    <CountChart horizontal groups={chartGenres(stats.genres)} />
                  </ChartCard>
                  <Table
                    caption="By genre"
                    note="A film counts once in each of its genres"
                    head={['Genre', 'Films', 'Average']}
                    rows={groupRows(stats.genres)}
                  />
                  <ChartCard title="Films by decade">
                    <CountChart groups={stats.decades} />
                  </ChartCard>
                  <Table
                    caption="By release decade"
                    head={['Decade', 'Films', 'Average']}
                    rows={groupRows(stats.decades)}
                  />
                  <Table
                    caption="By director"
                    note={`Directors with at least ${MIN.directorFilms} films: the ${DIRECTOR_ROWS} with the most`}
                    head={['Director', 'Films', 'Average']}
                    rows={groupRows(stats.directors)}
                  />
                  <Table
                    caption="By runtime"
                    head={['Runtime', 'Films', 'Average']}
                    rows={groupRows(stats.runtimes)}
                  />
                </div>
              )}
            </div>
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
