import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../db";
import { dailyMetrics, dailyValues, healthRecords } from "../db/schema";
import { SEED_DAYS } from "../sources/seed/scenario";
import { copyDb, ctxFor, dayAt, seeded, USER } from "../testing";
import { SCENARIO } from "../sources/seed/scenario";
import { getBloodOxygen, getHealthHub, getHealthspan, getMonitor } from "./health";

let db: Db;
beforeAll(async () => {
  db = await seeded();
});

const today = dayAt(SEED_DAYS - 1);

describe("getMonitor heart rhythm", () => {
  it("lists the seeded ECG readings newest first, with Fitbit's labels, and counts the notification", async () => {
    const { ecg, irn } = (await getMonitor(today, ctxFor(db))).heartRhythm;
    expect(ecg.map((e) => e.label)).toEqual(["Normal sinus rhythm", "Inconclusive: high heart rate", "Normal sinus rhythm"]);
    expect(ecg.map((e) => e.tone)).toEqual(["optimal", "neutral", "optimal"]);
    expect(ecg[0].at).toBeGreaterThan(ecg[1].at);
    expect(ecg[0].avgBpm).toBe(66);
    expect(irn).toMatchObject({ count: 1, latestDay: dayAt(SEED_DAYS - 22) });
  });

  it("shows only what had happened by the selected day", async () => {
    const { ecg, irn } = (await getMonitor(dayAt(SEED_DAYS - 30), ctxFor(db))).heartRhythm;
    expect(ecg).toHaveLength(1);
    expect(irn).toEqual({ count: 0, latestAt: null, latestDay: null });
  });

  it("reads an unknown classification as no result, never as normal", async () => {
    const db2 = await copyDb(db);
    await db2.insert(healthRecords).values({ userId: USER, id: "x", kind: "ecg", ts: 1, day: today, data: { result: "SOMETHING_NEW" } });
    const x = (await getMonitor(today, ctxFor(db2))).heartRhythm.ecg.find((e) => e.id === "x")!;
    expect(x).toMatchObject({ label: "No result", tone: "neutral", avgBpm: null });
  });
});

describe("getMonitor measurements", () => {
  it("shows weight and body fat against the readings of the 30 days before, and hides metrics never recorded", async () => {
    const m = (await getMonitor(today, ctxFor(db))).measurements;
    expect(m.map((x) => x.key)).toEqual(["weight", "body_fat"]);
    const w = async (d: string) =>
      (await db.select({ w: dailyMetrics.weightKg }).from(dailyMetrics).where(and(eq(dailyMetrics.userId, USER), eq(dailyMetrics.day, d))))[0].w;
    // Monthly weigh-ins on day indexes 2, 32, ... 152: the latest is 152, compared with 122.
    expect(m[0].metric.value).toBe(await w(dayAt(152)));
    expect(m[0].average).toBe(await w(dayAt(122)));
    expect(m[0].caption).toMatch(/^\w{3}, \w{3} \d+$/);
  });

  it("adds blood glucose and core temperature once there is a value, and says no data before the first", async () => {
    const db2 = await copyDb(db);
    await db2.insert(dailyValues).values([
      { userId: USER, day: dayAt(170), key: "glucose", value: 98 },
      { userId: USER, day: dayAt(175), key: "glucose", value: 104 },
      { userId: USER, day: dayAt(176), key: "core_temp", value: 36.8 },
    ]);
    const m = (await getMonitor(today, ctxFor(db2))).measurements;
    expect(m.map((x) => x.key)).toEqual(["weight", "body_fat", "glucose", "core_temp"]);
    expect(m[2]).toMatchObject({ metric: { value: 104 }, average: 98, unit: "mg/dL" });
    expect(m[3].average).toBeNull();
    const before = (await getMonitor(dayAt(160), ctxFor(db2))).measurements[2];
    expect(before.metric).toMatchObject({ value: null, reason: "no_data" });
  });
});

describe("getHealthspan factors", () => {
  it("each factor carries its 6-month and 30-day means, how it stands and its Trend View", async () => {
    const vm = await getHealthspan(dayAt(170), ctxFor(db));
    const shown = vm.contributors.filter((c) => c.metric.value !== null);
    expect(shown.length).toBeGreaterThan(5);
    for (const c of shown) {
      expect(c.recent, c.key).not.toBeNull();
      expect(c.state?.title, c.key).toMatch(/^(Outperforming|On track|Room to improve)$/);
    }
    expect(Object.fromEntries(vm.contributors.map((c) => [c.key, c.trendHref]))).toMatchObject({
      sleepHours: "/trend/hours",
      sri: "/trend/consistency",
      zone13: "/trend/zones13",
      restingHr: "/trend/rhr",
      vo2max: "/trend/vo2max",
      leanMass: "/trend/lean_mass",
    });
  });
});

describe("getBloodOxygen", () => {
  it("last night: minute readings across the main sleep with gaps, the low marked, the average Health Monitor shows, 30 nightly averages", async () => {
    const ctx = ctxFor(db);
    const vm = await getBloodOxygen(today, ctx);
    const night = vm.night.value!;
    expect(vm.isToday).toBe(true);
    expect(vm.average.value).toBe((await getMonitor(today, ctx)).vitals.find((v) => v.key === "spo2")!.metric.value);
    expect(vm.chip).toEqual((await getMonitor(today, ctx)).vitals.find((v) => v.key === "spo2")!.chip);
    // One point a minute from 15 minutes before bed to 15 after waking; the band reads only asleep, so the ends are gaps.
    expect(night.points[0].t).toBe(night.bed - 15 * 60_000);
    expect(night.points.at(-1)!.t).toBe(night.wake + 15 * 60_000 - 60_000);
    expect(night.points.slice(0, 15).every((p) => p.v === null)).toBe(true);
    const read = night.points.filter((p) => p.v !== null);
    expect(read.length).toBe(night.readMin);
    expect(night.readMin).toBeGreaterThan(200);
    expect(night.readMin).toBeLessThan((night.wake - night.bed) / 60_000); // gaps: minutes the band could not read
    expect(night.low).toEqual(read.reduce<{ t: number; v: number }>((m, p) => (p.v! < m.v ? { t: p.t, v: p.v! } : m), { t: 0, v: Infinity }));
    expect(night.below95Min).toBe(read.filter((p) => p.v! < 95).length);
    expect(read.every((p) => p.v! >= 85 && p.v! <= 100)).toBe(true);
    // The week ends on the shown night, whose row agrees with the hero.
    expect(vm.nights.map((n) => n.day)).toEqual(Array.from({ length: 7 }, (_, k) => dayAt(SEED_DAYS - 7 + k)));
    expect(vm.nights.at(-1)).toEqual({ day: today, average: vm.average.value, low: night.low.v, below95Min: night.below95Min });
    expect(vm.nights.every((n) => n.average !== null && n.low !== null)).toBe(true);
  });

  it("the illness peak reads lower than a healthy night, with minutes under 95%", async () => {
    const ill = await getBloodOxygen(dayAt(SCENARIO.illness.start + 3), ctxFor(db));
    const well = await getBloodOxygen(dayAt(100), ctxFor(db));
    expect(ill.average.value!).toBeLessThan(well.average.value!);
    expect(ill.night.value!.below95Min).toBeGreaterThan(well.night.value!.below95Min);
    expect(ill.isToday).toBe(false);
  });

  it("a band-off night has no average or readings, with the night's reason; a night with no samples is no_data", async () => {
    const off = await getBloodOxygen(dayAt(SCENARIO.bandOff.day + 1), ctxFor(db));
    expect(off.average).toMatchObject({ value: null, reason: "band_not_worn" });
    expect(off.night).toMatchObject({ value: null, reason: "band_not_worn" });
    expect(off.nights.at(-1)).toEqual({ day: dayAt(SCENARIO.bandOff.day + 1), average: null, low: null, below95Min: null });
    expect(off.nights[0].low).not.toBeNull();
    const db2 = await copyDb(db);
    await db2.execute("delete from spo2_days");
    const none = await getBloodOxygen(today, ctxFor(db2));
    expect(none.night).toMatchObject({ value: null, reason: "no_data" });
    expect(none.average.value).not.toBeNull(); // Google's nightly value still stands without the samples
  });

  it("the hub card carries last night's average and low", async () => {
    const hub = await getHealthHub(ctxFor(db));
    const vm = await getBloodOxygen(today, ctxFor(db));
    expect(hub.bloodOxygen).toEqual({ average: vm.average.value, low: vm.night.value!.low.v, wake: vm.night.value!.wake });
  });
});
