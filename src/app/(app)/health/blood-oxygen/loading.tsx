import { NightSpo2ChartSkeleton } from "@/components/charts/NightSpo2Chart"
import { DetailShell } from "@/components/shells/DetailShell"
import { SectionShell } from "@/components/shells/SectionShell"
import { SkeletonText } from "@/components/ui/skeleton"

const LABEL = "text-xs leading-4 font-bold tracking-[0.1em] uppercase"

/** Blood oxygen loading: the date row, the average with its three stats, the night's chart, then the week's nights. */
export default function Loading() {
  return (
    <DetailShell
      loading
      title="Blood oxygen"
      dateSwitcher={{ mode: "day" }}
      hero={
        <div aria-hidden className="flex w-full max-w-[360px] flex-col items-center gap-2 py-4 text-center">
          <SkeletonText className="w-[4ch] font-numeric text-[64px] leading-[64px] font-bold" />
          <SkeletonText className="w-28 text-xs leading-4" />
          <ul className="mt-4 grid w-full grid-cols-3 gap-3">
            {["Low", "Under 95%", "Readings"].map((w) => (
              <li key={w}>
                <SkeletonText className="mx-auto w-[4ch] font-numeric text-xl leading-6 font-bold" />
                <p className={`${LABEL} mt-1 text-muted-foreground`}>{w}</p>
              </li>
            ))}
          </ul>
        </div>
      }
      primary={
        <SectionShell variant="card" level={2} title="Last night">
          <NightSpo2ChartSkeleton />
        </SectionShell>
      }
      secondary={[
        <SectionShell key="week" variant="card" level={2} title="This week" className="xl:col-span-2">
          <div aria-hidden className="divide-y divide-border">
            {Array.from({ length: 7 }, (_, i) => (
              <div key={i} className="flex items-center justify-between py-2.5">
                <SkeletonText className="w-24 text-[15px] leading-5" />
                <SkeletonText className="w-40 text-[15px] leading-5" />
              </div>
            ))}
          </div>
        </SectionShell>,
      ]}
    />
  )
}
