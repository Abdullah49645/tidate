/**
 * Undertow scoring engine.
 *
 * Pure, deterministic, dependency-free. Used by the web pipeline, the agent
 * tools, the MCP server, the evaluation scripts and the browser (for
 * interactive what-if recalculation). No network, no clock, no randomness.
 *
 *   C(d) = sum over in-window events i of  A_i * S_i * W(|d - d_i|)
 *
 *   A_i  relative affinity: the percentile of the act's Qloo affinity (given the
 *        target-act signal) among all matched acts in the market window. Live
 *        validation showed raw Qloo affinity is compressed (unrelated acts ~0.74,
 *        near-identical acts ~0.98), so the percentile is used for weighting and
 *        the raw value is kept for display. Falls back to raw when not provided.
 *   S_i  size weight = Qloo global popularity percentile (0.5 if missing, flagged)
 *   W    temporal proximity weight (step function below)
 *
 * These are modelling choices, not validated truths. See docs/METHODOLOGY.md.
 */

import type {
  CompetingEvent,
  Contribution,
  DateScore,
  EvidenceQuality,
  ExcludedEvent,
  RankingVerdict,
  UncertaintyFlag,
} from "../types";

export const SCORING_VERSION = "undertow-score/1.2.0";

/**
 * Closeness emphasis applied to relative affinity: weight = rel ^ AFFINITY_EXPONENT.
 * Chosen from a stated principle, not fitted to outcomes: an act of typical
 * affinity for the market (rel 0.5) should count about a tenth as much as an act
 * in the top tenth (rel 0.9): 0.5^4 / 0.9^4 = 0.095.
 */
export const AFFINITY_EXPONENT = 4;

/** Neutral size weight used when Qloo returns no popularity for a matched act. */
export const IMPUTED_POPULARITY = 0.5;

/** Temporal proximity bands (inclusive upper bound in days -> weight). */
export const TEMPORAL_BANDS: ReadonlyArray<{ maxDays: number; weight: number; label: string }> = [
  { maxDays: 0, weight: 1.0, label: "same day" },
  { maxDays: 2, weight: 0.7, label: "1–2 days" },
  { maxDays: 7, weight: 0.4, label: "3–7 days" },
  { maxDays: 14, weight: 0.15, label: "8–14 days" },
];
export const WINDOW_DAYS = 14;

export function temporalWeight(daysApart: number): number {
  if (!Number.isFinite(daysApart)) return 0;
  const d = Math.abs(Math.round(daysApart));
  for (const band of TEMPORAL_BANDS) if (d <= band.maxDays) return band.weight;
  return 0;
}

export function temporalBandLabel(daysApart: number): string {
  const d = Math.abs(Math.round(daysApart));
  for (const band of TEMPORAL_BANDS) if (d <= band.maxDays) return band.label;
  return "outside window";
}

/** Whole-day difference between two YYYY-MM-DD calendar dates (b - a). */
export function dayDiff(a: string, b: string): number {
  const ta = Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10));
  const tb = Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10));
  return Math.round((tb - ta) / 86_400_000);
}

export function addDays(date: string, days: number): string {
  const t = Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

export function normaliseName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/^the\s+/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/* ------------------------------------------------------------------ */
/* Event preparation: exclusions and de-duplication                    */
/* ------------------------------------------------------------------ */

export interface PreparedEvents {
  eligible: CompetingEvent[];
  excluded: ExcludedEvent[];
}

/**
 * Removes events that must not contribute to a score, with an explicit reason
 * for each. Ticketmaster often lists the same show several times (VIP
 * packages, platinum seats, separate venue records); those are collapsed to
 * one record keyed on (local date, primary performer name).
 */
export function prepareEvents(
  events: CompetingEvent[],
  opts: { targetNames: string[]; targetAttractionIds?: string[] },
): PreparedEvents {
  const targetNames = new Set(opts.targetNames.map(normaliseName).filter(Boolean));
  const targetIds = new Set((opts.targetAttractionIds ?? []).filter(Boolean));
  const eligible: CompetingEvent[] = [];
  const excluded: ExcludedEvent[] = [];
  const seen = new Set<string>();

  const sorted = [...events].sort((a, b) => a.eventId.localeCompare(b.eventId));
  for (const e of sorted) {
    const base = { eventId: e.eventId, name: e.name, localDate: e.localDate };
    const isTarget = e.performers.some(
      (p) => (p.attractionId && targetIds.has(p.attractionId)) || targetNames.has(normaliseName(p.name)),
    );
    if (isTarget) {
      excluded.push({ ...base, reason: "target-act" });
      continue;
    }
    if (e.status === "canceled") {
      excluded.push({ ...base, reason: "canceled" });
      continue;
    }
    if (e.status === "postponed") {
      excluded.push({ ...base, reason: "postponed" });
      continue;
    }
    if (!e.localDate) {
      excluded.push({ ...base, reason: "date-tba" });
      continue;
    }
    // Same act on the same day counts once, even if listed at two venue records or as VIP packages.
    const primary = normaliseName(e.performers[0]?.name ?? e.name);
    const key = `${e.localDate}|${primary}`;
    if (seen.has(key)) {
      excluded.push({ ...base, reason: "duplicate" });
      continue;
    }
    seen.add(key);
    eligible.push(e);
  }
  return { eligible, excluded };
}

/* ------------------------------------------------------------------ */
/* Scoring                                                             */
/* ------------------------------------------------------------------ */

/** Resolved performer for one event: Qloo entity id (null if not confidently resolved). */
export interface PerformerLink {
  name: string;
  entityId: string | null;
}

export interface SignalLookup {
  /** Raw Qloo affinity (query.affinity). */
  affinity: number | null;
  popularity: number | null;
  /** Percentile of `affinity` within the market pool (0..1). Used for weighting when present. */
  relAffinity?: number | null;
}

/**
 * Mid-rank percentile of each entity's raw affinity among all entities with an
 * affinity value: (count below + half of ties) / n. Deterministic and
 * order-independent. Entities without affinity get null.
 */
export function relativeAffinities(signals: Record<string, SignalLookup>): Record<string, SignalLookup> {
  const vals = Object.values(signals)
    .map((s) => s.affinity)
    .filter((a): a is number => a !== null && Number.isFinite(a))
    .sort((a, b) => a - b);
  const n = vals.length;
  const out: Record<string, SignalLookup> = {};
  for (const [id, s] of Object.entries(signals)) {
    if (s.affinity === null || !Number.isFinite(s.affinity) || n === 0) {
      out[id] = { ...s, relAffinity: null };
      continue;
    }
    let lo = 0;
    while (lo < n && vals[lo] < s.affinity) lo++;
    let hi = lo;
    while (hi < n && vals[hi] === s.affinity) hi++;
    out[id] = { ...s, relAffinity: (lo + (hi - lo) / 2) / n };
  }
  return out;
}

export interface ScoreInput {
  candidateDates: string[];
  events: CompetingEvent[]; // already prepared (eligible only)
  /** eventId -> performers with their confident Qloo entity ids. */
  links: Record<string, PerformerLink[]>;
  /** Qloo entity id -> signal. */
  signals: Record<string, SignalLookup>;
  /** eventIds the user chose to leave out of the what-if calculation. */
  ignoredEventIds?: string[];
  /**
   * Contribution of a typical matched act at full timing weight (median of
   * affinity weight x size over matched acts). Used to estimate unscored shows
   * "as if typical" for the second robustness check. Defaults to 0.
   */
  typicalUnit?: number;
}

function finite01(x: number | null | undefined): number | null {
  if (x === null || x === undefined || !Number.isFinite(x)) return null;
  return Math.min(1, Math.max(0, x));
}

export function scoreContribution(
  date: string,
  event: CompetingEvent,
  links: PerformerLink[],
  signals: Record<string, SignalLookup>,
  typicalUnit = 0,
): Contribution {
  const daysApart = dayDiff(date, event.localDate!);
  const w = temporalWeight(daysApart);
  const flags: UncertaintyFlag[] = [];
  if (event.status === "rescheduled") flags.push("rescheduled");

  let best: {
    name: string;
    entityId: string;
    affinity: number;
    weight: number;
    relAffinity: number | null;
    popularity: number | null;
    size: number;
    product: number;
  } | null = null;
  let anyResolved = false;
  let anyMissingAffinity = false;

  for (const link of links) {
    if (!link.entityId) continue;
    anyResolved = true;
    const sig = signals[link.entityId];
    const affinity = finite01(sig?.affinity);
    if (affinity === null) {
      anyMissingAffinity = true;
      continue;
    }
    const relAffinity = finite01(sig?.relAffinity);
    const weight = relAffinity !== null ? Math.pow(relAffinity, AFFINITY_EXPONENT) : affinity;
    const popularity = finite01(sig?.popularity);
    const size = popularity ?? IMPUTED_POPULARITY;
    const product = weight * size;
    if (
      !best ||
      product > best.product ||
      (product === best.product && link.entityId.localeCompare(best.entityId) < 0)
    ) {
      best = { name: link.name, entityId: link.entityId, affinity, weight, relAffinity, popularity, size, product };
    }
  }

  if (!best) {
    if (!anyResolved) flags.push("unresolved-performer");
    else if (anyMissingAffinity) flags.push("affinity-missing");
  } else if (best.popularity === null) {
    flags.push("popularity-imputed");
  }

  const contribution = best ? best.product * w : null;
  return {
    candidateDate: date,
    eventId: event.eventId,
    eventName: event.name,
    eventDate: event.localDate!,
    venueName: event.venue.name,
    performer: best?.name ?? links[0]?.name ?? event.performers[0]?.name ?? null,
    qlooEntityId: best?.entityId ?? null,
    daysApart,
    temporalWeight: w,
    affinity: best?.affinity ?? null,
    relativeAffinity: best?.relAffinity ?? null,
    affinityWeight: best?.weight ?? null,
    popularity: best?.popularity ?? null,
    sizeWeight: best?.size ?? null,
    contribution,
    // Worst case for an unscoreable event: perfect affinity at full size.
    upperBound: contribution ?? w,
    typicalEstimate: contribution ?? typicalUnit * w,
    scored: contribution !== null,
    flags,
  };
}

export function evidenceQuality(contribs: Contribution[]): EvidenceQuality {
  const total = contribs.reduce((s, c) => s + c.temporalWeight, 0);
  if (contribs.length === 0 || total === 0) return "no-competition-found";
  const scored = contribs.filter((c) => c.scored).reduce((s, c) => s + c.temporalWeight, 0);
  const coverage = scored / total;
  if (coverage >= 0.8) return "strong";
  if (coverage >= 0.5) return "partial";
  return "weak";
}

/** Temporally-weighted share of in-window events that could be scored (0..1). */
export function weightedCoverage(contribs: Contribution[]): number | null {
  const total = contribs.reduce((s, c) => s + c.temporalWeight, 0);
  if (total === 0) return null;
  return contribs.filter((c) => c.scored).reduce((s, c) => s + c.temporalWeight, 0) / total;
}

function sumScored(contribs: Contribution[]): number {
  // Sum in a fixed order so totals are bit-for-bit reproducible.
  return [...contribs]
    .filter((c) => c.scored)
    .sort((a, b) => a.eventId.localeCompare(b.eventId))
    .reduce((s, c) => s + (c.contribution ?? 0), 0);
}

export function scoreDates(input: ScoreInput): DateScore[] {
  const ignored = new Set(input.ignoredEventIds ?? []);
  const dates = [...input.candidateDates];

  const raw = dates.map((date) => {
    const contributions: Contribution[] = [];
    for (const e of input.events) {
      if (!e.localDate || ignored.has(e.eventId)) continue;
      const w = temporalWeight(dayDiff(date, e.localDate));
      if (w === 0) continue;
      contributions.push(scoreContribution(date, e, input.links[e.eventId] ?? [], input.signals, input.typicalUnit ?? 0));
    }
    contributions.sort(
      (a, b) =>
        (b.contribution ?? -1) - (a.contribution ?? -1) ||
        b.upperBound - a.upperBound ||
        a.eventId.localeCompare(b.eventId),
    );
    const score = sumScored(contributions);
    const upperBound = score + contributions.filter((c) => !c.scored).reduce((s, c) => s + c.upperBound, 0);
    const typicalScore = score + contributions.filter((c) => !c.scored).reduce((s, c) => s + c.typicalEstimate, 0);
    const baselineWeighted = contributions.reduce((s, c) => s + c.temporalWeight, 0);
    return {
      date,
      score,
      upperBound,
      typicalScore,
      rank: 0,
      baselineCount: contributions.length,
      baselineWeighted,
      baselineRank: 0,
      inWindowEvents: contributions.length,
      scoredEvents: contributions.filter((c) => c.scored).length,
      evidence: evidenceQuality(contributions),
      contributions,
      explanation: "",
    } satisfies DateScore;
  });

  const byScore = [...raw].sort(
    (a, b) => a.score - b.score || a.baselineWeighted - b.baselineWeighted || a.date.localeCompare(b.date),
  );
  byScore.forEach((d, i) => (d.rank = i + 1));
  const byBaseline = [...raw].sort((a, b) => a.baselineWeighted - b.baselineWeighted || a.date.localeCompare(b.date));
  byBaseline.forEach((d, i) => (d.baselineRank = i + 1));

  for (const d of raw) d.explanation = explainDate(d);
  return raw.sort((a, b) => a.rank - b.rank);
}

/* ------------------------------------------------------------------ */
/* Verdict, robustness and counterfactuals                             */
/* ------------------------------------------------------------------ */

const fmt = (x: number) => x.toFixed(2);
const pct = (x: number) => `${Math.round(x * 100)}%`;

export function explainDate(d: DateScore): string {
  if (d.inWindowEvents === 0) {
    return `No competing music events found on Ticketmaster within ${WINDOW_DAYS} days. This reflects Ticketmaster coverage only.`;
  }
  const parts: string[] = [];
  const shows = d.inWindowEvents === 1 ? "1 competing show" : `${d.inWindowEvents} competing shows`;
  parts.push(`${shows} within ${WINDOW_DAYS} days.`);
  const top = d.contributions.find((c) => c.scored && (c.contribution ?? 0) > 0);
  if (top && d.score > 0) {
    const share = (top.contribution ?? 0) / d.score;
    const when =
      top.daysApart === 0
        ? "the same night"
        : `${Math.abs(top.daysApart)} day${Math.abs(top.daysApart) === 1 ? "" : "s"} ${top.daysApart > 0 ? "later" : "earlier"}`;
    parts.push(
      `${pct(share)} of the score comes from ${top.performer ?? top.eventName} at ${top.venueName}, ${when} (Qloo affinity ${fmt(top.affinity ?? 0)}${top.relativeAffinity !== null ? `, higher than ${pct(top.relativeAffinity)} of acts nearby` : ""}; popularity ${top.popularity === null ? "imputed" : fmt(top.popularity)}).`,
    );
    const concentrated = share >= 0.6;
    parts.push(concentrated ? "Risk is concentrated in one show." : "Risk is spread across several shows.");
  }
  const unscored = d.inWindowEvents - d.scoredEvents;
  if (unscored > 0) {
    parts.push(`${unscored} show${unscored === 1 ? "" : "s"} could not be scored (performer not matched in Qloo or no affinity returned).`);
  }
  return parts.join(" ");
}

export function buildVerdict(dates: DateScore[]): RankingVerdict {
  if (dates.length === 0) {
    return {
      recommendedDate: null,
      robust: false,
      holdsIfTypical: false,
      margin: null,
      baselineAgrees: false,
      summary: "No candidate dates to rank.",
      whatWouldChange: [],
    };
  }
  const ordered = [...dates].sort((a, b) => a.rank - b.rank);
  const best = ordered[0];
  const rest = ordered.slice(1);
  const runnerUp = rest[0] ?? null;
  const margin = runnerUp ? runnerUp.score - best.score : null;
  const robust = rest.every((o) => best.upperBound < o.score);
  // Second tier: unscored shows on every date assumed to be as close as a typical matched act.
  const holdsIfTypical = rest.every((o) => best.typicalScore < o.typicalScore);
  const baselineBest = [...dates].sort((a, b) => a.baselineRank - b.baselineRank)[0];
  const baselineAgrees = baselineBest.date === best.date;

  const whatWouldChange: string[] = [];
  if (!robust && !holdsIfTypical) {
    const unscored = best.contributions.filter((c) => !c.scored).sort((a, b) => b.upperBound - a.upperBound);
    for (const c of unscored.slice(0, 2)) {
      whatWouldChange.push(
        `${c.performer ?? c.eventName} (${c.eventDate}) on ${best.date}'s window could not be scored; if it overlaps strongly with your audience, ${runnerUp?.date ?? "another date"} could become the lower-risk choice.`,
      );
    }
  }
  // A show that moves or is cancelled leaves every date's window, so the
  // counterfactual removes its contribution from all dates before re-ranking.
  const contribOf = (d: DateScore, eventId: string) => d.contributions.find((c) => c.eventId === eventId && c.scored)?.contribution ?? 0;
  for (const o of rest) {
    // Largest single show on date `o` whose removal would make `o` the strict lowest.
    const flip = o.contributions.find((c) => {
      if (!c.scored) return false;
      const after = o.score - contribOf(o, c.eventId);
      return dates.every((x) => x.date === o.date || after < x.score - contribOf(x, c.eventId));
    });
    if (flip) {
      whatWouldChange.push(
        `If ${flip.performer ?? flip.eventName} (${flip.eventDate}, ${flip.venueName}) moved or were cancelled, ${o.date} would rank first.`,
      );
    }
  }

  let summary: string;
  if (ordered.length === 1) {
    summary = `Only one candidate date (${best.date}); its estimated clash score is ${fmt(best.score)}.`;
  } else if (margin !== null && margin === 0) {
    summary = `${best.date} and ${runnerUp!.date} are tied on estimated clash risk; the tie is broken by fewer nearby shows.`;
  } else {
    summary = `${best.date} has the lowest estimated audience-competition risk (score ${fmt(best.score)} vs ${fmt(runnerUp!.score)} for the next date).`;
  }
  if (!baselineAgrees && ordered.length > 1) {
    summary += ` A plain count of nearby shows would have picked ${baselineBest.date} instead.`;
  }
  return { recommendedDate: best.date, robust, holdsIfTypical: ordered.length === 1 ? true : holdsIfTypical, margin, baselineAgrees, summary, whatWouldChange };
}

export interface DateDiffRow {
  eventId: string;
  eventName: string;
  performer: string | null;
  eventDate: string;
  venueName: string;
  a: number | null; // contribution to date A (null = not in window or unscored)
  b: number | null;
  delta: number; // (a ?? 0) - (b ?? 0)
}

/** Which events account for the difference between two dates' scores. */
export function diffDates(a: DateScore, b: DateScore): DateDiffRow[] {
  const rows = new Map<string, DateDiffRow>();
  const touch = (c: Contribution) =>
    rows.get(c.eventId) ??
    rows
      .set(c.eventId, {
        eventId: c.eventId,
        eventName: c.eventName,
        performer: c.performer,
        eventDate: c.eventDate,
        venueName: c.venueName,
        a: null,
        b: null,
        delta: 0,
      })
      .get(c.eventId)!;
  for (const c of a.contributions) touch(c).a = c.contribution;
  for (const c of b.contributions) touch(c).b = c.contribution;
  for (const r of rows.values()) r.delta = (r.a ?? 0) - (r.b ?? 0);
  return [...rows.values()].sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta) || x.eventId.localeCompare(y.eventId));
}

/** Median of (affinity weight x size) over matched acts with an affinity: the "typical act" unit. */
export function typicalUnit(signals: Record<string, SignalLookup>): number {
  const vals: number[] = [];
  for (const s of Object.values(signals)) {
    const a = finite01(s.affinity);
    if (a === null) continue;
    const rel = finite01(s.relAffinity);
    const w = rel !== null ? Math.pow(rel, AFFINITY_EXPONENT) : a;
    vals.push(w * (finite01(s.popularity) ?? IMPUTED_POPULARITY));
  }
  if (!vals.length) return 0;
  vals.sort((x, y) => x - y);
  const m = Math.floor(vals.length / 2);
  return vals.length % 2 ? vals[m] : (vals[m - 1] + vals[m]) / 2;
}
