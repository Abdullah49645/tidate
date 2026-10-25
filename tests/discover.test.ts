import { afterEach, describe, expect, it, vi } from "vitest";
import { affinityNear, fanMap, tasteOverlap } from "@/lib/context";
import { DEMO_MARKET, DEMO_TARGET, createDemoProvider } from "@/lib/demo/provider";
import { getMarket } from "@/lib/markets";
import { compactResult, hydrateResult, runAnalysis, runDiscovery, type DataProvider, type ProgressEvent } from "@/lib/pipeline";
import { sharedTaste, tagKey } from "@/lib/qloo/taste";
import { searchMusicEvents } from "@/lib/ticketmaster/client";
import { DiscoverRequestSchema, candidateNights, type TasteTag } from "@/lib/types";

const range = { artist: DEMO_TARGET, marketId: DEMO_MARKET, from: "2027-05-01", to: "2027-05-31", nights: "fri-sat" as const };

describe("candidate nights", () => {
  it("lists the matching weekdays in a range, inclusive", () => {
    expect(candidateNights("2027-05-01", "2027-05-15", "fri-sat")).toEqual(["2027-05-01", "2027-05-07", "2027-05-08", "2027-05-14", "2027-05-15"]);
    expect(candidateNights("2027-05-05", "2027-05-08", "thu-sat")).toEqual(["2027-05-06", "2027-05-07", "2027-05-08"]);
    expect(candidateNights("2027-05-01", "2027-05-03", "all")).toHaveLength(3);
  });

  it("rejects reversed, oversized or too-dense ranges", () => {
    const base = { artist: "A", marketId: "chicago" };
    expect(DiscoverRequestSchema.safeParse({ ...base, from: "2027-05-10", to: "2027-05-01" }).success).toBe(false);
    expect(DiscoverRequestSchema.safeParse({ ...base, from: "2027-01-01", to: "2027-04-30" }).success).toBe(false); // > 70 days
    expect(DiscoverRequestSchema.safeParse({ ...base, from: "2027-01-01", to: "2027-02-20", nights: "all" }).success).toBe(false); // > 40 nights
    expect(DiscoverRequestSchema.safeParse({ ...base, from: "2027-05-03", to: "2027-05-05" }).success).toBe(false); // no Fri/Sat
    expect(DiscoverRequestSchema.safeParse({ ...base, from: "2027-05-01", to: "2027-05-31" }).success).toBe(true);
  });
});

describe("date search on the fictional demo", () => {
  it("scores every Friday and Saturday in the range", async () => {
    const out = await runDiscovery(createDemoProvider(), range);
    expect(out.kind).toBe("result");
    if (out.kind !== "result") return;
    const r = out.result;
    expect(r.discover).toEqual({ from: "2027-05-01", to: "2027-05-31", nights: "fri-sat" });
    expect(r.dates.map((d) => d.date).sort()).toEqual(candidateNights("2027-05-01", "2027-05-31", "fri-sat"));
    expect(new Set(r.dates.map((d) => d.rank)).size).toBe(r.dates.length);
    // The 15th (the strongly overlapping act's night) is among the worst.
    const fifteenth = r.dates.find((d) => d.date === "2027-05-15")!;
    expect(fifteenth.rank).toBeGreaterThan(r.dates.length - 3);
    expect([...r.dates].sort((a, b) => a.rank - b.rank)[0].date).toBe(r.verdict.recommendedDate);
  });

  it("compacts for transport and hydrates back to identical scores and rows", async () => {
    const out = await runDiscovery(createDemoProvider(), range);
    if (out.kind !== "result") throw new Error("expected result");
    const small = compactResult(out.result);
    expect(small.compact).toBe(true);
    expect(small.dates.every((d) => d.contributions.length === 0)).toBe(true);
    const back = hydrateResult(JSON.parse(JSON.stringify(small)));
    expect(back.dates.map((d) => [d.date, d.score, d.rank, d.contributions.length])).toEqual(out.result.dates.map((d) => [d.date, d.score, d.rank, d.contributions.length]));
  });

  it("reports invalid ranges without calling any upstream", async () => {
    const spy = { ...createDemoProvider(), searchEvents: vi.fn() } as unknown as DataProvider;
    const out = await runDiscovery(spy, { ...range, to: "2027-04-01" });
    expect(out.kind).toBe("invalid");
    expect((spy.searchEvents as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });
});

describe("provisional ranking while lookups run", () => {
  it("streams partial rankings and reuses their affinities in the final step", async () => {
    const base = createDemoProvider();
    const affinityCalls: string[][] = [];
    const slow: DataProvider = {
      ...base,
      provisionalEveryMs: 1,
      searchArtists: async (n) => {
        await new Promise((r) => setTimeout(r, 4));
        return base.searchArtists(n);
      },
      affinities: async (t, ids) => {
        affinityCalls.push(ids);
        return base.affinities(t, ids);
      },
    };
    const events: ProgressEvent[] = [];
    const out = await runAnalysis(slow, { artist: DEMO_TARGET, marketId: DEMO_MARKET, candidateDates: ["2027-05-08", "2027-05-15", "2027-05-22"] }, (e) => events.push(e));
    expect(out.kind).toBe("result");
    const partial = events.filter((e) => e.provisional);
    expect(partial.length).toBeGreaterThan(0);
    for (const p of partial) {
      expect(p.provisional!.checked).toBeLessThan(p.provisional!.total);
      expect(p.provisional!.dates).toHaveLength(3);
    }
    // No entity is fetched twice.
    const all = affinityCalls.flat();
    expect(new Set(all).size).toBe(all.length);
    // Final scores are unaffected by the provisional passes.
    const plain = await runAnalysis(base, { artist: DEMO_TARGET, marketId: DEMO_MARKET, candidateDates: ["2027-05-08", "2027-05-15", "2027-05-22"] });
    if (out.kind === "result" && plain.kind === "result") expect(out.result.dates.map((d) => d.score)).toEqual(plain.result.dates.map((d) => d.score));
  });
});

describe("shared taste", () => {
  const t = (name: string, type: string): TasteTag => ({ id: name, name, type });
  it("compares genres and influences only, ignoring adjectives and spelling variants", () => {
    const target = [t("Rhythm & Blues", "urn:tag:genre"), t("Gospel", "urn:tag:genre:qloo"), t("Passionate", "urn:tag:audience:qloo"), t("American", "urn:tag:genre"), t("Stevie Wonder", "urn:tag:influenced_by:qloo")];
    const other = [t("R&B", "urn:tag:genre:qloo"), t("Passionate", "urn:tag:audience:qloo"), t("American", "urn:tag:genre"), t("Stevie Wonder", "urn:tag:influenced_by:qloo")];
    const s = sharedTaste("x", target, other);
    expect(s.checked).toBe(true);
    expect(s.shared).toEqual([
      { name: "Rhythm & Blues", kind: "genre" },
      { name: "Stevie Wonder", kind: "influence" },
    ]);
    expect(tagKey("Hip-Hop")).toBe(tagKey("hip hop"));
  });

  it("says nothing was checked when either side has no comparable tags", () => {
    expect(sharedTaste("x", [t("Loyal", "urn:tag:audience:qloo")], [t("Rock", "urn:tag:genre")]).checked).toBe(false);
    expect(sharedTaste("x", undefined, [t("Rock", "urn:tag:genre")]).checked).toBe(false);
  });

  it("works end to end on the demo catalogue", async () => {
    const rows = await tasteOverlap(createDemoProvider(), "demo-juniper-static", ["demo-paper-lanterns", "demo-iron-choir", "demo-juniper-static"]);
    expect(rows!.map((r) => r.entityId)).toEqual(["demo-paper-lanterns", "demo-iron-choir"]);
    expect(rows![0].shared.map((x) => x.name)).toEqual(["Indie Pop", "Bedroom Pop", "Marlowe Vance"]);
    expect(rows![1]).toMatchObject({ checked: true, shared: [] });
  });
});

describe("fan map", () => {
  it("returns rank-normalised cells for the demo artist and finds the nearest cell to a venue", async () => {
    const cells = (await fanMap(createDemoProvider(), "demo-juniper-static", getMarket("chicago")!, 30))!;
    expect(cells.length).toBeGreaterThan(100);
    expect(Math.min(...cells.map((c) => c.affinity))).toBe(0);
    expect(Math.max(...cells.map((c) => c.affinity))).toBe(1);
    const c = cells[10];
    expect(affinityNear(cells, c.lat + 0.001, c.lng)).toBe(c.affinity);
    expect(affinityNear(cells, 0, 0)).toBeNull();
  });
});

describe("Ticketmaster windows over the paging limit", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("splits a window reporting more than 1,000 events and merges the pieces", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(url);
        const u = new URL(url);
        const start = u.searchParams.get("startDateTime")!.slice(0, 10);
        const end = u.searchParams.get("endDateTime")!.slice(0, 10);
        const days = (Date.parse(end) - Date.parse(start)) / 86_400_000 + 1;
        const total = days * 120; // 120 events a day
        const body =
          total > 1000
            ? { page: { size: 200, totalElements: total, totalPages: Math.ceil(total / 200), number: 0 }, _embedded: { events: [] } }
            : {
                page: { size: 200, totalElements: total, totalPages: 1, number: 0 },
                _embedded: {
                  events: Array.from({ length: Math.min(total, 199) }, (_, i) => ({ id: `${start}-${i}`, name: `Show ${i}`, dates: { start: { localDate: start } } })),
                },
              };
        return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
      }),
    );
    const r = await searchMusicEvents("k", { market: getMarket("new-york")!, radiusMiles: 31, startDate: "2027-03-02", endDate: "2027-03-20" });
    expect(r.truncated).toBe(false);
    expect(urls.length).toBeGreaterThan(3);
    // Every leaf window fits under the limit; events are de-duplicated by id.
    expect(new Set(r.events.map((e) => e.eventId)).size).toBe(r.events.length);
    expect(r.events.length).toBeGreaterThan(0);
  });
});
