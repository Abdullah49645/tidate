import { z } from "zod";
import { runAgent } from "@/lib/agent/agent";
import { getConfig } from "@/lib/config";
import { ConfigurationError, getProvider } from "@/lib/providers";
import { SCORING_VERSION } from "@/lib/scoring/engine";
import type { AnalysisResult } from "@/lib/types";

export const maxDuration = 60;

const Body = z.object({
  mode: z.enum(["live", "demo"]),
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(4000) }))
    .min(1)
    .max(20),
  /** The latest analysis shown in the UI, so follow-up questions can use it. */
  previous: z.unknown().optional(),
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

function acceptPrevious(p: unknown, mode: "live" | "demo"): AnalysisResult | null {
  const shape = z.object({ version: z.literal(SCORING_VERSION), mode: z.literal(mode), dates: z.array(z.unknown()), events: z.array(z.unknown()) }).passthrough();
  return shape.safeParse(p).success ? (p as AnalysisResult) : null;
}

export async function POST(req: Request) {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return Response.json({ error: "Invalid agent request." }, { status: 400 });
  }
  if (!getConfig().llm) {
    return Response.json(
      { error: "The conversational agent needs an LLM key on the server. The structured form above runs the same tools without one.", code: "no-llm" },
      { status: 503 },
    );
  }
  let provider;
  try {
    provider = getProvider(body.mode);
  } catch (err) {
    return Response.json({ error: err instanceof ConfigurationError ? err.message : "Configuration error", code: "not-configured" }, { status: 503 });
  }
  try {
    const run = await runAgent({
      provider,
      messages: body.messages,
      previous: acceptPrevious(body.previous, body.mode),
      today: body.today ?? new Date().toISOString().slice(0, 10),
    });
    return Response.json(run, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Agent failed";
    return Response.json({ error: `The agent could not complete: ${message}` }, { status: 502 });
  }
}
