/**
 * Collects evaluation data as pre-registered in docs/EVALUATION.md.
 *   npm run eval:collect
 * Output: .eval-data/<market>.json (gitignored; contains Qloo data, never commit).
 * Resumable: markets already collected are skipped.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { getMarket } from "../src/lib/markets";
import { QlooClient } from "../src/lib/qloo/client";
import { classifyMatch } from "../src/lib/qloo/resolve";
import { addDays, normaliseName } from "../src/lib/scoring/engine";
import { searchMusicEvents } from "../src/lib/ticketmaster/client";
import type { ArtistCandidate, CompetingEvent } from "../src/lib/types";

export const EVAL_MARKETS = ["chicago", "new-york", "los-angeles", "austin", "nashville", "atlanta"];
export const TARGETS_PER_MARKET = 25;
export const BAD_GENRES = new Set(["Undefined", "Other", "Miscellaneous"]);

export interface MarketData {
  market: string;
  collectedAt: string;
  window: { start: string; end: string };
  events: CompetingEvent[];
  tm: { pages: number; truncated: boolean; malformed: number };
  resolutions: Record<string, { status: string; entityId: string | null; popularity: number | null }>;
  targets: Array<{ entityId: string; name: string; genre: string | null; reason: "sample" | "cancel-study" }>;
  /** target entity id -> competitor entity id -> { affinity, popularity } */
  affinity: Record<string, Record<string, { affinity: number | null; popularity: number | null }>>;
}

const QLOO = process.env.QLOO_API_KEY;
const TM = process.env.TICKETMASTER_API_KEY;
const OUT = ".eval-data";

const h = (s: string) => createHash("sha256").update(s).digest("hex");

async function mapLimit<T, R>(xs: T[], n: number, f: (x: T) => Promise<R>) {
  const out: R[] = new Array(xs.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, xs.length) }, async () => {
      while (i < xs.length) {
        const k = i++;
        out[k] = await f(xs[k]);
      }
    }),
  );
  return out;
}

async function collectMarket(id: string, qloo: QlooClient, start: string, end: string): Promise<MarketData> {
  const market = getMarket(id)!;
  const tm = await searchMusicEvents(TM!, { market, radiusMiles: 30, startDate: start, endDate: end });
  const events = tm.events.filter((e) => e.performers.length > 0);
  console.log(`  ${id}: ${events.length} events (${tm.pagesFetched} pages, truncated=${tm.truncated})`);

  const names = [...new Map(events.flatMap((e) => e.performers).map((p) => [normaliseName(p.name), p.name])).values()];
  const resolutions: MarketData["resolutions"] = {};
  let done = 0;
  await mapLimit(names, 4, async (n) => {
    let cands: ArtistCandidate[] = [];
    let status = "error";
    try {
      cands = await qloo.searchArtists(n);
      status = classifyMatch(n, cands).status;
    } catch {
      /* counted as error */
    }
    const m = status === "error" ? null : classifyMatch(n, cands);
    resolutions[normaliseName(n)] = { status, entityId: m?.status === "exact" ? m.entity!.entityId : null, popularity: m?.entity?.popularity ?? null };
    if (++done % 50 === 0) console.log(`    resolved ${done}/${names.length}`);
  });

  // Performer -> genre (Ticketmaster attraction genre, falling back to event genre).
  const genreOf = new Map<string, string | null>();
  for (const e of events) for (const p of e.performers) {
    const g = p.genre ?? e.genre;
    if (!genreOf.has(normaliseName(p.name)) || (!genreOf.get(normaliseName(p.name)) && g)) genreOf.set(normaliseName(p.name), g);
  }
  const resolvedIds = new Map<string, { name: string; genre: string | null }>();
  for (const [k, r] of Object.entries(resolutions)) if (r.entityId) resolvedIds.set(r.entityId, { name: k, genre: genreOf.get(k) ?? null });

  const eligible = [...resolvedIds.entries()].filter(([, v]) => v.genre && !BAD_GENRES.has(v.genre));
  const sample = eligible.sort((a, b) => h(a[0]).localeCompare(h(b[0]))).slice(0, TARGETS_PER_MARKET);
  const targets: MarketData["targets"] = sample.map(([eid, v]) => ({ entityId: eid, name: v.name, genre: v.genre, reason: "sample" as const }));

  // E3: every cancelled/postponed event with a resolved performer also becomes a target.
  for (const e of events.filter((x) => x.status === "canceled" || x.status === "postponed")) {
    for (const p of e.performers) {
      const r = resolutions[normaliseName(p.name)];
      if (r?.entityId && !targets.some((t) => t.entityId === r.entityId)) {
        targets.push({ entityId: r.entityId, name: normaliseName(p.name), genre: genreOf.get(normaliseName(p.name)) ?? null, reason: "cancel-study" });
      }
    }
  }

  const all = [...resolvedIds.keys()];
  const affinity: MarketData["affinity"] = {};
  await mapLimit(targets, 2, async (t) => {
    const sig = await qloo.affinities(t.entityId, all.filter((x) => x !== t.entityId)).catch((err) => {
      console.log(`    affinity failed for target ${t.name}: ${err instanceof Error ? err.message : err}`);
      return null;
    });
    if (!sig) return;
    affinity[t.entityId] = Object.fromEntries(Object.entries(sig).map(([k, v]) => [k, { affinity: v.affinity, popularity: v.popularity }]));
  });
  console.log(`  ${id}: ${names.length} performers, ${resolvedIds.size} resolved, ${targets.length} targets, ${Object.keys(affinity).length} with affinity`);

  return {
    market: id,
    collectedAt: new Date().toISOString(),
    window: { start, end },
    events,
    tm: { pages: tm.pagesFetched, truncated: tm.truncated, malformed: tm.malformed },
    resolutions,
    targets,
    affinity,
  };
}

async function main() {
  if (!QLOO || !TM) {
    console.error("QLOO_API_KEY and TICKETMASTER_API_KEY are required in .env.local");
    process.exit(1);
  }
  mkdirSync(OUT, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  const start = addDays(today, 21);
  const end = addDays(start, 41);
  const qloo = new QlooClient(QLOO, process.env.QLOO_BASE_URL ?? "https://hackathon.api.qloo.com");
  console.log(`Collecting ${EVAL_MARKETS.length} markets, window ${start}..${end}`);
  for (const m of EVAL_MARKETS) {
    const file = `${OUT}/${m}.json`;
    if (existsSync(file)) {
      console.log(`  ${m}: already collected, skipping`);
      continue;
    }
    const data = await collectMarket(m, qloo, start, end);
    writeFileSync(file, JSON.stringify(data));
  }
  console.log("Done. Data in .eval-data/ (never commit it). Next: npm run eval:run");
}

if (process.argv[1]?.includes("eval-collect")) main();
