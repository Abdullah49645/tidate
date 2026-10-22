/**
 * Live validation of the Qloo and Ticketmaster operations Undertow depends on.
 *
 *   npm run validate:live
 *
 * Requires QLOO_API_KEY and TICKETMASTER_API_KEY in .env.local.
 * Raw responses are written to .validation/ (gitignored) for local inspection
 * only. Qloo response data must not be committed to the public repository.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { QlooClient, parseEntity } from "../src/lib/qloo/client";
import { classifyMatch } from "../src/lib/qloo/resolve";
import { searchMusicEvents } from "../src/lib/ticketmaster/client";
import { getMarket } from "../src/lib/markets";
import { addDays } from "../src/lib/scoring/engine";

const QLOO = process.env.QLOO_API_KEY;
const TM = process.env.TICKETMASTER_API_KEY;
const BASE = process.env.QLOO_BASE_URL ?? "https://hackathon.api.qloo.com";
const OUT = ".validation";
mkdirSync(OUT, { recursive: true });

const save = (name: string, data: unknown) => writeFileSync(`${OUT}/${name}.json`, JSON.stringify(data, null, 2));
const keysOf = (o: unknown): string[] => (o && typeof o === "object" ? Object.keys(o as object).sort() : []);
const log = (...a: unknown[]) => console.log(...a);

async function raw(path: string, params: Record<string, string>) {
  const url = `${BASE}${path}?${new URLSearchParams(params)}`;
  const t0 = Date.now();
  const res = await fetch(url, { headers: { "X-Api-Key": QLOO! } });
  const ms = Date.now() - t0;
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* keep text */
  }
  return { status: res.status, ms, json, text: json ? undefined : text.slice(0, 300), headers: Object.fromEntries([...res.headers].filter(([k]) => /rate|limit|retry|quota/i.test(k))) };
}

async function validateQloo() {
  log("\n=== QLOO ===");
  if (!QLOO) return log("SKIPPED: QLOO_API_KEY not set");

  // 1. Search
  const names = ["Clairo", "Phoebe Bridgers", "beabadoobee", "Slipknot", "Morgan Wallen", "Laufey", "Bush", "Genesis", "The National"];
  const ids: Record<string, string> = {};
  for (const n of names) {
    const r = await raw("/search", { query: n, types: "urn:entity:artist", take: "5" });
    save(`search-${n.replace(/\W+/g, "_")}`, r);
    const results = (r.json as { results?: unknown[] } | null)?.results ?? [];
    const first = results[0];
    const parsed = results.map(parseEntity).filter(Boolean);
    const m = classifyMatch(
      n,
      parsed.map((p) => ({ entityId: p!.entityId, name: p!.name, popularity: p!.popularity, disambiguation: p!.disambiguation })),
    );
    if (m.entity) ids[n] = m.entity.entityId;
    log(
      `search "${n}": HTTP ${r.status} ${r.ms}ms, ${results.length} results, match=${m.status}`,
      `\n   top-level keys: ${keysOf(r.json).join(",")}`,
      `\n   result[0] keys: ${keysOf(first).join(",")}`,
      `\n   result[0] types: ${JSON.stringify((first as { types?: unknown })?.types)} popularity type: ${typeof (first as { popularity?: unknown })?.popularity}`,
      Object.keys(r.headers).length ? `\n   rate headers: ${JSON.stringify(r.headers)}` : "",
    );
  }

  // 2. Insights affinity with filter.results.entities
  const target = ids["Clairo"];
  if (!target) return log("Cannot test insights: Clairo did not resolve");
  const comp = ["Phoebe Bridgers", "beabadoobee", "Laufey", "Slipknot", "Morgan Wallen", "The National"].map((n) => ids[n]).filter(Boolean);
  const ins = await raw("/v2/insights", {
    "filter.type": "urn:entity:artist",
    "signal.interests.entities": target,
    "filter.results.entities": comp.join(","),
    take: String(comp.length),
  });
  save("insights-filter-results", ins);
  const ents = ((ins.json as { results?: { entities?: unknown[] } })?.results?.entities ?? []) as unknown[];
  log(`\ninsights filter.results.entities: HTTP ${ins.status} ${ins.ms}ms, requested ${comp.length}, returned ${ents.length}`);
  log(`   top-level keys: ${keysOf(ins.json).join(",")}; results keys: ${keysOf((ins.json as { results?: unknown })?.results).join(",")}`);
  log(`   entity keys: ${keysOf(ents[0]).join(",")}`);
  log(`   entity.query keys: ${keysOf((ents[0] as { query?: unknown })?.query).join(",")}`);
  for (const e of ents) {
    const p = parseEntity(e);
    const name = Object.entries(ids).find(([, v]) => v === p?.entityId)?.[0];
    log(`   ${name ?? p?.name}: affinity=${p?.affinity} popularity=${p?.popularity}`);
  }
  const returnedIds = new Set(ents.map((e) => parseEntity(e)?.entityId));
  const notReturned = comp.filter((c) => !returnedIds.has(c));
  log(`   requested but not returned: ${notReturned.length}`);

  // 3. Unfiltered recommendations: affinity distribution for context
  const recs = await raw("/v2/insights", { "filter.type": "urn:entity:artist", "signal.interests.entities": target, take: "50" });
  save("insights-unfiltered", recs);
  const rents = ((recs.json as { results?: { entities?: unknown[] } })?.results?.entities ?? []).map(parseEntity).filter(Boolean);
  const affs = rents.map((e) => e!.affinity).filter((x): x is number => x !== null);
  if (affs.length) {
    affs.sort((a, b) => a - b);
    log(`\nunfiltered top-${rents.length}: affinity min=${affs[0].toFixed(3)} median=${affs[Math.floor(affs.length / 2)].toFixed(3)} max=${affs[affs.length - 1].toFixed(3)}`);
  } else log(`\nunfiltered: HTTP ${recs.status}, no affinities parsed`);

  // 4. Same request via client (chunking, parsing)
  const client = new QlooClient(QLOO, BASE);
  const sig = await client.affinities(target, comp);
  log(`client.affinities parsed ${Object.values(sig).filter((s) => s.affinity !== null).length}/${comp.length} with affinity`);

  // 5. Large filter list: does it accept 50 ids?
  const many = rents.slice(0, 50).map((e) => e!.entityId);
  if (many.length >= 20) {
    const big = await raw("/v2/insights", {
      "filter.type": "urn:entity:artist",
      "signal.interests.entities": target,
      "filter.results.entities": many.join(","),
      take: "50",
    });
    const n = ((big.json as { results?: { entities?: unknown[] } })?.results?.entities ?? []).length;
    log(`filter.results.entities with ${many.length} ids: HTTP ${big.status}, returned ${n}`);
  }

  // 6. Heatmap (optional feature)
  const hm = await raw("/v2/insights", { "filter.type": "urn:heatmap", "signal.interests.entities": target, "filter.location.query": "Chicago" });
  save("heatmap-chicago", hm);
  const cells = ((hm.json as { results?: { heatmap?: unknown[] } })?.results?.heatmap ?? []) as unknown[];
  log(`\nheatmap Chicago: HTTP ${hm.status} ${hm.ms}ms, ${cells.length} cells; cell keys: ${keysOf(cells[0]).join(",")}; query keys: ${keysOf((cells[0] as { query?: unknown })?.query).join(",")}`);
  if (hm.status !== 200) log(`   body: ${hm.text ?? JSON.stringify(hm.json).slice(0, 300)}`);
}

async function validateTicketmaster() {
  log("\n=== TICKETMASTER ===");
  if (!TM) return log("SKIPPED: TICKETMASTER_API_KEY not set");
  const market = getMarket("chicago")!;
  const today = new Date().toISOString().slice(0, 10);
  const r = await searchMusicEvents(TM, { market, radiusMiles: 30, startDate: addDays(today, 14), endDate: addDays(today, 44) });
  save("tm-chicago", { meta: { ...r, events: r.events.length }, sample: r.events.slice(0, 3) });
  const status: Record<string, number> = {};
  const genres: Record<string, number> = {};
  let noAttr = 0,
    noDate = 0,
    multi = 0;
  for (const e of r.events) {
    status[e.status] = (status[e.status] ?? 0) + 1;
    if (e.genre) genres[e.genre] = (genres[e.genre] ?? 0) + 1;
    if (!e.performers.length) noAttr++;
    if (!e.localDate) noDate++;
    if (e.performers.length > 1) multi++;
  }
  log(`Chicago 30-day window: ${r.events.length} events, ${r.pagesFetched} pages, totalReported=${r.totalReported}, truncated=${r.truncated}, malformed=${r.malformed}`);
  log(`   status: ${JSON.stringify(status)}`);
  log(`   no attractions: ${noAttr}, no local date: ${noDate}, multi-act bills: ${multi}`);
  log(`   genres: ${JSON.stringify(Object.entries(genres).sort((a, b) => b[1] - a[1]).slice(0, 12))}`);
  const performers = new Set(r.events.flatMap((e) => e.performers.map((p) => p.name)));
  log(`   distinct performers: ${performers.size}`);
}

(async () => {
  await validateTicketmaster();
  await validateQloo();
  log("\nRaw responses written to .validation/ (gitignored). Do not commit them.");
})().catch((e) => {
  console.error("Validation failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
