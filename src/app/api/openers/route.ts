import { type NextRequest } from "next/server";
import { openerIdeas } from "@/lib/context";
import { getMarket } from "@/lib/markets";
import { ConfigurationError, getProvider } from "@/lib/providers";

/** Artists whose audiences are closest to the target's, weighted to the market (display only). */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const mode = sp.get("mode") === "demo" ? "demo" : "live";
  const target = sp.get("target")?.trim() ?? "";
  const market = getMarket(sp.get("market") ?? "");
  if (!/^[\w-]{1,80}$/.test(target) || !market) return Response.json({ error: "Pass target and a supported market" }, { status: 400 });
  try {
    const artists = await openerIdeas(getProvider(mode), target, market);
    if (!artists) return Response.json({ error: "Recommendations are not available for this data source" }, { status: 501 });
    return Response.json({
      artists,
      source: mode === "demo" ? "demo-fixture" : "qloo",
      request: `GET /v2/insights filter.type=urn:entity:artist signal.interests.entities=<target> signal.location.query=${market.label.replace(/,.*$/, "")}`,
    });
  } catch (err) {
    if (err instanceof ConfigurationError) return Response.json({ error: err.message, code: "not-configured" }, { status: 503 });
    return Response.json({ error: err instanceof Error ? err.message : "Recommendation lookup failed" }, { status: 502 });
  }
}
