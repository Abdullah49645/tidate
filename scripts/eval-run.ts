/**
 * Runs the pre-registered experiments in docs/EVALUATION.md on .eval-data/.
 *   npm run eval:run
 * Writes aggregate statistics only (no Qloo values) to docs/eval-results.json.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { buildVerdict, dayDiff, normaliseName, prepareEvents, scoreDates, type PerformerLink, type SignalLookup } from "../src/lib/scoring/engine";
import { BAD_GENRES, EVAL_MARKETS, type MarketData } from "./eval-collect";

const MIN_CANCELLED = 30;

/** Mann–Whitney AUC: P(score_pos > score_neg) + 0.5 * P(tie). */
export function auc(pos: number[], neg: number[]): number | null {
  if (!pos.length || !neg.length) return null;
  const all = [...pos.map((v) => ({ v, p: 1 })), ...neg.map((v) => ({ v, p: 0 }))].sort((a, b) => a.v - b.v);
  let rankSum = 0;
  for (let i = 0; i < all.length; ) {
    let j = i;
    while (j < all.length && all[j].v === all[i].v) j++;
    const avg = (i + 1 + j) / 2;
    for (let k = i; k < j; k++) if (all[k].p) rankSum += avg;
    i = j;
  }
  return (rankSum - (pos.length * (pos.length + 1)) / 2) / (pos.length * neg.length);
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

type Pair = { cluster: string; same: boolean; affinity: number; popularity: number | null };

function clusterBootstrap(pairs: Pair[], key: "affinity" | "popularity", draws = 2000, seed = 42) {
  const clusters = [...new Set(pairs.map((p) => p.cluster))];
  const by = new Map(clusters.map((c) => [c, pairs.filter((p) => p.cluster === c)]));
  const r = rng(seed);
  const stats: number[] = [];
  for (let d = 0; d < draws; d++) {
    const pos: number[] = [];
    const neg: number[] = [];
    for (let i = 0; i < clusters.length; i++) {
      for (const p of by.get(clusters[Math.floor(r() * clusters.length)])!) {
        const v = p[key];
        if (v === null) continue;
        (p.same ? pos : neg).push(v);
      }
    }
    const a = auc(pos, neg);
    if (a !== null) stats.push(a);
  }
  stats.sort((a, b) => a - b);
  return { lo: stats[Math.floor(0.025 * stats.length)], hi: stats[Math.floor(0.975 * stats.length) - 1] };
}

function firstSaturdays(start: string, n: number): string[] {
  const out: string[] = [];
  let d = start;
  while (out.length < n) {
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (dow === 6) out.push(d);
    d = new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  }
  return out;
}

function main() {
  const data: MarketData[] = EVAL_MARKETS.filter((m) => existsSync(`.eval-data/${m}.json`)).map((m) => JSON.parse(readFileSync(`.eval-data/${m}.json`, "utf8")));
  if (!data.length) {
    console.error("No data in .eval-data/. Run npm run eval:collect first.");
    process.exit(1);
  }

  const summary: Record<string, unknown> = { generatedAt: new Date().toISOString(), markets: data.map((d) => d.market) };
  const coverage = data.map((d) => {
    const rs = Object.values(d.resolutions);
    return {
      market: d.market,
      events: d.events.length,
      truncated: d.tm.truncated,
      performers: rs.length,
      resolvedExact: rs.filter((r) => r.status === "exact").length,
      ambiguous: rs.filter((r) => r.status === "ambiguous").length,
      weakOrNotFound: rs.filter((r) => r.status === "weak" || r.status === "not-found").length,
      errors: rs.filter((r) => r.status === "error").length,
      targets: d.targets.length,
      targetsWithAffinity: Object.keys(d.affinity).length,
    };
  });
  summary.coverage = coverage;

  /* E1 */
  const pairs: Pair[] = [];
  const perMarket: Record<string, { pairs: number; aucAffinity: number | null; aucPopularity: number | null }> = {};
  let affinityReturned = 0,
    affinityRequested = 0;
  for (const d of data) {
    const genreById = new Map<string, string | null>();
    for (const e of d.events) for (const p of e.performers) {
      const r = d.resolutions[normaliseName(p.name)];
      if (r?.entityId && !genreById.get(r.entityId)) genreById.set(r.entityId, p.genre ?? e.genre);
    }
    const mp: Pair[] = [];
    for (const t of d.targets.filter((x) => x.reason === "sample")) {
      const sig = d.affinity[t.entityId];
      if (!sig || !t.genre || BAD_GENRES.has(t.genre)) continue;
      for (const [cid, s] of Object.entries(sig)) {
        affinityRequested++;
        if (s.affinity === null) continue;
        affinityReturned++;
        const g = genreById.get(cid);
        if (!g || BAD_GENRES.has(g)) continue;
        mp.push({ cluster: `${d.market}:${t.entityId}`, same: g === t.genre, affinity: s.affinity, popularity: s.popularity });
      }
    }
    perMarket[d.market] = {
      pairs: mp.length,
      aucAffinity: auc(mp.filter((p) => p.same).map((p) => p.affinity), mp.filter((p) => !p.same).map((p) => p.affinity)),
      aucPopularity: auc(
        mp.filter((p) => p.same && p.popularity !== null).map((p) => p.popularity!),
        mp.filter((p) => !p.same && p.popularity !== null).map((p) => p.popularity!),
      ),
    };
    pairs.push(...mp);
  }
  const pooledAff = auc(pairs.filter((p) => p.same).map((p) => p.affinity), pairs.filter((p) => !p.same).map((p) => p.affinity));
  const pooledPop = auc(
    pairs.filter((p) => p.same && p.popularity !== null).map((p) => p.popularity!),
    pairs.filter((p) => !p.same && p.popularity !== null).map((p) => p.popularity!),
  );
  const ciAff = pairs.length ? clusterBootstrap(pairs, "affinity") : null;
  const ciPop = pairs.length ? clusterBootstrap(pairs.filter((p) => p.popularity !== null), "popularity") : null;
  const clusters = new Set(pairs.map((p) => p.cluster)).size;
  const e1Verdict =
    pooledAff === null || clusters < 10
      ? "insufficient evidence"
      : ciAff && ciAff.lo > 0.5
        ? "association observed"
        : "no meaningful association observed";
  summary.E1 = {
    targets: clusters,
    pairs: pairs.length,
    sameGenrePairs: pairs.filter((p) => p.same).length,
    affinityReturnedShare: affinityRequested ? affinityReturned / affinityRequested : null,
    aucAffinity: pooledAff,
    ci95Affinity: ciAff,
    aucPopularityControl: pooledPop,
    ci95Popularity: ciPop,
    perMarket,
    verdict: e1Verdict,
  };

  /* E2 */
  let scenarios = 0,
    recDiffers = 0,
    rankingDiffers = 0,
    noCompetition = 0;
  for (const d of data) {
    const dates = firstSaturdays(d.window.start, 3);
    for (const t of d.targets.filter((x) => x.reason === "sample")) {
      const sig = d.affinity[t.entityId];
      if (!sig) continue;
      const { eligible } = prepareEvents(
        d.events.filter((e) => e.localDate && dates.some((x) => Math.abs(dayDiff(x, e.localDate!)) <= 14)),
        { targetNames: [t.name] },
      );
      const evs = eligible.filter((e) => !e.performers.some((p) => d.resolutions[normaliseName(p.name)]?.entityId === t.entityId));
      const links: Record<string, PerformerLink[]> = {};
      for (const e of evs) links[e.eventId] = e.performers.map((p) => ({ name: p.name, entityId: d.resolutions[normaliseName(p.name)]?.entityId ?? null }));
      const signals: Record<string, SignalLookup> = {};
      for (const [cid, s] of Object.entries(sig)) signals[cid] = { affinity: s.affinity, popularity: s.popularity };
      const scored = scoreDates({ candidateDates: dates, events: evs, links, signals });
      if (scored.every((x) => x.inWindowEvents === 0)) {
        noCompetition++;
        continue;
      }
      scenarios++;
      const v = buildVerdict(scored);
      const baseBest = [...scored].sort((a, b) => a.baselineRank - b.baselineRank)[0].date;
      if (v.recommendedDate !== baseBest) recDiffers++;
      if (scored.some((x) => x.rank !== x.baselineRank)) rankingDiffers++;
    }
  }
  summary.E2 = {
    scenarios,
    skippedNoCompetition: noCompetition,
    recommendationDiffersShare: scenarios ? recDiffers / scenarios : null,
    rankingDiffersShare: scenarios ? rankingDiffers / scenarios : null,
  };

  /* E3 */
  const cancelled: number[] = [];
  const active: number[] = [];
  let cancelledTotal = 0;
  for (const d of data) {
    for (const e of d.events) {
      if (!e.localDate) continue;
      const isCancelled = e.status === "canceled" || e.status === "postponed";
      if (isCancelled) cancelledTotal++;
      const ids = e.performers.map((p) => d.resolutions[normaliseName(p.name)]?.entityId).filter((x): x is string => !!x);
      const tid = ids.find((x) => d.affinity[x]);
      if (!tid) continue;
      const others = d.events.filter((o) => o.eventId !== e.eventId && o.localDate && o.status !== "canceled" && o.status !== "postponed");
      const links: Record<string, PerformerLink[]> = {};
      for (const o of others) links[o.eventId] = o.performers.map((p) => ({ name: p.name, entityId: d.resolutions[normaliseName(p.name)]?.entityId ?? null }));
      const signals: Record<string, SignalLookup> = Object.fromEntries(Object.entries(d.affinity[tid]).map(([k, s]) => [k, { affinity: s.affinity, popularity: s.popularity }]));
      const [s] = scoreDates({ candidateDates: [e.localDate], events: others, links, signals });
      (isCancelled ? cancelled : active).push(s.score);
    }
  }
  summary.E3 = {
    cancelledOrPostponedEvents: cancelledTotal,
    cancelledWithScore: cancelled.length,
    activeWithScore: active.length,
    auc: cancelled.length >= MIN_CANCELLED ? auc(cancelled, active) : null,
    verdict: cancelled.length >= MIN_CANCELLED ? "see AUC (association only, not causation)" : `insufficient evidence (${cancelled.length} < ${MIN_CANCELLED})`,
  };

  writeFileSync("docs/eval-results.json", JSON.stringify(summary, null, 2) + "\n");
  console.log(JSON.stringify(summary, null, 2));
}

if (process.argv[1]?.includes("eval-run")) main();
