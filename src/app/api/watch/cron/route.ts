import { timingSafeEqual } from "node:crypto";
import { watchErrorResponse } from "@/lib/watch/http";
import { createWatchService } from "@/lib/watch/service";

export const maxDuration = 60;

function authorised(req: Request, secret: string) {
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

/**
 * Daily pass over due watches (vercel.json schedules it). Vercel sends
 * `Authorization: Bearer $CRON_SECRET`; without CRON_SECRET the route refuses.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return Response.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  if (!authorised(req, secret)) return Response.json({ error: "Unauthorised" }, { status: 401 });
  try {
    const report = await createWatchService().runDue(40_000);
    return Response.json({ ok: true, ...report }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return watchErrorResponse(err);
  }
}
