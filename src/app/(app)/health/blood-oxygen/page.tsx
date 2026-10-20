import Link from "next/link"
import { ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { DAY, dayLabel, formatDay, MISSING } from "@/lib/format"
import { dayHref, metricHref } from "@/lib/url"
import { getBloodOxygen } from "@/server/queries/health"
import type { BloodOxygenVM } from "@/server/queries/types"
import { NightSpo2Chart } from "@/components/charts/NightSpo2Chart"
import { CAPTION, LABEL, StatusChip, ValueUnit } from "@/components/metrics/primitives"
import { DetailShell } from "@/components/shells/DetailShell"
import { MetricState } from "@/components/shells/MetricState"
import { ActionLink, SectionShell } from "@/components/shells/SectionShell"
import { pageDay, type SearchParams } from "../../_lib/day"

export const metadata = { title: "Blood oxygen", description: "Last night’s minute-by-minute blood oxygen, its low point and your 30-night trend." }

const INFO = {
  title: "About blood oxygen",
  body: (
    <>
      <p>Your band estimates blood oxygen (SpO2) once a minute while you sleep, from the red and infrared light its sensor shines through your skin. Fitbit uploads the readings to Google Health, and Pulse reads them from there.</p>
      <p>Minutes the band could not read reliably, when you moved or the band sat loose, are left out, so gaps in the chart are normal. Fitbit only reports the night’s average in its own app; this screen shows every minute it kept.</p>
      <p>Most people sit between 95 and 100% through the night. Brief dips are common and usually mean nothing; a night that stays low, or a trend downward, is worth a conversation with a doctor. This is an estimate, not a medical measurement.</p>
    </>
  ),
}

/** The night's average over its low, its minutes under 95% and how many minutes the band read. */
function Hero({ vm }: { vm: BloodOxygenVM }) {
  const n = vm.night.value
  const stats = [
    { label: "Low", value: n ? `${n.low.v}` : MISSING, spoken: n ? `${n.low.v} percent` : "no readings" },
    { label: "Under 95%", value: n ? `${n.below95Min}` : MISSING, unit: "min", spoken: n ? `${n.below95Min} minutes` : "no readings" },
    { label: "Readings", value: n ? `${n.readMin}` : MISSING, spoken: n ? `${n.readMin} minutes read` : "no readings" },
  ]
  return (
    <div className="flex w-full max-w-[360px] flex-col items-center gap-2 py-4 text-center">
      <MetricState
        metric={vm.average}
        skeleton={null}
        reasonSize="lg"
        renderReason={(r) => (
          <>
            <ValueUnit value={MISSING} unit="%" className="font-numeric text-[64px] leading-[64px] font-bold tracking-[-0.02em]" unitClassName="text-xl leading-7 font-semibold text-foreground-secondary" />
            <p className={CAPTION}>{r === "awaiting_sleep_sync" ? "Waiting for last night’s sleep" : r === "band_not_worn" ? "Band not worn this night" : "No readings on this night"}</p>
          </>
        )}
      >
        {(avg) => (
          <>
            <ValueUnit
              value={avg.toFixed(1)}
              unit="%"
              className="font-numeric text-[64px] leading-[64px] font-bold tracking-[-0.02em]"
              unitClassName="text-xl leading-7 font-semibold text-foreground-secondary"
            />
            <p className={CAPTION}>{vm.isToday ? "Last night’s average" : "Night average"}</p>
            {vm.chip && (
              <StatusChip tone={vm.chip.tone} className="mt-1">
                {vm.chip.text}
              </StatusChip>
            )}
          </>
        )}
      </MetricState>
      <ul className="mt-4 grid w-full grid-cols-3 gap-3">
        {stats.map((s) => (
          <li key={s.label} aria-label={`${s.label}: ${s.spoken}`}>
            <p aria-hidden className="font-numeric text-xl leading-6 font-bold tabular-nums">
              {s.value}
              {s.unit && s.value !== MISSING && <span className="ml-0.5 text-sm font-semibold text-foreground-secondary">{s.unit}</span>}
            </p>
            <p aria-hidden className={cn(LABEL, "mt-1 text-muted-foreground")}>
              {s.label}
            </p>
          </li>
        ))}
      </ul>
    </div>
  )
}

const CELL = "font-numeric text-[15px] leading-5 font-bold tabular-nums"
const HEAD = cn(LABEL, "text-[10px] leading-3 text-muted-foreground")
/** Nearly every night dips under 95% for a minute, so only a low under 90% or half an hour under 95% is toned. */
const LOW_NOTABLE = 90
const UNDER_NOTABLE_MIN = 30

/** The week's nights as rows (oldest first, the shown night last); a row opens its night. */
function Week({ vm, today }: { vm: BloodOxygenVM; today: string }) {
  return (
    <table className="w-full border-separate border-spacing-0">
      <thead>
        <tr className="text-left">
          <th scope="col" className={cn(HEAD, "pb-2 font-bold")}>
            Night
          </th>
          <th scope="col" className={cn(HEAD, "pb-2 text-right font-bold")}>
            Average
          </th>
          <th scope="col" className={cn(HEAD, "pb-2 text-right font-bold")}>
            Low
          </th>
          <th scope="col" className={cn(HEAD, "pb-2 text-right font-bold")}>
            Under 95%
          </th>
          <th scope="col" className="w-6" />
        </tr>
      </thead>
      <tbody>
        {vm.nights.map((n) => {
          const current = n.day === vm.day
          const read = n.average !== null || n.low !== null
          return (
            <tr key={n.day} className={cn("border-t border-border", current && "text-foreground")}>
              <td className="border-t border-border py-2.5">
                <Link href={dayHref("/health/blood-oxygen", n.day, today)} className={cn("text-[15px] leading-5", current ? "font-bold" : "font-medium text-foreground-secondary", "underline-offset-4 hover:underline")}>
                  {n.day === today ? "Last night" : formatDay(n.day, DAY.short)}
                </Link>
              </td>
              <td className={cn(CELL, "border-t border-border py-2.5 text-right")}>{read && n.average !== null ? `${n.average.toFixed(1)}%` : MISSING}</td>
              <td className={cn(CELL, "border-t border-border py-2.5 text-right", n.low !== null && n.low < LOW_NOTABLE && "text-warning-text")}>{n.low !== null ? `${n.low}%` : MISSING}</td>
              <td className={cn(CELL, "border-t border-border py-2.5 text-right", n.below95Min !== null && n.below95Min >= UNDER_NOTABLE_MIN ? "text-warning-text" : "text-foreground-secondary")}>
                {n.below95Min !== null ? `${n.below95Min} min` : MISSING}
              </td>
              <td className="border-t border-border py-2.5 text-right">
                <ChevronRight aria-hidden className="ml-auto size-4 text-muted-foreground" strokeWidth={2} />
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

export default async function BloodOxygenPage({ searchParams }: PageProps<"/health/blood-oxygen">) {
  const { d, today, ctx } = await pageDay(searchParams as SearchParams, "/health/blood-oxygen")
  const vm = await getBloodOxygen(d, ctx)
  return (
    <DetailShell
      title="Blood oxygen"
      dateSwitcher={{ mode: "day" }}
      info={INFO}
      hero={<Hero vm={vm} />}
      primary={
        <SectionShell
          variant="card"
          level={2}
          title={vm.isToday ? "Last night" : dayLabel(d, today)}
          info={{ title: "Blood oxygen through the night", body: "Each minute the band could read, from bedtime to waking. A gap is a minute it could not read, usually movement. The dashed line marks 95%, under which readings count as low." }}
        >
          <NightSpo2Chart data={vm.night} />
        </SectionShell>
      }
      secondary={[
        <SectionShell
          key="week"
          variant="card"
          level={2}
          title="This week"
          info={{ title: "Seven nights", body: "Each night’s average, its lowest minute and how many minutes sat under 95%. The nightly averages alone, over months, are on the Blood oxygen metric screen." }}
          className="xl:col-span-2"
        >
          <Week vm={vm} today={today} />
          <div className="mt-3 flex justify-end">
            <ActionLink label="30-night history" href={dayHref(metricHref("spo2"), d, today)} />
          </div>
        </SectionShell>,
      ]}
    />
  )
}
