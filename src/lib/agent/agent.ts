import "server-only";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { APICallError, ToolLoopAgent, stepCountIs, tool, type LanguageModel, type ModelMessage } from "ai";
import { getConfig, type LlmRoute } from "../config";
import type { DataProvider } from "../pipeline";
import type { AnalysisResult } from "../types";
import { createToolHandlers, toolSchemas, type ToolContext } from "./tools";
import { verifyAgentAnswer } from "./verify";

export function modelFor(r: LlmRoute): LanguageModel {
  switch (r.provider) {
    case "google":
      return createGoogleGenerativeAI({ apiKey: r.apiKey })(r.model);
    case "openai":
      return createOpenAI({ apiKey: r.apiKey })(r.model);
    case "anthropic":
      return createAnthropic({ apiKey: r.apiKey })(r.model);
  }
}

/**
 * Errors worth trying the next key or model for: rate limits, overload,
 * a key blocked for the API, or a model not available to that key.
 */
export function isRouteError(err: unknown): boolean {
  const e = err as { statusCode?: number; lastError?: unknown; errors?: unknown[]; cause?: unknown };
  if (APICallError.isInstance(err)) {
    if ([401, 403, 404, 408, 429, 500, 502, 503, 504].includes(err.statusCode ?? 0)) return true;
    return /API key|quota|exhausted|permission|not available|overloaded|unavailable/i.test(err.message);
  }
  if (e?.lastError) return isRouteError(e.lastError);
  if (Array.isArray(e?.errors) && e.errors.length) return isRouteError(e.errors[e.errors.length - 1]);
  if (e?.cause) return isRouteError(e.cause);
  return false;
}

function instructions(today: string, mode: "live" | "demo") {
  return `You are Tidate, a scheduling analyst for concert promoters. Today is ${today}.
You help a promoter choose among candidate concert dates they can hold, by estimating how much each date competes with other music events in the same market for an overlapping audience.

How you work:
- Use tools for every fact and number. Never estimate, invent or adjust a score, affinity, event, venue or date yourself.
- To analyse, you need: an artist, a market (use list_markets to map the city to a market id), and either 1-4 candidate dates (analyze_candidate_dates) or a range to search (find_best_nights, e.g. "a Friday or Saturday in March", "any night in the next six weeks"). Convert dates like "May 9" to YYYY-MM-DD; if no year is given, use the next occurrence after today.
- If the artist, market or dates are missing, ask one short question instead of guessing. If analyze_candidate_dates or find_artist reports an ambiguous artist, show the candidates and ask which one, unless the user already made it clear.
- After find_best_nights, lead with the best night and mention the next two as alternatives.
- If the user asks to keep an eye on the dates, be told about changes, or similar, call watch_latest after the analysis and tell them the watch page is linked below your answer.
- After analysing, call explain_date for the recommended date and, when it helps, compare_dates against the runner-up. Use what_if_exclude when the user asks about a show moving or being cancelled.
- Answer in plain text for a chat bubble: no markdown, no headings, no asterisks, no tables. At most about 120 words in short paragraphs. Write dates like "Sat, Dec 19". Lead with the recommended date, then the two or three shows that drive the difference (performer, date, and how close their audience is to the artist's), whether a plain count of nearby shows would have chosen differently, and the one most important data gap. Don't repeat disclaimers the user didn't ask about beyond one short clause.
- Be precise about meaning: Qloo affinity is a proxy for potential audience overlap, not a count of shared ticket buyers; Ticketmaster does not list every show; a lower clash score is not a promise of better ticket sales.
${mode === "demo" ? "- This session uses DEMO DATA: fictional artists, venues and values. Say so in your answer. The demo artist is 'Juniper Static' in market 'chicago' with candidate dates 2027-05-08, 2027-05-15, 2027-05-22." : ""}`;
}

export interface AgentRun {
  text: string;
  trace: ToolContext["trace"];
  analysis: AnalysisResult | null;
  verification: ReturnType<typeof verifyAgentAnswer>;
  steps: number;
  /** Id of a watch started during this run. */
  watchId: string | null;
  /** Which model answered and how many routes were tried (no keys). */
  route: { provider: string; model: string; keyIndex: number; attempts: number } | null;
}

interface RunOpts {
  provider: DataProvider;
  messages: ModelMessage[];
  previous: AnalysisResult | null;
  today: string;
  /** Injected model (tests). Defaults to the configured routes with fallback. */
  model?: LanguageModel;
  startWatch?: ToolContext["startWatch"];
}

/**
 * Runs the agent, falling through configured keys and models when a route is
 * rate limited, overloaded or not permitted. Tool results are cached
 * server-side, so a retry does not repeat the expensive lookups.
 */
export async function runAgent(opts: RunOpts): Promise<AgentRun> {
  if (opts.model) return runOnce(opts, opts.model, null, 1);
  const routes = getConfig().llmRoutes;
  if (!routes.length) throw new Error("No LLM key configured (GOOGLE_GENERATIVE_AI_API_KEYS, OPENAI_API_KEY or ANTHROPIC_API_KEY).");
  let lastErr: unknown = null;
  for (let i = 0; i < routes.length; i++) {
    const r = routes[i];
    try {
      return await runOnce(opts, modelFor(r), r, i + 1);
    } catch (err) {
      lastErr = err;
      if (!isRouteError(err)) throw err;
      console.warn(`[agent] ${r.provider}/${r.model} key #${r.keyIndex + 1} failed (${err instanceof Error ? err.message.slice(0, 120) : "error"}); trying next route`);
    }
  }
  throw new Error(`All ${routes.length} model routes failed. Last error: ${lastErr instanceof Error ? lastErr.message.slice(0, 200) : "unknown"}`);
}

async function runOnce(opts: RunOpts, model: LanguageModel, route: LlmRoute | null, attempts: number): Promise<AgentRun> {
  const ctx: ToolContext = { provider: opts.provider, latest: opts.previous, trace: [], startWatch: opts.startWatch };
  const h = createToolHandlers(ctx);

  const agent = new ToolLoopAgent({
    model,
    maxRetries: 0,
    instructions: instructions(opts.today, opts.provider.mode),
    stopWhen: stepCountIs(8),
    tools: {
      list_markets: tool({ description: "List supported markets (id and label).", inputSchema: toolSchemas.list_markets, execute: h.list_markets }),
      find_artist: tool({
        description: "Look up an artist in Qloo by name. Returns match status (exact / ambiguous / weak / not-found) and candidates.",
        inputSchema: toolSchemas.find_artist,
        execute: h.find_artist,
      }),
      analyze_candidate_dates: tool({
        description:
          "Run the full Tidate analysis: search Ticketmaster music events in the market, match performers to Qloo, fetch Qloo affinity toward the artist, and score each candidate date deterministically. Returns the ranking, top contributors, baseline comparison and diagnostics.",
        inputSchema: toolSchemas.analyze_candidate_dates,
        execute: h.analyze_candidate_dates,
      }),
      find_best_nights: tool({
        description:
          "Search a date range instead of fixed dates: scores every matching night (Fri/Sat by default) with the same engine and returns the best nights first, each night's rank, and what a plain headcount would pick.",
        inputSchema: toolSchemas.find_best_nights,
        execute: h.find_best_nights,
      }),
      explain_date: tool({
        description: "Detailed score breakdown for one candidate date or searched night of the latest analysis, including unscored shows.",
        inputSchema: toolSchemas.explain_date,
        execute: h.explain_date,
      }),
      compare_dates: tool({
        description: "Which competing shows account for the score difference between two candidate dates.",
        inputSchema: toolSchemas.compare_dates,
        execute: h.compare_dates,
      }),
      watch_latest: tool({
        description: "Start watching the latest analysis: it is re-checked daily and new or cancelled shows and changes to the best night are recorded on a watch page.",
        inputSchema: toolSchemas.watch_latest,
        execute: h.watch_latest,
      }),
      what_if_exclude: tool({
        description: "Re-score the latest analysis leaving out specific shows (e.g. one the user expects to move). Does not change the stored analysis.",
        inputSchema: toolSchemas.what_if_exclude,
        execute: h.what_if_exclude,
      }),
    },
  });

  const res = await agent.generate({ messages: opts.messages });
  const verification = verifyAgentAnswer(res.text, ctx.latest);
  return {
    text: verification.text,
    trace: ctx.trace,
    analysis: ctx.latest,
    watchId: ctx.watchId ?? null,
    verification,
    steps: res.steps.length,
    route: route ? { provider: route.provider, model: route.model, keyIndex: route.keyIndex, attempts } : null,
  };
}
