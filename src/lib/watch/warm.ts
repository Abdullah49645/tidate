import type { Market } from "../markets";
import type { DataProvider } from "../pipeline";
import { splitBill, withTitlePerformer } from "../pipeline";
import { addDays, normaliseName } from "../scoring/engine";
import type { Kv } from "./kv-core";
import { withMatchCache } from "./match-cache";

export interface WarmReport {
  market: string;
  performers: number;
  alreadyCached: number;
  searched: number;
  failed: number;
  stoppedEarly: boolean;
}

/**
 * Pre-fills the shared performer-match cache for one market: lists the music
 * events in the coming weeks and searches Qloo for every performer not already
 * cached, until the deadline. A visitor's first analysis there then reads most
 * matches in one batch instead of searching each act live.
 */
export async function warmMarket(opts: {
  kv: Kv;
  provider: Pick<DataProvider, "searchEvents" | "searchArtists" | "mode">;
  market: Market;
  /** First day to cover (YYYY-MM-DD), usually today. */
  from: string;
  weeks?: number;
  radiusMiles?: number;
  deadline: number;
}): Promise<WarmReport> {
  const { kv, market } = opts;
  const to = addDays(opts.from, 7 * (opts.weeks ?? 10));
  const search = await opts.provider.searchEvents({ market, radiusMiles: opts.radiusMiles ?? 30, startDate: opts.from, endDate: to });
  const names = new Map<string, string>();
  for (const e of search.events.map(withTitlePerformer)) {
    for (const p of e.performers) {
      names.set(normaliseName(p.name), p.name);
      for (const part of splitBill(p.name)) names.set(normaliseName(part), part);
    }
  }
  names.delete("");
  const cached = withMatchCache(opts.provider as DataProvider, kv);
  const all = [...names.values()];
  const existing = await kv.mget(all.map((n) => `tidate:search:${normaliseName(n)}`));
  const todo = all.filter((_, i) => !existing[i]);
  const report: WarmReport = { market: market.id, performers: all.length, alreadyCached: all.length - todo.length, searched: 0, failed: 0, stoppedEarly: false };

  let i = 0;
  const worker = async () => {
    while (i < todo.length) {
      if (Date.now() > opts.deadline) {
        report.stoppedEarly = true;
        return;
      }
      const name = todo[i++];
      try {
        await cached.searchArtists(name);
        report.searched += 1;
      } catch {
        report.failed += 1;
      }
      // Write as we go so a timeout keeps what was found.
      if (report.searched % 25 === 0) await cached.flushMatches();
    }
  };
  await Promise.all(Array.from({ length: 5 }, worker));
  await cached.flushMatches();
  return report;
}
