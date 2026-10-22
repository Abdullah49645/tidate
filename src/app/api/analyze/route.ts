import { z } from "zod";
import { runAnalysis, type ProgressEvent } from "@/lib/pipeline";
import { ConfigurationError, getProvider } from "@/lib/providers";

export const maxDuration = 60;

const Body = z.object({
  mode: z.enum(["live", "demo"]),
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
    return Response.json({ error: "Body must be { mode: 'live' | 'demo', request: {...} }" }, { status: 400 });
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
        const outcome = await runAnalysis(provider, body.request as never, (event) => send({ type: "progress", event }));
        send({ type: "outcome", outcome });
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
