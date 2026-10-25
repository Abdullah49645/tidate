import type { DataProvider } from "../pipeline";
import { normaliseName } from "../scoring/engine";
import type { ArtistCandidate } from "../types";
import type { Kv } from "./kv";

const TTL_SECONDS = 30 * 24 * 3600;
const key = (name: string) => `tidate:search:${normaliseName(name)}`;

/**
 * Wraps a live provider so Qloo artist-search results are kept in the shared
 * store. A night search or a watch check that sees the same performers again
 * reads them in one batch instead of searching Qloo for each, so later runs
 * reach further within the lookup time limit. Only search results (public
 * catalogue data: id, name, popularity) are kept, for 30 days.
 */
export function withMatchCache(provider: DataProvider, kv: Kv): DataProvider & { flushMatches(): Promise<number> } {
  const known = new Map<string, ArtistCandidate[]>();
  const pending = new Map<string, ArtistCandidate[]>();
  return {
    ...provider,
    async prefetchArtists(names: string[]) {
      const wanted = [...new Set(names.map(normaliseName))].filter((n) => n && !known.has(n));
      if (!wanted.length) return;
      try {
        const values = await kv.mget(wanted.map((n) => `tidate:search:${n}`));
        values.forEach((v, i) => {
          if (!v) return;
          try {
            known.set(wanted[i], JSON.parse(v) as ArtistCandidate[]);
          } catch {
            /* ignore a corrupt entry; it will be searched again */
          }
        });
      } catch {
        /* the store is an optimisation: on failure every name is searched live */
      }
    },
    async searchArtists(name: string) {
      const n = normaliseName(name);
      const hit = known.get(n);
      if (hit) return hit;
      const found = await provider.searchArtists(name);
      known.set(n, found);
      pending.set(n, found);
      return found;
    },
    async flushMatches() {
      if (!pending.size) return 0;
      const entries = [...pending].map(([n, v]) => ({ key: key(n), value: JSON.stringify(v), ttlSeconds: TTL_SECONDS }));
      pending.clear();
      try {
        await kv.setMany(entries);
        return entries.length;
      } catch {
        return 0;
      }
    },
  };
}
