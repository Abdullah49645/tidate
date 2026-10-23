import { getMarket } from "./markets";
import { classifyMatch, resolveArtist } from "./qloo/resolve";
import {
  SCORING_VERSION,
  WINDOW_DAYS,
  addDays,
  buildVerdict,
  dayDiff,
  normaliseName,
  prepareEvents,
  relativeAffinities,
  scoreDates,
  typicalUnit,
  type PerformerLink,
  type SignalLookup,
} from "./scoring/engine";
import type { EventSearchResult } from "./ticketmaster/client";
import {
  AnalysisRequestSchema,
  type AffinitySignal,
  type AnalysisRequestInput,
  type AnalysisResult,
  type ArtistCandidate,
  type ArtistResolution,
  type Diagnostic,
} from "./types";
import type { Market } from "./markets";

/** Data access used by the pipeline. Live and demo implementations share all logic below. */
export interface DataProvider {
  mode: "live" | "demo";
  /**
   * Time budget for performer lookups (ms). Performers are looked up closest-show
   * first; any not reached are marked "not-checked" and left unscored.
   */
  resolveBudgetMs?: number;
  searchEvents(p: { market: Market; radiusMiles: number; startDate: string; endDate: string }): Promise<EventSearchResult>;
  searchArtists(name: string): Promise<ArtistCandidate[]>;
  affinities(targetEntityId: string, entityIds: string[]): Promise<Record<string, AffinitySignal>>;
}

export type StepId = "validate" | "target" | "events" | "performers" | "affinity" | "score" | "verify";

export const STEP_LABELS: Record<StepId, string> = {
  validate: "Checking the request",
  target: "Resolving your artist in Qloo",
  events: "Searching the Ticketmaster calendar",
  performers: "Matching competing performers to Qloo",
  affinity: "Retrieving Qloo affinity signals",
  score: "Scoring candidate dates",
  verify: "Checking the evidence",
};

export interface ProgressEvent {
  step: StepId;
  status: "running" | "done" | "warning" | "error";
  detail?: string;
}

export type PipelineOutcome =
  | { kind: "result"; result: AnalysisResult }
  | { kind: "clarify"; message: string; target: ArtistResolution }
  | { kind: "invalid"; message: string; issues: string[] }
  | { kind: "error"; message: string; step: StepId };

const RESOLVE_CONCURRENCY = 6;

/**
 * Ticketmaster sometimes lists an event with no performer ("Clairo – Charm Tour").
 * The part of the title before a separator is used as a candidate name; it is
 * still subject to the strict exact-match policy, so a vague title stays unmatched.
 */
export function performerFromTitle(title: string): string | null {
  const head = title
    .replace(/\(.*?\)|\[.*?\]/g, " ")
    .split(/\s+(?:-|–|—|:|\||@|w\/|with|feat\.?|ft\.?|featuring|presents|live at|live in)\s+|:\s+/i)[0]
    .replace(/\s+/g, " ")
    .trim();
  return head.length >= 2 && head.length <= 60 ? head : null;
}

/** Splits a single-name bill on commas, slashes and plus signs. */
export function splitBill(name: string): string[] {
  const parts = name
    .split(/\s*,\s*|\s+\/\s+|\s+\+\s+/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 2 && !/^(tba|tbd|and more|more|special guests?)$/i.test(x));
  return parts.length >= 2 ? [...new Set(parts)] : [];
}

function withTitlePerformer(e: import("./types").CompetingEvent): import("./types").CompetingEvent {
  if (e.performers.length > 0) return e;
  const name = performerFromTitle(e.name);
  return name ? { ...e, performers: [{ attractionId: null, name, genre: e.genre, fromTitle: true }] } : e;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

export async function runAnalysis(
  provider: DataProvider,
  input: AnalysisRequestInput,
  onProgress: (e: ProgressEvent) => void = () => {},
): Promise<PipelineOutcome> {
  const diagnostics: Diagnostic[] = [];

  /* 1. Validate ------------------------------------------------------ */
  onProgress({ step: "validate", status: "running" });
  const parsed = AnalysisRequestSchema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "request"}: ${i.message}`);
    onProgress({ step: "validate", status: "error", detail: issues[0] });
    return { kind: "invalid", message: "The request is not valid.", issues };
  }
  const req = parsed.data;
  const market = getMarket(req.marketId);
  if (!market) {
    onProgress({ step: "validate", status: "error", detail: "Unknown market" });
    return { kind: "invalid", message: "Unknown market.", issues: [`marketId: ${req.marketId} is not supported`] };
  }
  const dates = [...req.candidateDates].sort();
  const windowStart = addDays(dates[0], -WINDOW_DAYS);
  const windowEnd = addDays(dates[dates.length - 1], WINDOW_DAYS);
  onProgress({ step: "validate", status: "done", detail: `${market.label}, ${dates.length} date${dates.length > 1 ? "s" : ""}` });

  /* 2. Target artist ------------------------------------------------- */
  onProgress({ step: "target", status: "running", detail: req.artist });
  let target: ArtistResolution;
  if (req.artistEntityId) {
    const candidates = await provider.searchArtists(req.artist).catch(() => [] as ArtistCandidate[]);
    const match = candidates.find((c) => c.entityId === req.artistEntityId);
    target = {
      inputName: req.artist,
      status: "confirmed",
      entity: match ?? { entityId: req.artistEntityId, name: req.artist, popularity: null, disambiguation: null },
      candidates,
      provenance: { source: provider.mode === "demo" ? "demo-fixture" : "qloo", retrievedAt: new Date().toISOString(), request: "user-confirmed entity id" },
    };
  } else {
    target = await resolveArtist((n) => provider.searchArtists(n), req.artist);
    if (provider.mode === "demo") target.provenance.source = "demo-fixture";
  }
  if (target.status === "error") {
    onProgress({ step: "target", status: "error", detail: target.note });
    return { kind: "error", step: "target", message: `Could not reach Qloo to resolve "${req.artist}": ${target.note ?? "unknown error"}` };
  }
  if (!target.entity || (target.status !== "exact" && target.status !== "confirmed")) {
    onProgress({ step: "target", status: "warning", detail: "Needs confirmation" });
    const msg =
      target.status === "not-found"
        ? `Qloo has no artist matching "${req.artist}". Check the spelling or try another name.`
        : `"${req.artist}" did not resolve to a single Qloo artist. Pick the right one to continue.`;
    return { kind: "clarify", message: msg, target };
  }
  const targetId = target.entity.entityId;
  onProgress({ step: "target", status: "done", detail: target.entity.name });

  /* 3. Events -------------------------------------------------------- */
  onProgress({ step: "events", status: "running", detail: `${windowStart} → ${windowEnd}` });
  let search: EventSearchResult;
  try {
    search = await provider.searchEvents({ market, radiusMiles: req.radiusMiles, startDate: windowStart, endDate: windowEnd });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Ticketmaster search failed";
    onProgress({ step: "events", status: "error", detail: message });
    return { kind: "error", step: "events", message: `Ticketmaster is unavailable: ${message}` };
  }
  if (search.truncated) {
    diagnostics.push({ level: "warning", code: "tm-truncated", message: "Ticketmaster returned more events than its 1,000-result paging limit; some events in the window may be missing." });
  }
  if (search.malformed > 0) {
    diagnostics.push({ level: "info", code: "tm-malformed", message: `${search.malformed} Ticketmaster record(s) had an unexpected shape and were skipped.` });
  }
  const inRange = search.events.map(withTitlePerformer).filter((e) => !e.localDate || dates.some((d) => Math.abs(dayDiff(d, e.localDate!)) <= WINDOW_DAYS));
  const prepared = prepareEvents(inRange, { targetNames: [req.artist, target.entity.name] });
  onProgress({
    step: "events",
    status: "done",
    detail: `${search.events.length} music events found, ${prepared.eligible.length} eligible after exclusions`,
  });

  /* 4. Performer resolution ----------------------------------------- */
  // Priority: performers whose shows are closest to a candidate date are looked up first.
  const names = new Map<string, { name: string; gap: number }>(); // normalised -> display + nearest gap
  for (const e of prepared.eligible) {
    const gap = e.localDate ? Math.min(...dates.map((d) => Math.abs(dayDiff(d, e.localDate!)))) : 99;
    for (const p of e.performers) {
      const k = normaliseName(p.name);
      const cur = names.get(k);
      if (!cur || gap < cur.gap) names.set(k, { name: p.name, gap });
    }
  }
  const queue = [...names.values()].sort((a, b) => a.gap - b.gap || a.name.localeCompare(b.name));
  onProgress({ step: "performers", status: "running", detail: `${names.size} distinct performers` });
  const deadline = provider.resolveBudgetMs ? Date.now() + provider.resolveBudgetMs : Infinity;
  const resolutionsList = await mapLimit(queue, RESOLVE_CONCURRENCY, async ({ name }): Promise<ArtistResolution> => {
    if (Date.now() > deadline) {
      return {
        inputName: name,
        status: "not-checked",
        entity: null,
        candidates: [],
        provenance: { source: provider.mode === "demo" ? "demo-fixture" : "qloo", retrievedAt: new Date().toISOString(), request: "skipped: lookup time budget reached" },
        note: "Not looked up within the time limit",
      };
    }
    return resolveArtist((x) => provider.searchArtists(x), name);
  });
  const resolutions: Record<string, ArtistResolution> = {};
  for (const r of resolutionsList) {
    if (provider.mode === "demo") r.provenance.source = "demo-fixture";
    resolutions[normaliseName(r.inputName)] = r;
  }

  // Bills listed as a single name ("Ok Goodnight, Snooze, Eve"): only when the full
  // name did not match, look up each part. Parts must still match exactly.
  const splitOf = new Map<string, string[]>();
  for (const r of resolutionsList) {
    if (r.status !== "weak" && r.status !== "not-found") continue;
    const parts = splitBill(r.inputName);
    if (parts.length >= 2) splitOf.set(normaliseName(r.inputName), parts);
  }
  const partQueue = [...new Set([...splitOf.values()].flat())].filter((x) => !resolutions[normaliseName(x)]);
  const partResolutions = await mapLimit(partQueue, RESOLVE_CONCURRENCY, async (name) =>
    Date.now() > deadline ? null : resolveArtist((x) => provider.searchArtists(x), name),
  );
  for (const r of partResolutions) {
    if (!r) continue;
    if (provider.mode === "demo") r.provenance.source = "demo-fixture";
    resolutions[normaliseName(r.inputName)] = r;
  }
  for (const e of prepared.eligible) {
    const extra = e.performers.flatMap((p) =>
      (splitOf.get(normaliseName(p.name)) ?? [])
        .filter((part) => resolutions[normaliseName(part)]?.status === "exact")
        .map((part) => ({ attractionId: null, name: part, genre: p.genre, fromSplit: true })),
    );
    if (extra.length) e.performers = [...e.performers, ...extra];
  }
  resolutionsList.push(...partResolutions.filter((r): r is ArtistResolution => !!r && r.status === "exact"));
  const errors = resolutionsList.filter((r) => r.status === "error").length;
  const matched = Object.values(resolutions).filter((r) => r.status === "exact").length;
  const skipped = resolutionsList.filter((r) => r.status === "not-checked").length;
  if (skipped > 0) {
    diagnostics.push({ level: "warning", code: "lookup-budget", message: `${skipped} performer(s) far from your dates weren't looked up within the time limit and are left unscored. Running again uses cached lookups and checks more.` });
  }
  if (errors > 0) {
    diagnostics.push({ level: "warning", code: "qloo-search-errors", message: `${errors} performer lookup(s) failed at Qloo and were left unscored.` });
  }
  if (errors > 0 && errors === resolutionsList.length && resolutionsList.length > 0) {
    onProgress({ step: "performers", status: "error", detail: "All Qloo lookups failed" });
    return { kind: "error", step: "performers", message: "Qloo did not respond to any performer lookups. No scores were produced rather than guessing." };
  }

  // Events whose performer resolves to the target act itself are the target's own shows.
  const ownShows = prepared.eligible.filter((e) => e.performers.some((p) => resolutions[normaliseName(p.name)]?.entity?.entityId === targetId));
  if (ownShows.length) {
    const ownIds = new Set(ownShows.map((e) => e.eventId));
    prepared.eligible = prepared.eligible.filter((e) => !ownIds.has(e.eventId));
    for (const e of ownShows) prepared.excluded.push({ eventId: e.eventId, name: e.name, localDate: e.localDate, reason: "target-act" });
  }
  if (prepared.excluded.some((x) => x.reason === "target-act")) {
    diagnostics.push({ level: "info", code: "target-already-booked", message: `${target.entity.name} already has a listed show in this market window; it is excluded from the competition score.` });
  }

  const links: Record<string, PerformerLink[]> = {};
  for (const e of prepared.eligible) {
    links[e.eventId] = e.performers.map((p) => {
      const r = resolutions[normaliseName(p.name)];
      return { name: p.name, entityId: r && r.status === "exact" && r.entity ? r.entity.entityId : null };
    });
  }
  onProgress({
    step: "performers",
    status: errors ? "warning" : "done",
    detail: `${matched} of ${names.size} matched confidently`,
  });

  /* 5. Affinity ------------------------------------------------------ */
  const entityIds = [...new Set(Object.values(links).flat().map((l) => l.entityId).filter((x): x is string => !!x))];
  onProgress({ step: "affinity", status: "running", detail: `${entityIds.length} artists vs ${target.entity.name}` });
  let affinities: Record<string, AffinitySignal> = {};
  if (entityIds.length) {
    try {
      affinities = await provider.affinities(targetId, entityIds);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Qloo insights failed";
      onProgress({ step: "affinity", status: "error", detail: message });
      return { kind: "error", step: "affinity", message: `Qloo affinity lookup failed: ${message}. No scores were produced rather than guessing.` };
    }
  }
  // Popularity fallback: the same Qloo popularity field from the search result.
  const popFromSearch = new Map<string, number>();
  for (const r of resolutionsList) if (r.entity && r.entity.popularity !== null) popFromSearch.set(r.entity.entityId, r.entity.popularity);
  const rawSignals: Record<string, SignalLookup> = {};
  for (const id of entityIds) {
    const s = affinities[id];
    rawSignals[id] = { affinity: s?.affinity ?? null, popularity: s?.popularity ?? popFromSearch.get(id) ?? null };
  }
  const signals = relativeAffinities(rawSignals);
  const unit = typicalUnit(signals);
  const withAffinity = entityIds.filter((id) => signals[id].affinity !== null).length;
  if (withAffinity > 0 && withAffinity < 15) {
    diagnostics.push({ level: "info", code: "small-pool", message: `Only ${withAffinity} matched acts in this window, so "relative affinity" (rank among acts nearby) is coarse.` });
  }
  if (entityIds.length && withAffinity === 0) {
    diagnostics.push({ level: "error", code: "qloo-no-affinity", message: "Qloo returned no affinity values for any matched performer. Scores are zero for lack of evidence, not because there is no competition." });
  } else if (withAffinity < entityIds.length) {
    diagnostics.push({ level: "info", code: "qloo-partial-affinity", message: `Qloo returned affinity for ${withAffinity} of ${entityIds.length} matched performers; the rest are flagged as unscored.` });
  }
  onProgress({ step: "affinity", status: withAffinity < entityIds.length ? "warning" : "done", detail: `${withAffinity} of ${entityIds.length} returned an affinity` });

  /* 6. Score --------------------------------------------------------- */
  onProgress({ step: "score", status: "running" });
  const scored = scoreDates({ candidateDates: dates, events: prepared.eligible, links, signals, typicalUnit: unit });
  const verdict = buildVerdict(scored);
  onProgress({ step: "score", status: "done", detail: verdict.recommendedDate ? `Lowest risk: ${verdict.recommendedDate}` : undefined });

  /* 7. Verify -------------------------------------------------------- */
  onProgress({ step: "verify", status: "running" });
  for (const d of scored) {
    const sum = d.contributions.reduce((s, c) => s + (c.contribution ?? 0), 0);
    if (Math.abs(sum - d.score) > 1e-9) {
      onProgress({ step: "verify", status: "error", detail: "Breakdown does not sum to total" });
      return { kind: "error", step: "verify", message: "Internal consistency check failed: score breakdown does not sum to the total." };
    }
    if (d.evidence === "weak") {
      diagnostics.push({ level: "warning", code: "weak-evidence", message: `${d.date}: fewer than half of nearby shows (time-weighted) could be scored. Treat this date's score as a lower bound.` });
    }
  }
  if (!verdict.robust && !verdict.holdsIfTypical && scored.length > 1) {
    diagnostics.push({ level: "warning", code: "not-robust", message: "Unscored shows could change the ranking even if they were only as close to your artist as a typical act nearby." });
  }
  onProgress({
    step: "verify",
    status: "done",
    detail: verdict.robust ? "Ranking holds even in the worst case" : verdict.holdsIfTypical ? "Ranking holds unless unmatched acts are unusually close" : "Ranking sensitive to unmatched acts",
  });

  const eventIds = new Set(prepared.eligible.map((e) => e.eventId));
  const result: AnalysisResult = {
    version: SCORING_VERSION,
    mode: provider.mode,
    request: { ...req, candidateDates: dates },
    market: { id: market.id, label: market.label },
    target,
    window: { start: windowStart, end: windowEnd },
    events: prepared.eligible.filter((e) => eventIds.has(e.eventId)),
    resolutions,
    affinities,
    excluded: prepared.excluded,
    dates: scored,
    verdict,
    diagnostics,
    generatedAt: new Date().toISOString(),
  };
  return { kind: "result", result };
}

/** Re-derive links and signals from a stored result (for what-if recalculation). */
export function rebuildScoringInputs(result: AnalysisResult) {
  const links: Record<string, PerformerLink[]> = {};
  for (const e of result.events) {
    links[e.eventId] = e.performers.map((p) => {
      const r = result.resolutions[normaliseName(p.name)];
      return { name: p.name, entityId: r && (r.status === "exact" || r.status === "confirmed") && r.entity ? r.entity.entityId : null };
    });
  }
  // Same pool as the pipeline: entities linked to eligible events.
  const ids = new Set(Object.values(links).flat().map((l) => l.entityId).filter((x): x is string => !!x));
  const raw: Record<string, SignalLookup> = {};
  for (const r of Object.values(result.resolutions)) {
    if (!r.entity || !ids.has(r.entity.entityId)) continue;
    const s = result.affinities[r.entity.entityId];
    raw[r.entity.entityId] = { affinity: s?.affinity ?? null, popularity: s?.popularity ?? r.entity.popularity ?? null };
  }
  const signals = relativeAffinities(raw);
  return { links, signals, typicalUnit: typicalUnit(signals) };
}

export { classifyMatch };
