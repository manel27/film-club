import type { ReactElement } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
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

/** A chart box sized to its container; `height` in px. */
function Chart({ height, children }: { height: number; children: ReactElement }) {
  return (
    <div className="stats-chart" aria-hidden="true" style={{ height }}>
      {/* initialDimension: a first paint before ResizeObserver measures (and jsdom, which has none). */}
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 320, height }}>
        {children}
      </ResponsiveContainer>
    </div>
  )
}

const avg = (v: unknown) => (typeof v === 'number' ? v.toFixed(2) : '–')

/** Films screened (bars, left axis) and average score (line, right axis) per period. */
export function OverTimeChart({ periods }: { periods: Period[] }) {
  return (
    <Chart height={260}>
      <ComposedChart
        data={periods}
        accessibilityLayer={false}
        margin={{ top: 8, right: 0, bottom: 0, left: 0 }}
      >
        <CartesianGrid stroke="var(--border)" strokeOpacity={0.4} vertical={false} />
        <XAxis
          dataKey="label"
          // Months as "Mar" so twelve fit at 360px; years stay "2019".
          tickFormatter={(l: string) => (/^\d/.test(l) ? l : l.slice(0, 3))}
          tick={TICK}
          axisLine={AXIS}
          tickLine={AXIS}
          interval="preserveStartEnd"
        />
        <YAxis
          yAxisId="films"
          allowDecimals={false}
          tick={TICK}
          axisLine={AXIS}
          tickLine={AXIS}
          width={32}
        />
        <YAxis
          yAxisId="avg"
          orientation="right"
          domain={[0, 10]}
          tick={TICK}
          axisLine={AXIS}
          tickLine={AXIS}
          width={32}
        />
        <Tooltip
          {...TOOLTIP}
          formatter={(value, name) => [name === 'Average score' ? avg(value) : value, name]}
        />
        <Legend wrapperStyle={{ color: 'var(--text)', fontSize: 12 }} />
        <Bar
          yAxisId="films"
          dataKey="films"
          name="Films"
          fill="var(--accent)"
          maxBarSize={48}
          isAnimationActive={false}
        />
        <Line
          yAxisId="avg"
          dataKey="avg"
          name="Average score"
          stroke="var(--accent-2)"
          strokeWidth={2}
          dot={{ r: 3, fill: 'var(--accent-2)' }}
          connectNulls
          isAnimationActive={false}
        />
      </ComposedChart>
    </Chart>
  )
}

/** Film count per group as bars: horizontal (genres) or vertical (decades). */
export function CountChart({ groups, horizontal }: { groups: Group[]; horizontal?: boolean }) {
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
      <Chart height={data.length * 28 + 40}>
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
    <Chart height={220}>
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
