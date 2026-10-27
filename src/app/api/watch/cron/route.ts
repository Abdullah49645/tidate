import { timingSafeEqual } from "node:crypto";
import { MARKETS } from "@/lib/markets";
import { ConfigurationError, createLiveProvider } from "@/lib/providers";
import { watchErrorResponse } from "@/lib/watch/http";
import { getKv } from "@/lib/watch/kv";
import { createWatchService } from "@/lib/watch/service";
import { warmMarket } from "@/lib/watch/warm";

export const maxDuration = 60;

function authorised(req: Request, secret: string) {
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

/**
 * Daily pass over due watches, then cache warming (vercel.json schedules it). Vercel sends
 * `Authorization: Bearer $CRON_SECRET`; without CRON_SECRET the route refuses.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return Response.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  if (!authorised(req, secret)) return Response.json({ error: "Unauthorised" }, { status: 401 });
  const started = Date.now();
  try {
    const watches = await createWatchService().runDue(30_000);
    // Leftover time keeps the shared match cache warm, one market a day in rotation,
    // so visitors' first live runs read most matches instead of searching each act.
    let warmed = null;
    const left = 50_000 - (Date.now() - started);
    if (left > 8_000) {
      try {
        const day = Math.floor(Date.now() / 86_400_000);
        const market = MARKETS[day % MARKETS.length];
        warmed = await warmMarket({ kv: getKv(), provider: createLiveProvider(), market, from: new Date().toISOString().slice(0, 10), deadline: Date.now() + left });
      } catch (err) {
        warmed = { error: err instanceof ConfigurationError ? err.message : "warming failed" };
      }
    }
    return Response.json({ ok: true, watches, warmed }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return watchErrorResponse(err);
  }
}
