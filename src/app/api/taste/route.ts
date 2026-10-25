import { type NextRequest } from "next/server";
import { MAX_TASTE_IDS, tasteOverlap } from "@/lib/context";
import { ConfigurationError, getProvider } from "@/lib/providers";

/** Shared Qloo genre and influence tags between the target and each listed artist (display only). */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const mode = sp.get("mode") === "demo" ? "demo" : "live";
  const target = sp.get("target")?.trim() ?? "";
  const ids = (sp.get("ids") ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  if (!target || !ids.length || ids.length > MAX_TASTE_IDS || ![target, ...ids].every((x) => /^[\w-]{1,80}$/.test(x))) {
    return Response.json({ error: `Pass target and 1 to ${MAX_TASTE_IDS} entity ids` }, { status: 400 });
  }
  try {
    const results = await tasteOverlap(getProvider(mode), target, ids);
    if (!results) return Response.json({ error: "Tags are not available for this data source" }, { status: 501 });
    return Response.json({ results, source: mode === "demo" ? "demo-fixture" : "qloo", request: "GET /entities?entity_ids=..." });
  } catch (err) {
    if (err instanceof ConfigurationError) return Response.json({ error: err.message, code: "not-configured" }, { status: 503 });
    return Response.json({ error: err instanceof Error ? err.message : "Tag lookup failed" }, { status: 502 });
  }
}
