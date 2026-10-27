import { describe, expect, it, vi } from "vitest";
import { openerIdeas, rankVenues } from "@/lib/context";
import { DEMO_DATES, DEMO_MARKET, DEMO_TARGET, createDemoProvider } from "@/lib/demo/provider";
import { getMarket } from "@/lib/markets";
import { runAnalysis } from "@/lib/pipeline";
import { planRun, type CityNights } from "@/lib/tour";
import type { HeatCell } from "@/lib/types";
import { memoryKv } from "@/lib/watch/kv-core";
import { warmMarket } from "@/lib/watch/warm";

const nights = (rows: [string, number][]) => rows.map(([date, rank]) => ({ date, score: rank, rank, baselineRank: rows.length + 1 - rank }));

describe("run planner", () => {
  it("gives every city its best night when they don't collide", () => {
    const cities: CityNights[] = [
      { marketId: "a", label: "A", nights: nights([["2027-03-05", 1], ["2027-03-06", 2]]) },
      { marketId: "b", label: "B", nights: nights([["2027-03-12", 1], ["2027-03-13", 2]]) },
    ];
    const plan = planRun(cities, 2)!;
    expect(plan.allBest).toBe(true);
    expect(plan.stops.map((s) => [s.marketId, s.date])).toEqual([
      ["a", "2027-03-05"],
      ["b", "2027-03-12"],
    ]);
  });

  it("resolves a collision at the lowest total rank cost, respecting the gap", () => {
    const cities: CityNights[] = [
      // Both want Mar 5; A's second choice is much worse than B's.
      { marketId: "a", label: "A", nights: nights([["2027-03-05", 1], ["2027-03-20", 2], ["2027-03-21", 3]]) },
      { marketId: "b", label: "B", nights: nights([["2027-03-05", 1], ["2027-03-07", 2], ["2027-03-21", 3]]) },
    ];
    const plan = planRun(cities, 2)!;
    const at = Object.fromEntries(plan.stops.map((s) => [s.marketId, s.date]));
    expect(at.a).toBe("2027-03-05");
    expect(at.b).toBe("2027-03-07");
    expect(plan.allBest).toBe(false);
    // With a 3-day gap Mar 7 is too close, so B moves further out.
    const wide = planRun(cities, 3)!;
    const atWide = Object.fromEntries(wide.stops.map((s) => [s.marketId, s.date]));
    expect(Math.abs(Date.parse(atWide.a) - Date.parse(atWide.b)) / 86_400_000).toBeGreaterThanOrEqual(3);
  });

  it("matches brute force on random cases and returns null when nothing fits", () => {
    let seed = 3;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let t = 0; t < 40; t++) {
      const days = Array.from({ length: 8 }, (_, i) => `2027-04-${String(i * 2 + 1).padStart(2, "0")}`);
      const cities: CityNights[] = [0, 1, 2].map((c) => {
        const shuffled = [...days].sort(() => rnd() - 0.5);
        return { marketId: `c${c}`, label: `C${c}`, nights: shuffled.map((d, i) => ({ date: d, score: i, rank: i + 1, baselineRank: 1 })) };
      });
      const plan = planRun(cities, 3)!;
      let best = Infinity;
      for (const a of cities[0].nights)
        for (const b of cities[1].nights)
          for (const c of cities[2].nights) {
            const ds = [a.date, b.date, c.date].map((x) => Date.parse(x) / 86_400_000);
            if (Math.abs(ds[0] - ds[1]) < 3 || Math.abs(ds[0] - ds[2]) < 3 || Math.abs(ds[1] - ds[2]) < 3) continue;
            best = Math.min(best, (a.rank - 1 + b.rank - 1 + c.rank - 1) / 7);
          }
      expect(plan.cost).toBeCloseTo(best, 10);
    }
    const tight: CityNights[] = [
      { marketId: "a", label: "A", nights: nights([["2027-03-05", 1]]) },
      { marketId: "b", label: "B", nights: nights([["2027-03-06", 1]]) },
    ];
    expect(planRun(tight, 2)).toBeNull();
  });
});

describe("venue picks", () => {
  it("ranks free venues by fan concentration and puts booked ones last", async () => {
    const out = await runAnalysis(createDemoProvider(), { artist: DEMO_TARGET, marketId: DEMO_MARKET, candidateDates: DEMO_DATES });
    if (out.kind !== "result") throw new Error("expected result");
    const r = out.result;
    const d = r.dates.find((x) => x.date === "2027-05-15")!;
    // Synthetic heatmap: one cell on each venue, Larkspur strongest, Union weakest.
    const order = ["Union Ballroom", "Northgate Arena", "Riverside Pavilion", "Copper Lantern", "Marigold Theatre", "The Foundry Room", "Larkspur Hall"];
    const cells: HeatCell[] = order.map((name, i) => {
      const e = r.events.find((x) => x.venue.name === name)!;
      return { lat: e.venue.lat!, lng: e.venue.lng!, geohash: `g${i}`, affinity: i / (order.length - 1) };
    });
    const picks = rankVenues(r.events, d, cells, { radiusKm: 1, limit: 7 });
    // Larkspur has the most fans but is booked that night (Paper Lanterns), so it goes last.
    expect(picks[0].name).toBe("The Foundry Room");
    const lark = picks.find((p) => p.name === "Larkspur Hall")!;
    expect(lark).toMatchObject({ fans: 1, bookedBy: "Paper Lanterns" });
    expect(picks.at(-1)!.bookedBy).not.toBeNull();
    const free = picks.filter((p) => !p.bookedBy);
    expect(free.map((p) => p.fans)).toEqual([...free.map((p) => p.fans)].sort((a, b) => b - a));
    expect(picks.find((p) => p.name === "The Foundry Room")!.showsNearby).toBeGreaterThanOrEqual(0);
    expect(rankVenues(r.events, d, cells)).toHaveLength(5);
  });
});

describe("support-act ideas", () => {
  it("returns the demo artist's closest audiences, without the artist", async () => {
    const recs = (await openerIdeas(createDemoProvider(), "demo-juniper-static", getMarket("chicago")!))!;
    expect(recs[0].name).toBe("Paper Lanterns");
    expect(recs.some((r) => r.entityId === "demo-juniper-static")).toBe(false);
    expect(recs.map((r) => r.name)).toContain("Wren & the Lowlights");
  });
});

describe("cache warming", () => {
  it("searches each uncached performer once, then nothing on the second pass", async () => {
    const kv = memoryKv();
    const base = createDemoProvider();
    const spy = vi.spyOn(base, "searchArtists");
    const opts = { kv, provider: base, market: getMarket("chicago")!, from: "2027-05-01", weeks: 4, deadline: Date.now() + 10_000 };
    const first = await warmMarket(opts);
    expect(first.searched).toBe(first.performers);
    expect(first.alreadyCached).toBe(0);
    const calls = spy.mock.calls.length;
    const second = await warmMarket(opts);
    expect(second).toMatchObject({ alreadyCached: first.performers, searched: 0 });
    expect(spy.mock.calls.length).toBe(calls);
  });

  it("stops at the deadline and keeps what it found", async () => {
    const kv = memoryKv();
    const r = await warmMarket({ kv, provider: createDemoProvider(), market: getMarket("chicago")!, from: "2027-05-01", deadline: Date.now() - 1 });
    expect(r.stoppedEarly).toBe(true);
    expect(r.searched).toBe(0);
  });
});
