import "server-only";
import { getConfig } from "./config";
import { createDemoProvider } from "./demo/provider";
import type { DataProvider } from "./pipeline";
import { cachedSearchArtists } from "./qloo/cached";
import { QlooClient } from "./qloo/client";
import { searchMusicEvents } from "./ticketmaster/client";

export class ConfigurationError extends Error {}

export function createLiveProvider(): DataProvider {
  const c = getConfig();
  if (!c.qlooApiKey) throw new ConfigurationError("QLOO_API_KEY is not configured on the server.");
  if (!c.ticketmasterApiKey) throw new ConfigurationError("TICKETMASTER_API_KEY is not configured on the server.");
  const qloo = new QlooClient(c.qlooApiKey, c.qlooBaseUrl);
  const tmKey = c.ticketmasterApiKey;
  return {
    mode: "live",
    resolveBudgetMs: Number(process.env.UNDERTOW_LOOKUP_BUDGET_MS ?? 30_000),
    searchEvents: (p) => searchMusicEvents(tmKey, p),
    searchArtists: (name) => cachedSearchArtists(name.trim()),
    affinities: (target, ids) => qloo.affinities(target, ids),
  };
}

/** Live when requested and configured; demo when requested. Never silently swaps live for demo. */
export function getProvider(mode: "live" | "demo"): DataProvider {
  if (mode === "demo") return createDemoProvider();
  if (getConfig().forceDemo) throw new ConfigurationError("Live mode is disabled on this deployment (UNDERTOW_FORCE_DEMO=1).");
  return createLiveProvider();
}
