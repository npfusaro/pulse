import { Suspense } from "react"
import { notFound } from "next/navigation"
import { DATA_COLORS, deltaTone } from "@/lib/bands"
import { DASHBOARD_LABEL } from "@/lib/dashboard"
import { DAY, formatDay, formatValue } from "@/lib/format"
import { dayHref, RANGES, type TrendRange } from "@/lib/url"
import { TrendChart, type TrendSeries } from "@/components/charts/TrendChart"
import { ReasonPlaceholder } from "@/components/metrics/ReasonPlaceholder"
import { CAPTION, LABEL, MetricTags, StatusChip, ValueUnit } from "@/components/metrics/primitives"
import { DetailShell } from "@/components/shells/DetailShell"
import { EmptyState } from "@/components/shells/EmptyState"
import { MetricState } from "@/components/shells/MetricState"
import { ActionLink, SectionShell } from "@/components/shells/SectionShell"
import { getMetricDetail, isDetailKey, type MetricDetailVM } from "@/server/queries/metric"
import { pageDay, type SearchParams } from "../../_lib/day"
import { mapMetric } from "../../_lib/view"
import { RangeStats, RangeStatsCard } from "./RangeStats"
import { METRIC_GRID, MetricSection } from "./sections"

const STACK: Record<"calories" | "distance", readonly TrendSeries[]> = {
  calories: [
    { key: "resting", label: "Resting", color: DATA_COLORS["energy-resting"].css },
    { key: "active", label: "Active", color: DATA_COLORS["energy-active"].css },
  ],
  distance: [
    { key: "everyday", label: "Everyday", color: DATA_COLORS["energy-resting"].css },
    { key: "workouts", label: "Workouts", color: DATA_COLORS["energy-active"].css },
  ],
}

export async function generateMetadata({ params }: PageProps<"/metric/[key]">) {
  const { key } = await params
  return { title: isDetailKey(key) ? DASHBOARD_LABEL[key] : "Metric" }
}

/** A metric's own screen `/metric/[key]?d=&r=` (spec §11 MD1): the day, its history, then the metric's own sections. */
export default async function MetricPage({ params, searchParams }: PageProps<"/metric/[key]">) {
  const { key } = await params
  if (!isDetailKey(key)) notFound()
  const { d, today, timeZone, ctx } = await pageDay(searchParams as SearchParams, `/metric/${key}`)
  const vm = await getMetricDetail(key, d, ctx)
  const empty = vm.value.value === null && vm.history.value === null
  // The day's hourly view sits beside the hero on laptop; every other section follows the history.
  const [first, ...rest] = vm.sections
  const lead = first?.kind === "hourly" && !empty ? first : null
  const more = lead ? rest : vm.sections
  // Rounded as the chip shows it, so 0.04 km reads "+0.04", not "0.00".
  const k = vm.format === "decimal2" ? 100 : vm.format === "decimal1" ? 10 : 1
  const deltas = Object.fromEntries(
    RANGES.map((r) => [r, vm.ranges[r].average === null || vm.ranges[r].prior === null ? null : Math.round((vm.ranges[r].average! - vm.ranges[r].prior!) * k) / k]),
  ) as Record<TrendRange, number | null>
  const stats = { ranges: vm.ranges, format: vm.format, unit: vm.unit, direction: vm.direction, total: vm.total }

  return (
    <DetailShell
      title={vm.label}
      dateSwitcher={{ mode: "day" }}
      // Blood oxygen has a night view of its own (the band's minute readings); this screen keeps the nightly averages.
      action={key === "spo2" ? <ActionLink label="Night view" href={dayHref("/health/blood-oxygen", d, today)} /> : undefined}
      hero={<Hero vm={vm} />}
      summary={lead && <MetricSection s={lead} vm={vm} timeZone={timeZone} />}
      primary={
        empty ? (
          <SectionShell variant="card" level={2} title="History">
            <EmptyState
              body={
                vm.group === "nutrition"
                  ? `No ${vm.label.toLowerCase()} logged yet. Log it in Journal, or in Fitbit or Google Health, and it shows here.`
                  : `No ${vm.label.toLowerCase()} from Google Health yet. It shows here once your phone, Fitbit or a connected device records it and syncs.`
              }
              action={vm.group === "nutrition" ? { label: "Open Journal", href: "/journal" } : undefined}
            />
          </SectionShell>
        ) : (
          <div className={METRIC_GRID}>
            <SectionShell variant="card" level={2} title="History">
              <TrendChart
                key={vm.key}
                label={vm.label}
                unit={vm.unit}
                format={vm.format}
                colorBy="single"
                direction={vm.direction}
                data={mapMetric(vm.history, (ps) => ps.map((p) => ({ date: p.day, value: p.value, parts: p.parts })))}
                deltas={deltas}
                ranges={RANGES}
                stack={vm.chart.stack && STACK[vm.chart.stack]}
                reference={vm.chart.reference}
                baseline={vm.chart.baseline}
                smooth={vm.chart.smooth}
              />
            </SectionShell>
            <Suspense fallback={<RangeStatsCard {...stats} range="m" />}>
              <RangeStats {...stats} />
            </Suspense>
          </div>
        )
      }
      secondary={empty ? [] : more.map((s) => <MetricSection key={s.kind} s={s} vm={vm} timeZone={timeZone} className={more.length === 1 ? "xl:col-span-2" : undefined} />)}
      footer={
        <SectionShell variant="card" level={2} title={`About ${vm.label.toLowerCase()}`}>
          <div className="max-w-[65ch] space-y-2 text-[15px] leading-[22px] text-pretty text-foreground-secondary">
            <p>{vm.about}</p>
            <p>{vm.source}</p>
          </div>
        </SectionShell>
      }
    />
  )
}

const unitText = (unit?: string) => (unit ? (unit === "%" ? "%" : `\u00a0${unit}`) : "")

/** The day's value (a reading metric's latest reading) against its 30-day average. */
function Hero({ vm }: { vm: MetricDetailVM }) {
  // The date switcher names the day; a reading from an earlier day says which.
  const when = vm.valueDay && vm.valueDay !== vm.day ? `Latest reading, ${formatDay(vm.valueDay, DAY.short)}` : null
  return (
    <div className="flex w-full max-w-[360px] flex-col items-center gap-2 py-4 text-center">
      {when && <p className={`${LABEL} text-muted-foreground`}>{when}</p>}
      <MetricState metric={vm.value} skeleton={null} renderReason={(r) => <ReasonPlaceholder reason={r} size="lg" className="py-3" />}>
        {(value) => {
          const avg = vm.average
          const t = avg !== null ? deltaTone(vm.direction, value, avg, vm.sd) : null
          const diff = avg !== null ? value - avg : null
          return (
            <>
              <ValueUnit
                value={formatValue(vm.format, value)}
                unit={vm.unit}
                className="font-numeric text-[64px] leading-[64px] font-bold tracking-[-0.02em]"
                unitClassName="text-xl leading-7 font-semibold text-foreground-secondary"
              />
              {vm.soFar && <MetricTags extra={["so_far"]} />}
              {/* A running total against whole days would always read "below": today shows the average alone. */}
              {t && diff !== null && !vm.soFar && (
                <StatusChip tone={t.tone === "good" ? "optimal" : t.tone === "bad" ? "warning" : "neutral"} delta={t.dir} className="mt-1">
                  {t.dir === "flat"
                    ? "In line with your 30-day average"
                    : `${formatValue(vm.format, Math.abs(diff))}${unitText(vm.unit)} ${t.dir === "up" ? "above" : "below"} your 30-day average`}
                </StatusChip>
              )}
              <p className={CAPTION}>
                {avg === null ? "No 30-day average yet" : `30-day average ${formatValue(vm.format, avg)}${unitText(vm.unit)}`}
              </p>
            </>
          )
        }}
      </MetricState>
    </div>
  )
}
