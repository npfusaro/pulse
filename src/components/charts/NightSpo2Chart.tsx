"use client"

import * as React from "react"
import { Area, AreaChart, CartesianGrid, ReferenceDot, ReferenceLine, XAxis, YAxis } from "recharts"
import { clock } from "@/lib/format"
import type { Metric } from "@/lib/reasons"
import { ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/shells/EmptyState"
import { MetricState } from "@/components/shells/MetricState"
import { useOptionalShellCalendar } from "@/components/shells/ShellStatus"
import { ReasonPlaceholder } from "@/components/metrics/ReasonPlaceholder"
import { AXIS, ChartFigure, GlowDot, GRID, LINE_CURSOR, Pill, TOOLTIP_CLASS, TooltipLine, useSeriesAnimation } from "./ChartFrame"

export type NightSpo2Series = {
  /** Epoch ms of the main sleep's start and end. */
  bed: number
  wake: number
  /** One reading a minute, a little past both ends; null is a minute the band did not read, drawn as a gap. */
  points: { t: number; v: number | null }[]
  /** The night's lowest minute, marked. */
  low?: { t: number; v: number } | null
}

export type NightSpo2ChartProps = {
  data: Metric<NightSpo2Series> | null | undefined
}

const H = "h-[200px]"
/** Readings under this are the ones Fitbit and Health Monitor flag ("Below 95%"); the chart draws the line. */
const LOW_PCT = 95

type DotProps = { cx?: number; cy?: number; payload?: { lone?: boolean } }
/** A reading with no neighbour draws no line, so it gets a dot of its own; a run of readings is the line alone. */
const loneDot = (fill: string) => {
  const LoneDot = (d: DotProps) => (d.payload?.lone && d.cx != null && d.cy != null ? <circle key={`${d.cx}-${d.cy}`} cx={d.cx} cy={d.cy} r={1.75} fill={fill} /> : <g key={`${d.cx}-${d.cy}`} />)
  return LoneDot
}
// Module-level, so the series keep one dot renderer across re-renders (a resize must not restart their animation).
const NightDot = loneDot("var(--sleep)")
const OutDot = loneDot("var(--muted-foreground)")

/**
 * The y axis: whole percentages, from a little under the night's lowest reading (never under 80, so an outlier
 * does not flatten the rest) up to 100, in 2s or 5s so the ticks stay few.
 */
function yTicksFor(values: (number | null)[]): number[] {
  const v = values.filter((x): x is number => x !== null)
  const min = v.length ? Math.min(...v, LOW_PCT - 1) : 90
  const lo = Math.max(80, Math.floor(min / 2) * 2 - 2)
  const step = 100 - lo > 12 ? 5 : 2
  const first = Math.floor(lo / step) * step
  return Array.from({ length: Math.floor((100 - first) / step) + 1 }, (_, i) => first + i * step)
}

function Chart({ s }: { s: NightSpo2Series }) {
  const tz = useOptionalShellCalendar()?.timeZone
  const anim = useSeriesAnimation()
  const id = React.useId().replace(/:/g, "")
  const { bed, wake, points, low } = s
  // Two series on one axis: the readings in bed (lit, filled) and the odd one outside it (faint). `lone`: no reading
  // on either side, so the point gets a dot (NightDot, OutDot) where the line cannot reach it.
  const rows = React.useMemo(
    () =>
      points.map(({ t, v }, i) => {
        const lone = v !== null && points[i - 1]?.v == null && points[i + 1]?.v == null
        return t >= bed && t <= wake ? { t, night: v, out: null, lone } : { t, night: null, out: v, lone }
      }),
    [points, bed, wake]
  )

  const yTicks = yTicksFor(points.map((p) => p.v))
  const night = points.filter((p) => p.t >= bed && p.t < wake && p.v !== null).map((p) => p.v!)
  const avg = night.length ? Math.round((night.reduce((a, b) => a + b, 0) / night.length) * 10) / 10 : null
  const summary = `Blood oxygen during sleep from ${clock(bed, tz)} to ${clock(wake, tz)}: low ${Math.min(...night)}, average ${avg}, high ${Math.max(...night)} percent, ${night.length} readings.`

  return (
    <ChartFigure summary={summary} config={{ night: { label: "Blood oxygen", color: "var(--sleep)" } }} className={H}>
      <AreaChart data={rows} accessibilityLayer margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={`spo2-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--sleep)" stopOpacity={0.28} />
            <stop offset="100%" stopColor="var(--sleep)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid {...GRID} />
        <XAxis
          dataKey="t"
          type="number"
          scale="time"
          domain={[points[0].t, points.at(-1)!.t]}
          ticks={[bed, wake]}
          tickFormatter={(v: number) => clock(v, tz)}
          {...AXIS}
          tick={{ fill: "var(--foreground-secondary)" }}
        />
        <YAxis domain={[yTicks[0], 100]} ticks={yTicks} width={32} {...AXIS} />
        {/* The 95% line only when the axis reaches under it, so a steady night is not drawn against a threshold it never neared. */}
        {yTicks[0] < LOW_PCT && (
          <ReferenceLine
            y={LOW_PCT}
            stroke="var(--warning)"
            strokeDasharray="4 4"
            strokeOpacity={0.7}
            ifOverflow="hidden"
            label={({ viewBox }: { viewBox?: { x?: number; y?: number; width?: number } }) => (
              <text x={(viewBox?.x ?? 0) + (viewBox?.width ?? 0) - 2} y={(viewBox?.y ?? 0) - 4} textAnchor="end" fontSize={10} fontWeight={700} fill="var(--warning-text)">
                95%
              </text>
            )}
          />
        )}
        {[bed, wake].map((x) => (
          <ReferenceLine key={x} x={x} stroke="var(--foreground-secondary)" strokeDasharray="2 3" ifOverflow="hidden" />
        ))}
        {low && (
          <ReferenceDot
            x={low.t}
            y={low.v}
            r={3.5}
            fill="var(--foreground)"
            stroke="var(--card)"
            strokeWidth={2}
            label={({ viewBox }: { viewBox?: { x?: number; y?: number; width?: number; height?: number } }) => (
              <Pill x={(viewBox?.x ?? 0) + (viewBox?.width ?? 0) / 2} y={(viewBox?.y ?? 0) + (viewBox?.height ?? 0) + 14} anchor="middle" text={`Low ${low.v}%`} />
            )}
          />
        )}
        <ChartTooltip
          isAnimationActive={false}
          cursor={LINE_CURSOR}
          content={
            <ChartTooltipContent
              className={TOOLTIP_CLASS}
              hideIndicator
              labelFormatter={(_, payload) => clock(Number(payload?.[0]?.payload?.t), tz)}
              formatter={(v, name) => (name === "night" || name === "out" ? <TooltipLine color="var(--sleep)">{Number(v).toFixed(1)}%</TooltipLine> : null)}
            />
          }
        />
        <Area dataKey="out" type="monotone" stroke="var(--muted-foreground)" strokeOpacity={0.45} strokeWidth={1} fill="none" connectNulls={false} dot={OutDot} activeDot={false} {...anim} />
        <Area
          dataKey="night"
          type="monotone"
          stroke="var(--sleep)"
          strokeWidth={1.5}
          fill={`url(#spo2-${id})`}
          connectNulls={false}
          dot={NightDot}
          activeDot={(d: { cx?: number; cy?: number }) => <GlowDot cx={d.cx} cy={d.cy} fill="var(--sleep)" />}
          {...anim}
        />
      </AreaChart>
    </ChartFigure>
  )
}

/** Blood oxygen across the main sleep with its bed and wake markers, the 95% line and the night's low. */
export function NightSpo2Chart({ data }: NightSpo2ChartProps) {
  const empty = (
    <div className="grid place-items-center">
      <EmptyState body="No blood oxygen readings for this night." />
    </div>
  )
  return (
    <MetricState
      metric={data}
      skeleton={<NightSpo2ChartSkeleton />}
      empty={empty}
      renderReason={(r) => (
        <div className="grid place-items-center">
          <ReasonPlaceholder reason={r} size="md" />
        </div>
      )}
    >
      {(s) => (s.points.some((p) => p.v !== null) ? <Chart s={s} /> : empty)}
    </MetricState>
  )
}

export function NightSpo2ChartSkeleton() {
  return <Skeleton aria-hidden className={`${H} rounded-lg bg-muted/60`} />
}
NightSpo2Chart.Skeleton = NightSpo2ChartSkeleton
