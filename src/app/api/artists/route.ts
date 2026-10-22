import { type NextRequest } from "next/server";
import { classifyMatch } from "@/lib/qloo/resolve";
import { ConfigurationError, getProvider } from "@/lib/providers";

/** Artist lookup for the request form: real Qloo /search (or the fictional demo catalogue). */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  const mode = req.nextUrl.searchParams.get("mode") === "demo" ? "demo" : "live";
  if (q.length < 2) return Response.json({ candidates: [], status: "not-found" });
  try {
    const provider = getProvider(mode);
    const candidates = await provider.searchArtists(q);
    const match = classifyMatch(q, candidates);
    return Response.json({ candidates: candidates.slice(0, 5), status: match.status, entityId: match.entity?.entityId ?? null, note: match.note ?? null });
  } catch (err) {
    if (err instanceof ConfigurationError) return Response.json({ error: err.message, code: "not-configured" }, { status: 503 });
    return Response.json({ error: err instanceof Error ? err.message : "Lookup failed" }, { status: 502 });
  }
}
