import { watchErrorResponse } from "@/lib/watch/http";
import { createWatchService } from "@/lib/watch/service";

export const maxDuration = 60;

/** Check a watch now (at most once a minute). */
export async function POST(_: Request, ctx: RouteContext<"/api/watch/[id]/check">) {
  const { id } = await ctx.params;
  try {
    return Response.json(await createWatchService().check(id, "manual"), { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return watchErrorResponse(err);
  }
}
