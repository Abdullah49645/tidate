import "server-only";
import { getConfig } from "./config";
import { createDemoProvider } from "./demo/provider";
import type { DataProvider } from "./pipeline";
import { cachedSearchArtists } from "./qloo/cached";
import { QlooClient } from "./qloo/client";
import { searchMusicEvents } from "./ticketmaster/client";
import { getKv } from "./watch/kv";
import { withMatchCache } from "./watch/match-cache";

export class ConfigurationError extends Error {}

export function createLiveProvider(): DataProvider {
  const c = getConfig();
  if (!c.qlooApiKey) throw new ConfigurationError("QLOO_API_KEY is not configured on the server.");
  if (!c.ticketmasterApiKey) throw new ConfigurationError("TICKETMASTER_API_KEY is not configured on the server.");
  const qloo = new QlooClient(c.qlooApiKey, c.qlooBaseUrl);
  const tmKey = c.ticketmasterApiKey;
  return {
    mode: "live",
    resolveBudgetMs: Number(process.env.TIDATE_LOOKUP_BUDGET_MS ?? 30_000),
    discoverBudgetMs: Number(process.env.TIDATE_DISCOVER_BUDGET_MS ?? 45_000),
    searchEvents: (p) => searchMusicEvents(tmKey, p),
    searchArtists: (name) => cachedSearchArtists(name.trim()),
    affinities: (target, ids) => qloo.affinities(target, ids),
    entityTags: (ids) => qloo.entityTags(ids),
    recommendArtists: (target, market) => qloo.recommendArtists(target, { locationQuery: market.label.replace(/,.*$/, ""), take: 40 }),
    fanHeatmap: (target, market, radiusMiles) => qloo.heatmap(target, market.lat, market.lng, radiusMiles * 1609.344),
  };
}

/** Live when requested and configured; demo when requested. Never silently swaps live for demo. */
export function getProvider(mode: "live" | "demo"): DataProvider {
  if (mode === "demo") return createDemoProvider();
  if (getConfig().forceDemo) throw new ConfigurationError("Live mode is disabled on this deployment (TIDATE_FORCE_DEMO=1).");
  return createLiveProvider();
}

/**
 * Like getProvider, but live artist searches are also kept in the shared store
 * (Upstash when configured) so later runs, on any server instance, reuse them.
 * Call flushMatches() when the run is done.
 */
export function getProviderWithMatches(mode: "live" | "demo"): DataProvider & { flushMatches(): Promise<number> } {
  const p = getProvider(mode);
  if (p.mode === "demo") return { ...p, flushMatches: async () => 0 };
  return withMatchCache(p, getKv());
}
