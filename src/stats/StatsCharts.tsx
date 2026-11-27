import type { ReactElement } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { Group, Period } from './stats'

// Charts on the Stats page (only that lazy chunk loads Recharts). Decorative to
// screen readers: the table under each one carries the same numbers. No
// accessibilityLayer (it makes the SVG a Tab stop inside an aria-hidden box)
// and no animation (prefers-reduced-motion, and nothing to gain).
// Colours are the theme's CSS variables, so the charts follow the theme switch.
// shortcut: no fragments as chart children: react-is 17 (the version installed)
// can't see React 19 fragments; pin react-is 19 if a chart ever needs them.

const TICK = { fill: 'var(--text)', fontSize: 12 }
const AXIS = { stroke: 'var(--border)' }
const TOOLTIP = {
  contentStyle: {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    color: 'var(--text)',
    padding: '0.25rem 0.5rem',
  },
  itemStyle: { color: 'var(--text)', padding: 0 },
  cursor: { fill: 'var(--border)', fillOpacity: 0.3 },
  isAnimationActive: false,
}

/** A chart box sized to its container, `height` px tall, with a small title above. */
function Chart(props: { title?: string; height: number; children: ReactElement }) {
  return (
    <div className="stats-chart" aria-hidden="true">
      {props.title && <p className="stats-chart-title">{props.title}</p>}
      <div style={{ height: props.height }}>
        {/* initialDimension: a first paint before ResizeObserver measures (and jsdom, which has none). */}
        <ResponsiveContainer
          width="100%"
          height="100%"
          initialDimension={{ width: 320, height: props.height }}
        >
          {props.children}
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// Months as "Mar" so twelve fit at 360px; years stay "2019".
const periodTick = (l: string) => (/^\d/.test(l) ? l : l.slice(0, 3))

/**
 * Films screened (bars) and average score (line) per period, as two stacked
 * charts sharing the x-axis: a line over bars can't contrast with both the bars
 * and the page in every theme (Superman's text and accent are both dark blue).
 */
export function OverTimeChart({ periods }: { periods: Period[] }) {
  const x = (
    <XAxis
      dataKey="label"
      // Bands in both charts, so each line point sits over its bar, not at the edges.
      scale="band"
      tickFormatter={periodTick}
      tick={TICK}
      axisLine={AXIS}
      tickLine={AXIS}
      interval="preserveStartEnd"
    />
  )
  const margin = { top: 8, right: 8, bottom: 0, left: 0 }
  return (
    <>
      <Chart title="Films" height={160}>
        <BarChart data={periods} accessibilityLayer={false} margin={margin}>
          <CartesianGrid stroke="var(--border)" strokeOpacity={0.4} vertical={false} />
          {x}
          <YAxis allowDecimals={false} tick={TICK} axisLine={AXIS} tickLine={AXIS} width={32} />
          <Tooltip {...TOOLTIP} />
          <Bar
            dataKey="films"
            name="Films"
            fill="var(--accent)"
            maxBarSize={48}
            isAnimationActive={false}
          />
        </BarChart>
      </Chart>
      <Chart title="Average score" height={160}>
        <LineChart data={periods} accessibilityLayer={false} margin={margin}>
          <CartesianGrid stroke="var(--border)" strokeOpacity={0.4} vertical={false} />
          {x}
          <YAxis
            domain={[0, 10]}
            ticks={[0, 2, 4, 6, 8, 10]}
            tick={TICK}
            axisLine={AXIS}
            tickLine={AXIS}
            width={32}
          />
          {/* filterNull off: a period with no scores shows "–", as in the table. */}
          <Tooltip
            {...TOOLTIP}
            filterNull={false}
            formatter={(v) => (typeof v === 'number' ? v.toFixed(2) : '–')}
          />
          {/* No connectNulls: a period with no average is a gap; dots keep lone points visible. */}
          <Line
            dataKey="avg"
            name="Average"
            stroke="var(--text)"
            strokeWidth={2}
            dot={{ r: 3, fill: 'var(--text)', stroke: 'var(--text)' }}
            isAnimationActive={false}
          />
        </LineChart>
      </Chart>
    </>
  )
}

// Genre names longer than this get an ellipsis on the axis (the tooltip and table keep them whole).
const LABEL_MAX = 14
const shortLabel = (l: string) => (l.length > LABEL_MAX ? `${l.slice(0, LABEL_MAX - 1)}…` : l)

/** Film count per group as bars: horizontal (genres) or vertical (decades). */
export function CountChart(props: { groups: Group[]; horizontal?: boolean; title?: string }) {
  const { groups, horizontal, title } = props
  const data = groups.map((g) => ({ label: g.label ?? 'Unknown', films: g.count }))
  const bar = (
    <Bar
      dataKey="films"
      name="Films"
      fill="var(--accent)"
      maxBarSize={48}
      isAnimationActive={false}
    />
  )
  const tooltip = <Tooltip {...TOOLTIP} />
  if (horizontal) {
    return (
      <Chart title={title} height={data.length * 28 + 40}>
        <BarChart
          data={data}
          layout="vertical"
          accessibilityLayer={false}
          margin={{ top: 0, right: 8, bottom: 0, left: 0 }}
        >
          <CartesianGrid stroke="var(--border)" strokeOpacity={0.4} horizontal={false} />
          <XAxis type="number" allowDecimals={false} tick={TICK} axisLine={AXIS} tickLine={AXIS} />
          <YAxis
            type="category"
            dataKey="label"
            tickFormatter={shortLabel}
            tick={TICK}
            axisLine={AXIS}
            tickLine={AXIS}
            width={110}
            interval={0}
          />
          {tooltip}
          {bar}
        </BarChart>
      </Chart>
    )
  }
  return (
    <Chart title={title} height={220}>
      <BarChart
        data={data}
        accessibilityLayer={false}
        margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
      >
        <CartesianGrid stroke="var(--border)" strokeOpacity={0.4} vertical={false} />
        <XAxis
          dataKey="label"
          tick={TICK}
          axisLine={AXIS}
          tickLine={AXIS}
          interval="preserveStartEnd"
        />
        <YAxis allowDecimals={false} tick={TICK} axisLine={AXIS} tickLine={AXIS} width={32} />
        {tooltip}
        {bar}
      </BarChart>
    </Chart>
  )
}
