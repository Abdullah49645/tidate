import "server-only";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { ToolLoopAgent, stepCountIs, tool, type LanguageModel, type ModelMessage } from "ai";
import { getConfig } from "../config";
import type { DataProvider } from "../pipeline";
import type { AnalysisResult } from "../types";
import { createToolHandlers, toolSchemas, type ToolContext } from "./tools";
import { verifyAgentAnswer } from "./verify";

function model(): LanguageModel {
  const c = getConfig();
  if (!c.llm) throw new Error("No LLM key configured (GOOGLE_GENERATIVE_AI_API_KEY, OPENAI_API_KEY or ANTHROPIC_API_KEY).");
  switch (c.llm.provider) {
    case "google":
      return createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY })(c.llm.model);
    case "openai":
      return createOpenAI({ apiKey: process.env.OPENAI_API_KEY })(c.llm.model);
    case "anthropic":
      return createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })(c.llm.model);
  }
}

function instructions(today: string, mode: "live" | "demo") {
  return `You are Undertow, a scheduling analyst for concert promoters. Today is ${today}.
You help a promoter choose among candidate concert dates they can hold, by estimating how much each date competes with other music events in the same market for an overlapping audience.

How you work:
- Use tools for every fact and number. Never estimate, invent or adjust a score, affinity, event, venue or date yourself.
- To analyse, you need: an artist, a market (use list_markets to map the city to a market id), and 1-4 candidate dates. Convert dates like "May 9" to YYYY-MM-DD; if no year is given, use the next occurrence after today.
- If the artist, market or dates are missing, ask one short question instead of guessing. If analyze_candidate_dates or find_artist reports an ambiguous artist, show the candidates and ask which one, unless the user already made it clear.
- After analysing, call explain_date for the recommended date and, when it helps, compare_dates against the runner-up. Use what_if_exclude when the user asks about a show moving or being cancelled.
- Answer concisely: the recommended date first, then the two or three shows that drive the difference (performer, venue, date, affinity), whether a plain count of nearby shows would have chosen differently, and any material data gaps.
- Be precise about meaning: Qloo affinity is a proxy for potential audience overlap, not a count of shared ticket buyers; Ticketmaster does not list every show; a lower clash score is not a promise of better ticket sales.
${mode === "demo" ? "- This session uses DEMO DATA: fictional artists, venues and values. Say so in your answer. The demo artist is 'Juniper Static' in market 'chicago' with candidate dates 2027-05-08, 2027-05-15, 2027-05-22." : ""}`;
}

export interface AgentRun {
  text: string;
  trace: ToolContext["trace"];
  analysis: AnalysisResult | null;
  verification: ReturnType<typeof verifyAgentAnswer>;
  steps: number;
}

export async function runAgent(opts: {
  provider: DataProvider;
  messages: ModelMessage[];
  previous: AnalysisResult | null;
  today: string;
  /** Injected model (tests). Defaults to the configured provider. */
  model?: LanguageModel;
}): Promise<AgentRun> {
  const ctx: ToolContext = { provider: opts.provider, latest: opts.previous, trace: [] };
  const h = createToolHandlers(ctx);

  const agent = new ToolLoopAgent({
    model: opts.model ?? model(),
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
          "Run the full Undertow analysis: search Ticketmaster music events in the market, match performers to Qloo, fetch Qloo affinity toward the artist, and score each candidate date deterministically. Returns the ranking, top contributors, baseline comparison and diagnostics.",
        inputSchema: toolSchemas.analyze_candidate_dates,
        execute: h.analyze_candidate_dates,
      }),
      explain_date: tool({
        description: "Detailed score breakdown for one candidate date of the latest analysis, including unscored shows.",
        inputSchema: toolSchemas.explain_date,
        execute: h.explain_date,
      }),
      compare_dates: tool({
        description: "Which competing shows account for the score difference between two candidate dates.",
        inputSchema: toolSchemas.compare_dates,
        execute: h.compare_dates,
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
    verification,
    steps: res.steps.length,
  };
}
