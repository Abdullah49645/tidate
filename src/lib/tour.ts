import { dayDiff } from "./scoring/engine";

/**
 * Run planning: given each city's scored nights, pick one night per city so that
 * no two shows are closer than `minGapDays`, minimising the total clash rank.
 *
 * Scores from different cities are not comparable (each city ranks its acts
 * against a different pool), so each night is placed by its rank within its own
 * city: 0 for that city's best night, 1 for its worst. The search is exact
 * (branch and bound); with at most 4 cities and 40 nights it is instant.
 */

export interface CityNights {
  marketId: string;
  label: string;
  nights: { date: string; score: number; rank: number; baselineRank: number }[];
}

export interface PlannedStop {
  marketId: string;
  label: string;
  date: string;
  score: number;
  rank: number;
  of: number;
}

export interface RunPlan {
  stops: PlannedStop[];
  /** Sum of within-city rank positions (0 = every city on its best night). */
  cost: number;
  /** True when every city got its own best night. */
  allBest: boolean;
}

type Key = "rank" | "baselineRank";

function position(rank: number, of: number) {
  return of > 1 ? (rank - 1) / (of - 1) : 0;
}

export function planRun(cities: CityNights[], minGapDays: number, by: Key = "rank"): RunPlan | null {
  if (!cities.length || cities.some((c) => !c.nights.length)) return null;
  // Most constrained (fewest nights) first, each city's nights best first.
  const order = [...cities].sort((a, b) => a.nights.length - b.nights.length);
  const options = order.map((c) =>
    [...c.nights]
      .map((n) => ({ ...n, cost: position(n[by], c.nights.length) }))
      .sort((a, b) => a.cost - b.cost || a.date.localeCompare(b.date)),
  );
  const bestRest = options.map((_, i) => options.slice(i).reduce((s, o) => s + o[0].cost, 0));

  let best: { cost: number; picks: number[] } | null = null;
  const picks: number[] = [];
  const dates: string[] = [];

  const fits = (date: string) => dates.every((d) => Math.abs(dayDiff(d, date)) >= Math.max(1, minGapDays));

  function search(i: number, cost: number) {
    if (best && cost + (bestRest[i] ?? 0) >= best.cost - 1e-12) return;
    if (i === options.length) {
      best = { cost, picks: [...picks] };
      return;
    }
    options[i].forEach((n, j) => {
      if (!fits(n.date)) return;
      picks.push(j);
      dates.push(n.date);
      search(i + 1, cost + n.cost);
      picks.pop();
      dates.pop();
    });
  }
  search(0, 0);
  if (!best) return null;
  const found = best as { cost: number; picks: number[] };
  const stops = order
    .map((c, i) => {
      const n = options[i][found.picks[i]];
      return { marketId: c.marketId, label: c.label, date: n.date, score: n.score, rank: n.rank, of: c.nights.length };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
  return { stops, cost: found.cost, allBest: stops.every((s) => s.rank === 1) };
}
