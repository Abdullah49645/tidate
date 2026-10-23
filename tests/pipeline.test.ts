import { describe, expect, it } from "vitest";
import { DEMO_DATES, DEMO_MARKET, DEMO_TARGET, createDemoProvider } from "@/lib/demo/provider";
import { UpstreamError } from "@/lib/http/fetch";
import { rebuildScoringInputs, runAnalysis, type DataProvider, type ProgressEvent } from "@/lib/pipeline";
import { classifyMatch } from "@/lib/qloo/resolve";
import { scoreDates } from "@/lib/scoring/engine";

const demoReq = { artist: DEMO_TARGET, marketId: DEMO_MARKET, candidateDates: DEMO_DATES };

describe("pipeline on the fictional demo scenario", () => {
  it("runs every step and returns a ranked, explained result", async () => {
    const progress: ProgressEvent[] = [];
    const out = await runAnalysis(createDemoProvider(), demoReq, (e) => progress.push(e));
    expect(out.kind).toBe("result");
    if (out.kind !== "result") return;
    const r = out.result;
    expect(r.mode).toBe("demo");
    expect(new Set(progress.map((p) => p.step))).toEqual(new Set(["validate", "target", "events", "performers", "affinity", "score", "verify"]));
    expect(progress.some((p) => p.status === "error")).toBe(false);

    // Busy night of low-affinity shows is lower risk than the night with one strongly overlapping act.
    expect(r.verdict.recommendedDate).toBe("2027-05-08");
    const byDate = Object.fromEntries(r.dates.map((d) => [d.date, d]));
    expect(byDate["2027-05-15"].rank).toBe(3);
    expect(r.verdict.baselineAgrees).toBe(false);
    expect(r.verdict.robust).toBe(true);

    // Exclusions are explicit.
    const reasons = r.excluded.map((x) => x.reason).sort();
    expect(reasons).toEqual(["canceled", "date-tba", "duplicate"]);

    // Ambiguous and unmatched names are not scored.
    expect(r.resolutions["echo"].status).toBe("ambiguous");
    expect(r.resolutions["decades revue a tribute to the 80s"].status).toBe("not-found");
    const allContribs = r.dates.flatMap((d) => d.contributions);
    expect(allContribs.filter((c) => c.performer === "Echo").every((c) => !c.scored)).toBe(true);
    expect(allContribs.some((c) => c.flags.includes("affinity-missing"))).toBe(true);
    expect(allContribs.some((c) => c.flags.includes("popularity-imputed"))).toBe(true);
    expect(allContribs.some((c) => c.flags.includes("rescheduled"))).toBe(true);

    // Every date's breakdown sums to its total.
    for (const d of r.dates) {
      expect(Math.abs(d.contributions.reduce((s, c) => s + (c.contribution ?? 0), 0) - d.score)).toBeLessThan(1e-12);
    }
    // The strongest single contributor on the 15th is the same-night high-affinity act.
    expect(byDate["2027-05-15"].contributions[0].performer).toBe("Paper Lanterns");
  });

  it("rebuilding inputs from a stored result reproduces the same scores", async () => {
    const out = await runAnalysis(createDemoProvider(), demoReq);
    if (out.kind !== "result") throw new Error("expected result");
    const { links, signals } = rebuildScoringInputs(out.result);
    const again = scoreDates({ candidateDates: out.result.request.candidateDates, events: out.result.events, links, signals });
    expect(again.map((d) => [d.date, d.score])).toEqual(out.result.dates.map((d) => [d.date, d.score]));
  });

  it("asks for clarification when the target name is ambiguous or unknown", async () => {
    const amb = await runAnalysis(createDemoProvider(), { ...demoReq, artist: "Echo" });
    expect(amb.kind).toBe("clarify");
    if (amb.kind === "clarify") expect(amb.target.candidates.length).toBe(2);
    const none = await runAnalysis(createDemoProvider(), { ...demoReq, artist: "Nobody Here" });
    expect(none.kind).toBe("clarify");
  });

  it("accepts a user-confirmed entity for an ambiguous name", async () => {
    const out = await runAnalysis(createDemoProvider(), { ...demoReq, artist: "Echo", artistEntityId: "demo-echo-a" });
    expect(out.kind).toBe("result");
    if (out.kind === "result") expect(out.result.target.status).toBe("confirmed");
  });

  it("rejects invalid requests before calling any service", async () => {
    let called = false;
    const spy: DataProvider = {
      ...createDemoProvider(),
      searchArtists: async () => {
        called = true;
        return [];
      },
    };
    const out = await runAnalysis(spy, { ...demoReq, candidateDates: ["2027-13-01"] });
    expect(out.kind).toBe("invalid");
    expect(called).toBe(false);
    const badMarket = await runAnalysis(spy, { ...demoReq, marketId: "atlantis" });
    expect(badMarket.kind).toBe("invalid");
  });
});

describe("pipeline failure handling never fabricates results", () => {
  it("returns an error when Ticketmaster fails", async () => {
    const p: DataProvider = {
      ...createDemoProvider(),
      searchEvents: async () => {
        throw new UpstreamError("ticketmaster", 503, "Ticketmaster event search: HTTP 503");
      },
    };
    const out = await runAnalysis(p, demoReq);
    expect(out.kind).toBe("error");
    if (out.kind === "error") expect(out.step).toBe("events");
  });

  it("returns an error when the Qloo affinity call fails", async () => {
    const p: DataProvider = {
      ...createDemoProvider(),
      affinities: async () => {
        throw new UpstreamError("qloo", 429, "Qloo insights (affinity): HTTP 429");
      },
    };
    const out = await runAnalysis(p, demoReq);
    expect(out.kind).toBe("error");
    if (out.kind === "error") {
      expect(out.step).toBe("affinity");
      expect(out.message).toMatch(/rather than guessing/);
    }
  });

  it("returns an error when the target artist lookup fails", async () => {
    const p: DataProvider = {
      ...createDemoProvider(),
      searchArtists: async () => {
        throw new UpstreamError("qloo", 401, "Qloo artist search: HTTP 401");
      },
    };
    const out = await runAnalysis(p, demoReq);
    expect(out.kind).toBe("error");
  });

  it("reports zero-evidence scores as such when Qloo returns no affinities", async () => {
    const base = createDemoProvider();
    const p: DataProvider = {
      ...base,
      affinities: async (t, ids) => {
        const r = await base.affinities(t, ids);
        for (const k of Object.keys(r)) r[k] = { ...r[k], affinity: null };
        return r;
      },
    };
    const out = await runAnalysis(p, demoReq);
    expect(out.kind).toBe("result");
    if (out.kind !== "result") return;
    expect(out.result.diagnostics.some((d) => d.code === "qloo-no-affinity")).toBe(true);
    expect(out.result.dates.every((d) => d.score === 0 && d.evidence === "weak")).toBe(true);
    expect(out.result.verdict.robust).toBe(false);
  });

  it("reports an empty calendar as no competition found, not as safe", async () => {
    const p: DataProvider = {
      ...createDemoProvider(),
      searchEvents: async () => ({ events: [], pagesFetched: 1, totalReported: 0, truncated: false, malformed: 0 }),
    };
    const out = await runAnalysis(p, demoReq);
    expect(out.kind).toBe("result");
    if (out.kind === "result") {
      expect(out.result.dates.every((d) => d.evidence === "no-competition-found")).toBe(true);
      expect(out.result.dates[0].explanation).toMatch(/Ticketmaster coverage only/);
    }
  });
});

describe("artist match policy", () => {
  const c = (name: string, popularity: number | null, id = name) => ({ entityId: id, name, popularity, disambiguation: null });
  it("classifies exact, dominant namesake, ambiguous, weak and not-found", () => {
    expect(classifyMatch("Clairo", [c("Clairo", 0.9)]).status).toBe("exact");
    expect(classifyMatch("The National", [c("National", 0.8)]).status).toBe("exact"); // leading "the" ignored
    expect(classifyMatch("Beyoncé", [c("Beyonce", 0.99)]).status).toBe("exact"); // accents
    expect(classifyMatch("Bush", [c("Bush", 0.9, "a"), c("Bush", 0.3, "b")]).status).toBe("exact");
    expect(classifyMatch("Bush", [c("Bush", 0.6, "a"), c("Bush", 0.5, "b")]).status).toBe("ambiguous");
    expect(classifyMatch("Taylor Swift Tribute Night", [c("Taylor Swift", 0.99)]).status).toBe("weak");
    expect(classifyMatch("Anyone", []).status).toBe("not-found");
  });
});

describe("performer from event title", () => {
  it("takes the part before common separators", async () => {
    const { performerFromTitle } = await import("@/lib/pipeline");
    expect(performerFromTitle("Clairo - Charm Tour")).toBe("Clairo");
    expect(performerFromTitle("Clairo: Charm Tour 2027")).toBe("Clairo");
    expect(performerFromTitle("Phoebe Bridgers with Special Guests")).toBe("Phoebe Bridgers");
    expect(performerFromTitle("Laufey (Late Show)")).toBe("Laufey");
    expect(performerFromTitle("The Japanese House | Live")).toBe("The Japanese House");
    expect(performerFromTitle("x")).toBeNull();
  });
});

describe("bill splitting", () => {
  it("splits multi-act names and drops placeholders", async () => {
    const { splitBill } = await import("@/lib/pipeline");
    expect(splitBill("Ok Goodnight, Snooze, Eve")).toEqual(["Ok Goodnight", "Snooze", "Eve"]);
    expect(splitBill("Solo Kei, Jiwon, Tba")).toEqual(["Solo Kei", "Jiwon"]);
    expect(splitBill("Band A / Band B")).toEqual(["Band A", "Band B"]);
    expect(splitBill("Mike and Joe")).toEqual([]);
    expect(splitBill("Earth, Wind & Fire")).toEqual(["Earth", "Wind & Fire"]);
  });

  it("only scores split parts that match exactly, and only when the full name didn't", async () => {
    const { runAnalysis } = await import("@/lib/pipeline");
    const base = createDemoProvider();
    const p: DataProvider = {
      ...base,
      searchEvents: async (x) => {
        const r = await base.searchEvents(x);
        const e = r.events.find((ev) => ev.eventId === "demo-e01")!;
        // A bill listed as one attraction: "Morrow & Finch, Some Local Act"
        e.performers = [{ attractionId: null, name: "Morrow & Finch, Some Local Act", genre: null }];
        return r;
      },
    };
    const out = await runAnalysis(p, demoReq);
    if (out.kind !== "result") throw new Error("expected result");
    const ev = out.result.events.find((e) => e.eventId === "demo-e01")!;
    expect(ev.performers.map((x) => x.name)).toEqual(["Morrow & Finch, Some Local Act", "Morrow & Finch"]);
    const c = out.result.dates.flatMap((d) => d.contributions).find((x) => x.eventId === "demo-e01")!;
    expect(c.scored).toBe(true);
    expect(c.performer).toBe("Morrow & Finch");
  });
});

describe("title separators seen in live Ticketmaster data", () => {
  it("handles w., x and presented by", async () => {
    const { performerFromTitle } = await import("@/lib/pipeline");
    expect(performerFromTitle("Ben Kweller w. Case Oats - NYE Show")).toBe("Ben Kweller");
    expect(performerFromTitle("Pivot Gang x Saba - John Walt Day")).toBe("Pivot Gang");
    expect(performerFromTitle("Anna von Hausswolff presented by Thalia Hall")).toBe("Anna von Hausswolff");
  });
});
