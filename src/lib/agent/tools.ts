/**
 * Agent tools. Each tool performs a real operation through the same pipeline
 * and engine used by the web UI and the MCP server. Tools return compact,
 * structured evidence; numbers come only from the engine.
 */
import { z } from "zod";
import { MARKETS } from "../markets";
import { classifyMatch } from "../qloo/resolve";
import { rebuildScoringInputs, runAnalysis, runDiscovery, type DataProvider } from "../pipeline";
import { buildVerdict, diffDates, scoreDates } from "../scoring/engine";
import { NIGHTS, type AnalysisResult, type DateScore } from "../types";

export interface ToolContext {
  provider: DataProvider;
  latest: AnalysisResult | null;
  trace: Array<{ tool: string; input: unknown; ok: boolean; summary: string }>;
}

const r3 = (x: number | null) => (x === null ? null : Math.round(x * 1000) / 1000);

export function summariseDate(d: DateScore, topN = 3) {
  return {
    date: d.date,
    rank: d.rank,
    clashScore: r3(d.score),
    worstCaseScore: r3(d.upperBound),
    baselineRank: d.baselineRank,
    nearbyShows: d.inWindowEvents,
    scoredShows: d.scoredEvents,
    evidence: d.evidence,
    topContributors: d.contributions
      .filter((c) => c.scored)
      .slice(0, topN)
      .map((c) => ({
        eventId: c.eventId,
        performer: c.performer,
        venue: c.venueName,
        eventDate: c.eventDate,
        daysApart: c.daysApart,
        affinity: r3(c.affinity),
        closerThanShareOfNearbyActs: c.relativeAffinity === null ? null : r3(c.relativeAffinity),
        popularity: c.popularity === null ? "imputed" : r3(c.popularity),
        contribution: r3(c.contribution),
      })),
    explanation: d.explanation,
  };
}

export function summariseResult(r: AnalysisResult) {
  return {
    mode: r.mode === "demo" ? "DEMO (fictional data)" : "live",
    artist: r.target.entity?.name,
    market: r.market.label,
    recommendation: r.verdict.recommendedDate,
    robustToMissingData: r.verdict.robust,
    holdsIfUnmatchedActsAreTypical: r.verdict.holdsIfTypical,
    countBaselineAgrees: r.verdict.baselineAgrees,
    summary: r.verdict.summary,
    whatWouldChange: r.verdict.whatWouldChange,
    dates: r.dates.map((d) => summariseDate(d)),
    diagnostics: r.diagnostics.map((d) => `${d.level}: ${d.message}`),
    excludedShows: r.excluded.length,
  };
}

/** A date search scores many nights: detail for the best few, one line for the rest. */
export function summariseDiscovery(r: AnalysisResult, detailed = 3) {
  const ordered = [...r.dates].sort((a, b) => a.rank - b.rank);
  const headcountBest = [...r.dates].sort((a, b) => a.baselineRank - b.baselineRank)[0];
  return {
    mode: r.mode === "demo" ? "DEMO (fictional data)" : "live",
    artist: r.target.entity?.name,
    market: r.market.label,
    searched: r.discover ? `${r.discover.from} to ${r.discover.to}, ${NIGHTS[r.discover.nights].label.toLowerCase()}` : null,
    nightsScored: r.dates.length,
    recommendation: r.verdict.recommendedDate,
    robustToMissingData: r.verdict.robust,
    holdsIfUnmatchedActsAreTypical: r.verdict.holdsIfTypical,
    headcountWouldPick: headcountBest?.date ?? null,
    summary: r.verdict.summary,
    bestNights: ordered.slice(0, detailed).map((d) => summariseDate(d)),
    allNights: ordered.map((d) => ({ date: d.date, rank: d.rank, clashScore: r3(d.score), baselineRank: d.baselineRank, evidence: d.evidence })),
    diagnostics: r.diagnostics.map((d) => `${d.level}: ${d.message}`),
  };
}

export const toolSchemas = {
  list_markets: z.object({}),
  find_artist: z.object({ name: z.string().min(1).describe("Artist name as the user wrote it") }),
  analyze_candidate_dates: z.object({
    artist: z.string().min(1),
    artistEntityId: z.string().optional().describe("Qloo entity id, only if the user picked one from find_artist candidates"),
    marketId: z.string().describe("One of the ids from list_markets"),
    candidateDates: z.array(z.string()).min(1).max(4).describe("YYYY-MM-DD dates the user is considering"),
  }),
  find_best_nights: z.object({
    artist: z.string().min(1),
    artistEntityId: z.string().optional().describe("Qloo entity id, only if the user picked one from find_artist candidates"),
    marketId: z.string().describe("One of the ids from list_markets"),
    from: z.string().describe("First night to consider, YYYY-MM-DD"),
    to: z.string().describe("Last night to consider, YYYY-MM-DD (at most 70 days after from)"),
    nights: z.enum(["fri-sat", "thu-sat", "all"]).optional().describe("Which nights of the week; default fri-sat"),
  }),
  explain_date: z.object({ date: z.string().describe("A candidate date from the latest analysis, YYYY-MM-DD") }),
  compare_dates: z.object({ dateA: z.string(), dateB: z.string() }),
  what_if_exclude: z.object({
    eventIds: z.array(z.string()).min(1).describe("eventIds from explain_date output to leave out, e.g. a show the user knows will move"),
  }),
};

type Schemas = typeof toolSchemas;
type In<K extends keyof Schemas> = z.infer<Schemas[K]>;

export function createToolHandlers(ctx: ToolContext) {
  const record = (tool: string, input: unknown, ok: boolean, summary: string) => ctx.trace.push({ tool, input, ok, summary });
  const needAnalysis = () => {
    if (!ctx.latest) throw new Error("No analysis yet. Call analyze_candidate_dates first.");
    return ctx.latest;
  };

  return {
    async list_markets() {
      record("list_markets", {}, true, `${MARKETS.length} markets`);
      return MARKETS.map((m) => ({ id: m.id, label: m.label }));
    },

    async find_artist({ name }: In<"find_artist">) {
      try {
        const candidates = await ctx.provider.searchArtists(name);
        const m = classifyMatch(name, candidates);
        record("find_artist", { name }, true, `${m.status}${m.entity ? `: ${m.entity.name}` : ""}`);
        return {
          match: m.status,
          resolved: m.entity ? { entityId: m.entity.entityId, name: m.entity.name } : null,
          note: m.note ?? null,
          candidates: candidates.slice(0, 5).map((c) => ({ entityId: c.entityId, name: c.name, popularity: r3(c.popularity), hint: c.disambiguation })),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : "lookup failed";
        record("find_artist", { name }, false, message);
        return { error: `Qloo lookup failed: ${message}` };
      }
    },

    async analyze_candidate_dates(input: In<"analyze_candidate_dates">) {
      const out = await runAnalysis(ctx.provider, { ...input, radiusMiles: 30 });
      if (out.kind === "result") {
        ctx.latest = out.result;
        record("analyze_candidate_dates", input, true, `recommend ${out.result.verdict.recommendedDate}`);
        return summariseResult(out.result);
      }
      if (out.kind === "clarify") {
        record("analyze_candidate_dates", input, true, "needs clarification");
        return {
          needsClarification: out.message,
          candidates: out.target.candidates.map((c) => ({ entityId: c.entityId, name: c.name, popularity: r3(c.popularity), hint: c.disambiguation })),
        };
      }
      record("analyze_candidate_dates", input, false, out.message);
      return out.kind === "invalid" ? { invalid: out.message, issues: out.issues } : { error: out.message, failedStep: out.step };
    },

    async find_best_nights(input: In<"find_best_nights">) {
      const out = await runDiscovery(ctx.provider, { ...input, nights: input.nights ?? "fri-sat", radiusMiles: 30 });
      if (out.kind === "result") {
        ctx.latest = out.result;
        record("find_best_nights", input, true, `${out.result.dates.length} nights, best ${out.result.verdict.recommendedDate}`);
        return summariseDiscovery(out.result);
      }
      if (out.kind === "clarify") {
        record("find_best_nights", input, true, "needs clarification");
        return {
          needsClarification: out.message,
          candidates: out.target.candidates.map((c) => ({ entityId: c.entityId, name: c.name, popularity: r3(c.popularity), hint: c.disambiguation })),
        };
      }
      record("find_best_nights", input, false, out.message);
      return out.kind === "invalid" ? { invalid: out.message, issues: out.issues } : { error: out.message, failedStep: out.step };
    },

    async explain_date({ date }: In<"explain_date">) {
      const r = needAnalysis();
      const d = r.dates.find((x) => x.date === date);
      if (!d) {
        record("explain_date", { date }, false, "unknown date");
        return { error: `Date ${date} is not in the latest analysis (${r.dates.map((x) => x.date).join(", ")}).` };
      }
      record("explain_date", { date }, true, `${d.contributions.length} contributions`);
      return {
        ...summariseDate(d, 8),
        unscoredShows: d.contributions
          .filter((c) => !c.scored)
          .map((c) => ({ eventId: c.eventId, performer: c.performer, eventDate: c.eventDate, reason: c.flags.join(", "), worstCase: r3(c.upperBound) })),
      };
    },

    async compare_dates({ dateA, dateB }: In<"compare_dates">) {
      const r = needAnalysis();
      const a = r.dates.find((x) => x.date === dateA);
      const b = r.dates.find((x) => x.date === dateB);
      if (!a || !b) {
        record("compare_dates", { dateA, dateB }, false, "unknown date");
        return { error: "Both dates must be candidate dates from the latest analysis." };
      }
      const rows = diffDates(a, b).slice(0, 8);
      record("compare_dates", { dateA, dateB }, true, `${rows.length} differing shows`);
      return {
        scoreA: r3(a.score),
        scoreB: r3(b.score),
        difference: r3(a.score - b.score),
        drivers: rows.map((x) => ({ eventId: x.eventId, performer: x.performer, eventDate: x.eventDate, toA: r3(x.a), toB: r3(x.b), delta: r3(x.delta) })),
      };
    },

    async what_if_exclude({ eventIds }: In<"what_if_exclude">) {
      const r = needAnalysis();
      const known = new Set(r.events.map((e) => e.eventId));
      const unknown = eventIds.filter((id) => !known.has(id));
      if (unknown.length) {
        record("what_if_exclude", { eventIds }, false, "unknown event ids");
        return { error: `Unknown eventIds: ${unknown.join(", ")}` };
      }
      const { links, signals, typicalUnit } = rebuildScoringInputs(r);
      const dates = scoreDates({ candidateDates: r.request.candidateDates, events: r.events, links, signals, typicalUnit, ignoredEventIds: eventIds });
      const verdict = buildVerdict(dates);
      record("what_if_exclude", { eventIds }, true, `recommend ${verdict.recommendedDate}`);
      return {
        excluded: eventIds,
        recommendation: verdict.recommendedDate,
        changedFromOriginal: verdict.recommendedDate !== r.verdict.recommendedDate,
        dates: dates.map((d) => ({ date: d.date, rank: d.rank, clashScore: r3(d.score) })),
      };
    },
  };
}
