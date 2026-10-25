import { watchErrorResponse } from "@/lib/watch/http";
import { createWatchService } from "@/lib/watch/service";

export const maxDuration = 60;

/** Start watching a request. Runs a baseline check now and returns the watch. */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body must be JSON: { kind, mode, request }" }, { status: 400 });
  }
  try {
    const watch = await createWatchService().create(body);
    return Response.json(watch, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (err) {
    return watchErrorResponse(err);
  }
}
