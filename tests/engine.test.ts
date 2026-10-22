import { describe, expect, it } from "vitest";
import {
  IMPUTED_POPULARITY,
  addDays,
  buildVerdict,
  dayDiff,
  diffDates,
  prepareEvents,
  scoreDates,
  temporalWeight,
  type PerformerLink,
  type SignalLookup,
} from "@/lib/scoring/engine";
import { AnalysisRequestSchema } from "@/lib/types";
import { ev } from "./helpers";

const D = "2027-05-16";

function linksFor(events: ReturnType<typeof ev>[], resolved = true): Record<string, PerformerLink[]> {
  return Object.fromEntries(
    events.map((e) => [e.eventId, e.performers.map((p) => ({ name: p.name, entityId: resolved ? `Q-${p.name}` : null }))]),
  );
}

function sig(map: Record<string, [number | null, number | null]>): Record<string, SignalLookup> {
  return Object.fromEntries(Object.entries(map).map(([k, [a, p]]) => [`Q-${k}`, { affinity: a, popularity: p }]));
}

describe("temporal weight", () => {
  it("follows the documented bands", () => {
    expect(temporalWeight(0)).toBe(1);
    expect(temporalWeight(1)).toBe(0.7);
    expect(temporalWeight(-2)).toBe(0.7);
    expect(temporalWeight(3)).toBe(0.4);
    expect(temporalWeight(7)).toBe(0.4);
    expect(temporalWeight(8)).toBe(0.15);
    expect(temporalWeight(14)).toBe(0.15);
    expect(temporalWeight(15)).toBe(0);
    expect(temporalWeight(Number.NaN)).toBe(0);
  });

  it("is symmetric and never increases with distance", () => {
    for (let d = 0; d < 40; d++) {
      expect(temporalWeight(d)).toBe(temporalWeight(-d));
      expect(temporalWeight(d + 1)).toBeLessThanOrEqual(temporalWeight(d));
    }
  });

  it("computes calendar day differences across month and DST boundaries", () => {
    expect(dayDiff("2027-03-13", "2027-03-15")).toBe(2); // US DST change
    expect(dayDiff("2027-10-30", "2027-11-02")).toBe(3);
    expect(dayDiff("2028-02-28", "2028-03-01")).toBe(2); // leap year
    expect(addDays("2027-12-31", 1)).toBe("2028-01-01");
  });
});

describe("scoreDates", () => {
  it("scores zero with no competing events and reports no competition found", () => {
    const [d] = scoreDates({ candidateDates: [D], events: [], links: {}, signals: {} });
    expect(d.score).toBe(0);
    expect(d.inWindowEvents).toBe(0);
    expect(d.evidence).toBe("no-competition-found");
    expect(d.explanation).toMatch(/Ticketmaster coverage only/);
  });

  it("one highly affiliated same-day act contributes affinity x popularity", () => {
    const e = ev({ performer: "Big", date: D });
    const [d] = scoreDates({ candidateDates: [D], events: [e], links: linksFor([e]), signals: sig({ Big: [0.9, 0.8] }) });
    expect(d.score).toBeCloseTo(0.72, 10);
    expect(d.contributions[0].temporalWeight).toBe(1);
    expect(d.evidence).toBe("strong");
  });

  it("several moderate acts can outweigh one strong act", () => {
    const strong = ev({ performer: "Strong", date: D });
    const mods = [1, 2, 3].map((i) => ev({ performer: `Mod${i}`, date: D }));
    const signals = sig({ Strong: [0.9, 0.5], Mod1: [0.5, 0.5], Mod2: [0.5, 0.5], Mod3: [0.5, 0.5] });
    const [a] = scoreDates({ candidateDates: [D], events: [strong], links: linksFor([strong]), signals });
    const [b] = scoreDates({ candidateDates: [D], events: mods, links: linksFor(mods), signals });
    expect(b.score).toBeGreaterThan(a.score);
  });

  it("an event closer in time never contributes less, all else equal", () => {
    for (let k = 0; k < 16; k++) {
      const near = ev({ performer: "X", date: addDays(D, k) });
      const far = ev({ performer: "X", date: addDays(D, k + 1) });
      const signals = sig({ X: [0.7, 0.6] });
      const [sn] = scoreDates({ candidateDates: [D], events: [near], links: linksFor([near]), signals });
      const [sf] = scoreDates({ candidateDates: [D], events: [far], links: linksFor([far]), signals });
      expect(sn.score).toBeGreaterThanOrEqual(sf.score);
    }
  });

  it("is monotone non-decreasing in affinity and popularity", () => {
    const e = ev({ performer: "M", date: addDays(D, 1) });
    let prev = -1;
    for (const a of [0, 0.1, 0.3, 0.5, 0.8, 1]) {
      const [s] = scoreDates({ candidateDates: [D], events: [e], links: linksFor([e]), signals: sig({ M: [a, 0.6] }) });
      expect(s.score).toBeGreaterThanOrEqual(prev);
      prev = s.score;
    }
    prev = -1;
    for (const p of [0, 0.2, 0.6, 1]) {
      const [s] = scoreDates({ candidateDates: [D], events: [e], links: linksFor([e]), signals: sig({ M: [0.6, p] }) });
      expect(s.score).toBeGreaterThanOrEqual(prev);
      prev = s.score;
    }
  });

  it("imputes a neutral size weight when popularity is missing, and flags it", () => {
    const e = ev({ performer: "NoPop", date: D });
    const [d] = scoreDates({ candidateDates: [D], events: [e], links: linksFor([e]), signals: sig({ NoPop: [0.8, null] }) });
    expect(d.score).toBeCloseTo(0.8 * IMPUTED_POPULARITY, 10);
    expect(d.contributions[0].flags).toContain("popularity-imputed");
    expect(d.contributions[0].popularity).toBeNull();
  });

  it("does not invent affinity: missing affinity leaves the event unscored and flagged", () => {
    const e = ev({ performer: "NoAff", date: D });
    const [d] = scoreDates({ candidateDates: [D], events: [e], links: linksFor([e]), signals: sig({ NoAff: [null, 0.9] }) });
    expect(d.score).toBe(0);
    expect(d.contributions[0].scored).toBe(false);
    expect(d.contributions[0].flags).toContain("affinity-missing");
    expect(d.evidence).toBe("weak");
    expect(d.upperBound).toBe(1); // worst case at same-day weight
  });

  it("unresolved performers are excluded from the score and flagged", () => {
    const e = ev({ performer: "Mystery", date: addDays(D, 2) });
    const [d] = scoreDates({ candidateDates: [D], events: [e], links: linksFor([e], false), signals: {} });
    expect(d.score).toBe(0);
    expect(d.contributions[0].flags).toContain("unresolved-performer");
    expect(d.upperBound).toBeCloseTo(0.7, 10);
  });

  it("uses the strongest resolved performer on a multi-act bill", () => {
    const e = ev({
      date: D,
      performers: [
        { attractionId: "a1", name: "Headliner", genre: null },
        { attractionId: "a2", name: "Opener", genre: null },
      ],
    });
    const [d] = scoreDates({
      candidateDates: [D],
      events: [e],
      links: linksFor([e]),
      signals: sig({ Headliner: [0.2, 0.9], Opener: [0.9, 0.5] }),
    });
    expect(d.contributions[0].performer).toBe("Opener");
    expect(d.score).toBeCloseTo(0.45, 10);
  });

  it("contribution breakdown sums exactly to the total", () => {
    const events = Array.from({ length: 25 }, (_, i) => ev({ performer: `P${i}`, date: addDays(D, (i % 29) - 14) }));
    const signals = sig(Object.fromEntries(events.map((e, i) => [e.performers[0].name, [((i * 37) % 100) / 100, ((i * 53) % 100) / 100]])));
    const dates = [D, addDays(D, 7), addDays(D, 14)];
    for (const d of scoreDates({ candidateDates: dates, events, links: linksFor(events), signals })) {
      const sum = d.contributions.reduce((s, c) => s + (c.contribution ?? 0), 0);
      expect(Math.abs(sum - d.score)).toBeLessThan(1e-12);
      expect(d.upperBound).toBeGreaterThanOrEqual(d.score);
    }
  });

  it("is deterministic and independent of input event order", () => {
    const events = Array.from({ length: 12 }, (_, i) => ev({ performer: `O${i}`, date: addDays(D, i - 6) }));
    const signals = sig(Object.fromEntries(events.map((e, i) => [e.performers[0].name, [0.1 * (i % 10), 0.5]])));
    const a = scoreDates({ candidateDates: [D, addDays(D, 3)], events, links: linksFor(events), signals });
    const b = scoreDates({ candidateDates: [D, addDays(D, 3)], events: [...events].reverse(), links: linksFor(events), signals });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("ranks multiple candidate dates by score and computes a count baseline over the same window", () => {
    const hot = ev({ performer: "Hot", date: "2027-05-09" });
    const many = [1, 2, 3].map((i) => ev({ performer: `Cold${i}`, date: "2027-05-23" }));
    const events = [hot, ...many];
    const signals = sig({ Hot: [0.95, 0.9], Cold1: [0.05, 0.9], Cold2: [0.05, 0.9], Cold3: [0.05, 0.9] });
    const res = scoreDates({ candidateDates: ["2027-05-09", "2027-05-23"], events, links: linksFor(events), signals });
    const byDate = Object.fromEntries(res.map((d) => [d.date, d]));
    // Qloo-weighted: the single strongly-affiliated show is riskier than three unrelated ones.
    expect(byDate["2027-05-23"].rank).toBe(1);
    // Count baseline: three shows look riskier than one.
    expect(byDate["2027-05-09"].baselineRank).toBe(1);
    const verdict = buildVerdict(res);
    expect(verdict.recommendedDate).toBe("2027-05-23");
    expect(verdict.baselineAgrees).toBe(false);
    expect(verdict.summary).toMatch(/plain count/);
  });

  it("ignoring an event recomputes the score without it", () => {
    const a = ev({ performer: "A", date: D });
    const b = ev({ performer: "B", date: D });
    const signals = sig({ A: [0.5, 1], B: [0.5, 1] });
    const [full] = scoreDates({ candidateDates: [D], events: [a, b], links: linksFor([a, b]), signals });
    const [less] = scoreDates({ candidateDates: [D], events: [a, b], links: linksFor([a, b]), signals, ignoredEventIds: [b.eventId] });
    expect(full.score).toBeCloseTo(1, 10);
    expect(less.score).toBeCloseTo(0.5, 10);
  });

  it("clamps out-of-range signals to [0,1]", () => {
    const e = ev({ performer: "Weird", date: D });
    const [d] = scoreDates({ candidateDates: [D], events: [e], links: linksFor([e]), signals: sig({ Weird: [1.7, -3] }) });
    expect(d.score).toBe(0);
    expect(d.contributions[0].affinity).toBe(1);
  });
});

describe("prepareEvents", () => {
  it("excludes the target act, cancelled, postponed and TBA events, and de-duplicates", () => {
    const own = ev({ performer: "Clairo" });
    const cancelled = ev({ status: "canceled" });
    const postponed = ev({ status: "postponed" });
    const tba = ev({ date: null });
    const show = ev({ performer: "Real", venue: "Hall" });
    const dupe = ev({ performer: "Real", venue: "Hall" });
    dupe.performers = show.performers;
    const res = prepareEvents([own, cancelled, postponed, tba, show, dupe], { targetNames: ["clairo"] });
    expect(res.eligible.map((e) => e.eventId)).toEqual([show.eventId]);
    expect(res.excluded.map((x) => x.reason).sort()).toEqual(["canceled", "date-tba", "duplicate", "postponed", "target-act"]);
  });

  it("keeps rescheduled events at their current date and flags them when scored", () => {
    const r = ev({ performer: "Moved", status: "rescheduled", date: D });
    const { eligible } = prepareEvents([r], { targetNames: ["someone else"] });
    expect(eligible).toHaveLength(1);
    const [d] = scoreDates({ candidateDates: [D], events: eligible, links: linksFor(eligible), signals: sig({ Moved: [0.5, 0.5] }) });
    expect(d.contributions[0].flags).toContain("rescheduled");
  });
});

describe("verdict robustness", () => {
  it("is robust when unscored events could not overturn the ranking", () => {
    const a = ev({ performer: "A", date: "2027-05-09" });
    const unk = ev({ performer: "Unknown", date: addDays("2027-05-23", 14) }); // weight 0.15 on the 23rd
    const big = ev({ performer: "Big", date: "2027-05-09" });
    const events = [a, unk, big];
    const links = { ...linksFor([a, big]), [unk.eventId]: [{ name: "Unknown", entityId: null }] };
    const res = scoreDates({ candidateDates: ["2027-05-09", "2027-05-23"], events, links, signals: sig({ A: [0.9, 0.9], Big: [0.9, 0.9] }) });
    const v = buildVerdict(res);
    expect(v.recommendedDate).toBe("2027-05-23");
    expect(v.robust).toBe(true);
  });

  it("is not robust when an unscored same-day event could flip it, and says so", () => {
    const a = ev({ performer: "A", date: "2027-05-09" });
    const unk = ev({ performer: "Unknown", date: "2027-05-23" });
    const events = [a, unk];
    const links = { ...linksFor([a]), [unk.eventId]: [{ name: "Unknown", entityId: null }] };
    const res = scoreDates({ candidateDates: ["2027-05-09", "2027-05-23"], events, links, signals: sig({ A: [0.6, 0.5] }) });
    const v = buildVerdict(res);
    expect(v.recommendedDate).toBe("2027-05-23");
    expect(v.robust).toBe(false);
    expect(v.whatWouldChange.join(" ")).toMatch(/could not be scored/);
  });

  it("names the single event whose removal would flip the ranking", () => {
    const a = ev({ performer: "Driver", date: "2027-05-09" });
    const b = ev({ performer: "Small", date: "2027-05-23" });
    const res = scoreDates({
      candidateDates: ["2027-05-09", "2027-05-23"],
      events: [a, b],
      links: linksFor([a, b]),
      signals: sig({ Driver: [0.9, 0.9], Small: [0.3, 0.3] }),
    });
    const v = buildVerdict(res);
    expect(v.whatWouldChange.some((s) => s.includes("Driver") && s.includes("2027-05-09 would rank first"))).toBe(true);
  });

  it("only claims a flip that survives removing the show from every date's window", () => {
    // "Shared" is near both dates; removing it lowers both, so it cannot flip the ranking.
    const shared = ev({ performer: "Shared", date: "2027-05-12" });
    const small = ev({ performer: "Small", date: "2027-05-09" });
    const res = scoreDates({
      candidateDates: ["2027-05-09", "2027-05-16"],
      events: [shared, small],
      links: linksFor([shared, small]),
      signals: sig({ Shared: [0.9, 0.9], Small: [0.2, 0.5] }),
    });
    const v = buildVerdict(res);
    const loser = res.find((d) => d.rank === 2)!;
    // Verify every claimed flip by actually re-scoring without that show.
    for (const claim of v.whatWouldChange.filter((s) => s.includes("would rank first"))) {
      const ev0 = [shared, small].find((e) => claim.includes(e.performers[0].name))!;
      const rerun = scoreDates({
        candidateDates: ["2027-05-09", "2027-05-16"],
        events: [shared, small],
        links: linksFor([shared, small]),
        signals: sig({ Shared: [0.9, 0.9], Small: [0.2, 0.5] }),
        ignoredEventIds: [ev0.eventId],
      });
      expect(buildVerdict(rerun).recommendedDate).toBe(loser.date);
    }
    expect(v.whatWouldChange.some((s) => s.includes("Shared"))).toBe(false);
  });

  it("every 'would rank first' claim in the demo is confirmed by re-scoring", async () => {
    const { createDemoProvider, DEMO_DATES } = await import("@/lib/demo/provider");
    const { runAnalysis, rebuildScoringInputs } = await import("@/lib/pipeline");
    const out = await runAnalysis(createDemoProvider(), { artist: "Juniper Static", marketId: "chicago", candidateDates: DEMO_DATES });
    if (out.kind !== "result") throw new Error("expected result");
    const r = out.result;
    const { links, signals } = rebuildScoringInputs(r);
    for (const d of r.dates) {
      for (const c of d.contributions) {
        const claim = r.verdict.whatWouldChange.find((s) => s.includes(`${c.performer} (${c.eventDate}`) && s.includes(`${d.date} would rank first`));
        if (!claim) continue;
        const re = scoreDates({ candidateDates: r.request.candidateDates, events: r.events, links, signals, ignoredEventIds: [c.eventId] });
        expect(buildVerdict(re).recommendedDate).toBe(d.date);
      }
    }
  });

  it("diffDates attributes the score difference to specific events", () => {
    const a = ev({ performer: "OnlyA", date: "2027-05-09" });
    const both = ev({ performer: "Both", date: "2027-05-16" });
    const res = scoreDates({
      candidateDates: ["2027-05-09", "2027-05-23"],
      events: [a, both],
      links: linksFor([a, both]),
      signals: sig({ OnlyA: [0.8, 0.5], Both: [0.5, 0.5] }),
    });
    const [x, y] = ["2027-05-09", "2027-05-23"].map((d) => res.find((r) => r.date === d)!);
    const rows = diffDates(x, y);
    const total = rows.reduce((s, r) => s + r.delta, 0);
    expect(total).toBeCloseTo(x.score - y.score, 12);
    expect(rows[0].performer).toBe("OnlyA");
  });
});

describe("request validation", () => {
  it("rejects invalid, duplicate and too many dates", () => {
    const base = { artist: "X", marketId: "chicago" };
    expect(AnalysisRequestSchema.safeParse({ ...base, candidateDates: ["2027-02-30"] }).success).toBe(false);
    expect(AnalysisRequestSchema.safeParse({ ...base, candidateDates: ["05/09/2027"] }).success).toBe(false);
    expect(AnalysisRequestSchema.safeParse({ ...base, candidateDates: [D, D] }).success).toBe(false);
    expect(AnalysisRequestSchema.safeParse({ ...base, candidateDates: [] }).success).toBe(false);
    expect(AnalysisRequestSchema.safeParse({ ...base, candidateDates: ["2027-01-01", "2027-01-02", "2027-01-03", "2027-01-04", "2027-01-05"] }).success).toBe(false);
    expect(AnalysisRequestSchema.safeParse({ ...base, candidateDates: [D] }).success).toBe(true);
  });
});
