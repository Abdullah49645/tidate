import { type NextRequest } from "next/server";
import { fanMap } from "@/lib/context";
import { getMarket } from "@/lib/markets";
import { ConfigurationError, getProvider } from "@/lib/providers";

/** Qloo heatmap of the target artist's audience around a market (display only). */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const mode = sp.get("mode") === "demo" ? "demo" : "live";
  const target = sp.get("target")?.trim() ?? "";
  const market = getMarket(sp.get("market") ?? "");
  const radius = Number(sp.get("radius") ?? 30);
  if (!/^[\w-]{1,80}$/.test(target) || !market || !Number.isInteger(radius) || radius < 5 || radius > 100) {
    return Response.json({ error: "Pass target, a supported market and a radius of 5 to 100 miles" }, { status: 400 });
  }
  try {
    const cells = await fanMap(getProvider(mode), target, market, radius);
    if (!cells) return Response.json({ error: "Heatmaps are not available for this data source" }, { status: 501 });
    return Response.json({
      cells,
      center: { lat: market.lat, lng: market.lng },
      radiusMiles: radius,
      source: mode === "demo" ? "demo-fixture" : "qloo",
      request: `GET /v2/insights filter.type=urn:heatmap filter.location=POINT(${market.lng} ${market.lat}) radius=${radius}mi`,
    });
  } catch (err) {
    if (err instanceof ConfigurationError) return Response.json({ error: err.message, code: "not-configured" }, { status: 503 });
    return Response.json({ error: err instanceof Error ? err.message : "Heatmap lookup failed" }, { status: 502 });
  }
}
