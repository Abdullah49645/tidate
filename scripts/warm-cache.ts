/**
 * Pre-fills the shared performer-match cache (Upstash) for the supported markets,
 * so visitors' first live analyses are fast.
 *   npm run warm:cache                  # all markets
 *   npm run warm:cache -- nashville chicago
 * Needs QLOO_API_KEY, TICKETMASTER_API_KEY and KV_REST_API_URL/TOKEN (or
 * UPSTASH_REDIS_REST_URL/TOKEN) in .env.local, e.g. from `vercel env pull`.
 */
import { MARKETS, getMarket } from "../src/lib/markets";
import { QlooClient } from "../src/lib/qloo/client";
import { searchMusicEvents } from "../src/lib/ticketmaster/client";
import { upstashKv } from "../src/lib/watch/kv-core";
import { warmMarket } from "../src/lib/watch/warm";

const env = (a: string, b?: string) => (process.env[a] ?? (b ? process.env[b] : undefined))?.trim();

async function main() {
  const qlooKey = env("QLOO_API_KEY");
  const tmKey = env("TICKETMASTER_API_KEY");
  const url = env("KV_REST_API_URL", "UPSTASH_REDIS_REST_URL");
  const token = env("KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_TOKEN");
  if (!qlooKey || !tmKey) throw new Error("QLOO_API_KEY and TICKETMASTER_API_KEY are required.");
  if (!url || !token) throw new Error("No Upstash credentials: set KV_REST_API_URL and KV_REST_API_TOKEN (vercel env pull .env.local).");
  const kv = upstashKv(url, token);
  const qloo = new QlooClient(qlooKey, env("QLOO_BASE_URL") ?? "https://hackathon.api.qloo.com");
  const provider = { mode: "live" as const, searchEvents: (p: Parameters<typeof searchMusicEvents>[1]) => searchMusicEvents(tmKey, p), searchArtists: (n: string) => qloo.searchArtists(n) };
  const ids = process.argv.slice(2);
  const markets = ids.length ? ids.map((id) => getMarket(id) ?? (() => { throw new Error(`Unknown market ${id}`); })()) : MARKETS;
  const today = new Date().toISOString().slice(0, 10);
  for (const market of markets) {
    const t = Date.now();
    const r = await warmMarket({ kv, provider, market, from: today, weeks: 10, deadline: Date.now() + 6 * 60_000 });
    console.log(`${market.id.padEnd(14)} ${r.performers} performers, ${r.alreadyCached} cached, ${r.searched} searched, ${r.failed} failed${r.stoppedEarly ? ", stopped at time limit" : ""} (${Math.round((Date.now() - t) / 1000)} s)`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
