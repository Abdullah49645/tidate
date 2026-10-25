/**
 * Agent orchestration tests with a scripted mock model (no LLM calls).
 * They verify that the agent loop executes real tools against the shared
 * pipeline, that tool failures surface as errors, and that the deterministic
 * answer check corrects an answer that contradicts the engine.
 */
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { runAgent } from "@/lib/agent/agent";
import { createToolHandlers } from "@/lib/agent/tools";
import { verifyAgentAnswer } from "@/lib/agent/verify";
import { DEMO_DATES, DEMO_MARKET, DEMO_TARGET, createDemoProvider } from "@/lib/demo/provider";
import type { DataProvider } from "@/lib/pipeline";
import { memoryKv } from "@/lib/watch/kv";
import { createWatchService } from "@/lib/watch/service";

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 10, text: 10, reasoning: 0 },
};
const toolCall = (id: string, toolName: string, input: unknown) => ({
  content: [{ type: "tool-call" as const, toolCallId: id, toolName, input: JSON.stringify(input) }],
  finishReason: { unified: "tool-calls" as const, raw: undefined },
  usage,
  warnings: [],
});
const text = (t: string) => ({
  content: [{ type: "text" as const, text: t }],
  finishReason: { unified: "stop" as const, raw: undefined },
  usage,
  warnings: [],
});

function scripted(steps: ReturnType<typeof toolCall | typeof text>[]) {
  let i = 0;
  return new MockLanguageModelV4({
    doGenerate: async () => steps[Math.min(i++, steps.length - 1)] as never,
  });
}

const args = { artist: DEMO_TARGET, marketId: DEMO_MARKET, candidateDates: DEMO_DATES };

describe("agent tool loop", () => {
  it("calls real tools and returns the engine's analysis", async () => {
    const run = await runAgent({
      provider: createDemoProvider(),
      messages: [{ role: "user", content: "Which of May 8, 15 or 22 2027 is best for Juniper Static in Chicago?" }],
      previous: null,
      today: "2026-10-22",
      model: scripted([
        toolCall("c1", "analyze_candidate_dates", args),
        toolCall("c2", "explain_date", { date: "2027-05-08" }),
        text("May 8 has the lowest estimated clash risk (demo data). The busy night is mostly metal, country and EDM shows with low affinity."),
      ]),
    });
    expect(run.trace.map((t) => t.tool)).toEqual(["analyze_candidate_dates", "explain_date"]);
    expect(run.trace.every((t) => t.ok)).toBe(true);
    expect(run.analysis?.verdict.recommendedDate).toBe("2027-05-08");
    expect(run.verification).toMatchObject({ checked: true, mentionsRecommendation: true, corrected: false });
  });

  it("searches a range of nights and can explain any of them", async () => {
    const run = await runAgent({
      provider: createDemoProvider(),
      messages: [{ role: "user", content: "Find Juniper Static a Friday or Saturday in May 2027 in Chicago." }],
      previous: null,
      today: "2026-10-22",
      model: scripted([
        toolCall("c1", "find_best_nights", { artist: DEMO_TARGET, marketId: DEMO_MARKET, from: "2027-05-01", to: "2027-05-29" }),
        toolCall("c2", "explain_date", { date: "2027-05-22" }),
        text("Demo data: Sat, May 1 is the quietest night."),
      ]),
    });
    expect(run.trace.map((t) => [t.tool, t.ok])).toEqual([
      ["find_best_nights", true],
      ["explain_date", true],
    ]);
    expect(run.analysis?.discover).toEqual({ from: "2027-05-01", to: "2027-05-29", nights: "fri-sat" });
    expect(run.analysis?.dates).toHaveLength(9);
    expect(run.verification.mentionsRecommendation).toBe(run.analysis?.verdict.recommendedDate === "2027-05-01");
  });

  it("starts a watch for the latest analysis when asked", async () => {
    const svc = createWatchService({ kv: memoryKv(), alert: async () => null, now: () => new Date("2026-10-26T10:00:00Z") });
    const run = await runAgent({
      provider: createDemoProvider(),
      messages: [{ role: "user", content: "Score May 8, 15 and 22 2027 for Juniper Static in Chicago and keep an eye on them." }],
      previous: null,
      today: "2026-10-22",
      startWatch: (r) =>
        svc.create({ kind: "compare", mode: r.mode, request: { artist: r.request.artist, marketId: r.request.marketId, candidateDates: r.request.candidateDates } }),
      model: scripted([toolCall("c1", "analyze_candidate_dates", args), toolCall("c2", "watch_latest", {}), text("Demo data: Sat, May 8 is best, and I'm watching the dates.")]),
    });
    expect(run.trace.map((t) => [t.tool, t.ok])).toEqual([
      ["analyze_candidate_dates", true],
      ["watch_latest", true],
    ]);
    expect(run.watchId).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect((await svc.get(run.watchId!)).current.recommendedDate).toBe("2027-05-08");
  });

  it("appends the engine result when the model's answer contradicts it", async () => {
    const run = await runAgent({
      provider: createDemoProvider(),
      messages: [{ role: "user", content: "best date?" }],
      previous: null,
      today: "2026-10-22",
      model: scripted([toolCall("c1", "analyze_candidate_dates", args), text("Go with the 15th of the month.")]),
    });
    expect(run.verification.corrected).toBe(true);
    expect(run.text).toMatch(/Engine result: the lowest estimated clash risk is 2027-05-08/);
  });

  it("surfaces tool failures instead of fabricating an analysis", async () => {
    const failing: DataProvider = {
      ...createDemoProvider(),
      searchEvents: async () => {
        throw new Error("Ticketmaster event search: HTTP 503");
      },
    };
    const run = await runAgent({
      provider: failing,
      messages: [{ role: "user", content: "analyse" }],
      previous: null,
      today: "2026-10-22",
      model: scripted([toolCall("c1", "analyze_candidate_dates", args), text("Ticketmaster is unavailable right now, so I can't rank the dates.")]),
    });
    expect(run.analysis).toBeNull();
    expect(run.trace[0].ok).toBe(false);
    expect(run.verification.checked).toBe(false);
  });
});

describe("tool handlers", () => {
  it("explain/compare/what-if require an analysis and use engine numbers", async () => {
    const ctx = { provider: createDemoProvider(), latest: null, trace: [] };
    const h = createToolHandlers(ctx);
    await expect(h.explain_date({ date: "2027-05-08" })).rejects.toThrow(/No analysis yet/);
    await h.analyze_candidate_dates(args);
    const cmp = await h.compare_dates({ dateA: "2027-05-15", dateB: "2027-05-08" });
    expect("drivers" in cmp && cmp.drivers?.[0].performer).toBe("Paper Lanterns");
    const ex = await h.explain_date({ date: "2027-05-15" });
    const paperId = "topContributors" in ex ? ex.topContributors[0].eventId : "";
    const wi = await h.what_if_exclude({ eventIds: [paperId] });
    expect("dates" in wi).toBe(true);
    const bad = await h.what_if_exclude({ eventIds: ["nope"] });
    expect("error" in bad).toBe(true);
  });

  it("find_artist reports ambiguity with candidates", async () => {
    const h = createToolHandlers({ provider: createDemoProvider(), latest: null, trace: [] });
    const r = await h.find_artist({ name: "Echo" });
    expect("match" in r && r.match).toBe("ambiguous");
    expect("candidates" in r && r.candidates?.length).toBe(2);
  });

  it("verifyAgentAnswer recognises several date spellings", () => {
    const fake = { verdict: { recommendedDate: "2027-05-08", summary: "s" } } as never;
    for (const s of ["2027-05-08", "May 8", "may 8th", "8 May", "5/8"]) expect(verifyAgentAnswer(`pick ${s}`, fake).mentionsRecommendation).toBe(true);
    for (const s of ["June 8", "18 May", "May 18", "May 28", "15/8"]) expect(verifyAgentAnswer(`pick ${s}`, fake).mentionsRecommendation).toBe(false);
  });
});
