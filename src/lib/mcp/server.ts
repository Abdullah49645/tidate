import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { createToolHandlers, toolSchemas } from "../agent/tools";
import type { DataProvider } from "../pipeline";
import { SCORING_VERSION } from "../scoring/engine";

/**
 * MCP server exposing Undertow's date-clash scoring to any MCP client.
 * Uses the same pipeline and deterministic engine as the web app and agent.
 */
export function createUndertowMcpHandler(resolveProvider: (mode?: "live" | "demo") => { provider: DataProvider; note: string }) {
  const ModeArg = z.enum(["live", "demo"]).optional().describe("live = Ticketmaster + Qloo (default when configured); demo = fictional sample data");

  return createMcpHandler(
    (server) => {
      server.registerTool(
        "score_candidate_dates",
        {
          title: "Score candidate concert dates",
          description:
            "Ranks 1-4 candidate concert dates for an artist in a market by estimated audience-competition risk. Searches Ticketmaster music events within 14 days, matches performers to Qloo, uses Qloo affinity toward the artist as a proxy for audience overlap, and returns a deterministic ranking with the shows driving each score, a plain-count baseline, robustness to missing data and diagnostics.",
          inputSchema: toolSchemas.analyze_candidate_dates.extend({ mode: ModeArg }),
          annotations: { readOnlyHint: true, openWorldHint: true },
        },
        async ({ mode, ...input }) => {
          const { provider, note } = resolveProvider(mode);
          const h = createToolHandlers({ provider, latest: null, trace: [] });
          const out = await h.analyze_candidate_dates(input);
          const isError = "error" in out || "invalid" in out;
          let text: string;
          if ("summary" in out) {
            text = `${note}\n${out.summary}\n` + out.dates.map((d) => `#${d.rank} ${d.date}: score ${d.clashScore} (count-baseline rank ${d.baselineRank}, evidence ${d.evidence}) – ${d.explanation}`).join("\n");
          } else {
            text = `${note}\n${JSON.stringify(out)}`;
          }
          return {
            content: [{ type: "text" as const, text }],
            structuredContent: { scoringVersion: SCORING_VERSION, ...out } as Record<string, unknown>,
            isError,
          };
        },
      );

      server.registerTool(
        "find_artist",
        {
          title: "Find an artist in Qloo",
          description: "Resolve an artist name to a Qloo entity. Returns exact / ambiguous / weak / not-found and candidates.",
          inputSchema: toolSchemas.find_artist.extend({ mode: ModeArg }),
          annotations: { readOnlyHint: true, openWorldHint: true },
        },
        async ({ mode, name }) => {
          const { provider, note } = resolveProvider(mode);
          const out = await createToolHandlers({ provider, latest: null, trace: [] }).find_artist({ name });
          return { content: [{ type: "text" as const, text: `${note}\n${JSON.stringify(out)}` }], structuredContent: out as Record<string, unknown>, isError: "error" in out };
        },
      );

      server.registerTool(
        "list_markets",
        { title: "List supported markets", description: "Market ids accepted by score_candidate_dates.", inputSchema: z.object({}), annotations: { readOnlyHint: true } },
        async () => {
          const { provider } = resolveProvider("demo");
          const markets = await createToolHandlers({ provider, latest: null, trace: [] }).list_markets();
          return { content: [{ type: "text" as const, text: markets.map((m) => `${m.id}: ${m.label}`).join("\n") }], structuredContent: { markets } };
        },
      );
    },
    {
      serverInfo: { name: "undertow", version: SCORING_VERSION },
      instructions:
        "Undertow scores candidate concert dates by audience-competition risk. Qloo affinity is a proxy for potential audience overlap, not a count of shared ticket buyers; Ticketmaster does not list every event. Demo mode uses fictional data.",
    },
  );
}
