import { watchErrorResponse } from "@/lib/watch/http";
import { createWatchService } from "@/lib/watch/service";

/** A watch and its history. The id is the only credential, so it is long and random. */
export async function GET(_: Request, ctx: RouteContext<"/api/watch/[id]">) {
  const { id } = await ctx.params;
  try {
    return Response.json(await createWatchService().get(id), { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return watchErrorResponse(err);
  }
}

/** Stop watching and delete the stored history. */
export async function DELETE(_: Request, ctx: RouteContext<"/api/watch/[id]">) {
  const { id } = await ctx.params;
  try {
    await createWatchService().remove(id);
    return new Response(null, { status: 204 });
  } catch (err) {
    return watchErrorResponse(err);
  }
}
