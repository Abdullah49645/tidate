import { z } from "zod";
import { compactResult, runAnalysis, runDiscovery, type ProgressEvent } from "@/lib/pipeline";
import { ConfigurationError, getProvider } from "@/lib/providers";

export const maxDuration = 60;

const Body = z.object({
  mode: z.enum(["live", "demo"]),
  /** "compare" scores the given dates; "discover" scores every matching night in a range. */
  kind: z.enum(["compare", "discover"]).default("compare"),
  request: z.unknown(),
});

export type AnalyzeStreamLine =
  | { type: "progress"; event: ProgressEvent }
  | { type: "outcome"; outcome: Awaited<ReturnType<typeof runAnalysis>> }
  | { type: "fatal"; message: string };

export async function POST(req: Request) {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return Response.json({ error: "Body must be { mode: 'live' | 'demo', kind?: 'compare' | 'discover', request: {...} }" }, { status: 400 });
  }

  let provider;
  try {
    provider = getProvider(body.mode);
  } catch (err) {
    const message = err instanceof ConfigurationError ? err.message : "Server configuration error";
    return Response.json({ error: message, code: "not-configured" }, { status: 503 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (line: AnalyzeStreamLine) => controller.enqueue(encoder.encode(JSON.stringify(line) + "\n"));
      try {
        const progress = (event: ProgressEvent) => send({ type: "progress", event });
        const outcome = body.kind === "discover" ? await runDiscovery(provider, body.request as never, progress) : await runAnalysis(provider, body.request as never, progress);
        // A date search scores many nights; per-show rows are re-derived in the browser.
        send({ type: "outcome", outcome: outcome.kind === "result" && body.kind === "discover" ? { ...outcome, result: compactResult(outcome.result) } : outcome });
      } catch (err) {
        send({ type: "fatal", message: err instanceof Error ? err.message : "Unexpected error" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
}
