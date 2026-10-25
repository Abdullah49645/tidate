import type { AnalysisResult, ExclusionReason } from "../types";

/**
 * A watch keeps a compact snapshot of each check and compares it with the next.
 * Everything here is deterministic: the same two snapshots always produce the
 * same list of changes, and every change points at a Ticketmaster event or an
 * engine output.
 */

export interface SnapEvent {
  /** Event name as listed. */
  n: string;
  /** Performer that scores (or the first listed). */
  p: string | null;
  /** Local date, YYYY-MM-DD, or null when TBA. */
  d: string | null;
  /** Venue name. */
  v: string;
  /** Largest scored contribution to any candidate date (null when unscored). */
  w: number | null;
  /** Closeness: the act's rank among acts nearby (0..1), when matched. */
  k: number | null;
  /** Ticketmaster URL. */
  u: string | null;
}

export type Robustness = "worst-case" | "typical" | "sensitive" | "n/a";

export interface Snapshot {
  at: string;
  version: string;
  recommendedDate: string | null;
  robustness: Robustness;
  headcountBest: string | null;
  matched: number;
  performers: number;
  dates: { date: string; score: number; rank: number; baselineRank: number; inWindow: number; scored: number }[];
  events: Record<string, SnapEvent>;
  excluded: Record<string, ExclusionReason>;
}

export type Change =
  | { type: "best-night"; from: string | null; to: string | null }
  | { type: "robustness"; from: Robustness; to: Robustness }
  | { type: "new-show"; eventId: string; performer: string; venue: string; date: string | null; weight: number; closeness: number | null; url: string | null }
  | { type: "show-gone"; eventId: string; performer: string; venue: string; date: string | null; weight: number | null; reason: ExclusionReason | "unlisted" }
  | { type: "show-moved"; eventId: string; performer: string; venue: string; from: string | null; to: string | null }
  | { type: "rank"; date: string; from: number; to: number }
  | { type: "coverage"; from: number; to: number };

export interface Diff {
  changes: Change[];
  /** New listings with no pull on the dates (unmatched in Qloo, or far away in time). */
  otherNew: number;
  /** Removed listings that had no pull. */
  otherGone: number;
}

const round = (x: number) => Math.round(x * 1000) / 1000;

export function makeSnapshot(r: AnalysisResult, at = new Date().toISOString()): Snapshot {
  // Per event: its largest scored contribution across dates, and who scored it.
  const weight = new Map<string, { w: number | null; p: string | null; k: number | null }>();
  for (const d of r.dates) {
    for (const c of d.contributions) {
      const cur = weight.get(c.eventId);
      const w = c.scored ? (c.contribution ?? 0) : null;
      if (!cur) weight.set(c.eventId, { w, p: c.performer, k: c.relativeAffinity });
      else if (w !== null && (cur.w === null || w > cur.w)) weight.set(c.eventId, { w, p: c.performer, k: c.relativeAffinity });
    }
  }
  const events: Record<string, SnapEvent> = {};
  for (const e of r.events) {
    const x = weight.get(e.eventId);
    events[e.eventId] = {
      n: e.name.slice(0, 120),
      p: x?.p ?? e.performers[0]?.name ?? null,
      d: e.localDate,
      v: e.venue.name.slice(0, 80),
      w: x?.w != null ? round(x.w) : null,
      k: x?.k != null ? round(x.k) : null,
      u: e.url,
    };
  }
  const excluded: Record<string, ExclusionReason> = {};
  for (const x of r.excluded) excluded[x.eventId] = x.reason;
  const resolutions = Object.values(r.resolutions);
  const many = r.dates.length > 1;
  return {
    at,
    version: r.version,
    recommendedDate: r.verdict.recommendedDate,
    robustness: !many ? "n/a" : r.verdict.robust ? "worst-case" : r.verdict.holdsIfTypical ? "typical" : "sensitive",
    headcountBest: [...r.dates].sort((a, b) => a.baselineRank - b.baselineRank)[0]?.date ?? null,
    matched: resolutions.filter((x) => x.status === "exact" || x.status === "confirmed").length,
    performers: resolutions.length,
    dates: [...r.dates]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((d) => ({ date: d.date, score: round(d.score), rank: d.rank, baselineRank: d.baselineRank, inWindow: d.inWindowEvents, scored: d.scoredEvents })),
    events,
    excluded,
  };
}

const SHOW_LIMIT = 6;

/**
 * Changes between two checks. Shows dated before `today` that drop out of the
 * listings have simply happened, so they are not reported as removed.
 */
export function diffSnapshots(prev: Snapshot, next: Snapshot, today: string): Diff {
  const changes: Change[] = [];
  if (prev.recommendedDate !== next.recommendedDate) changes.push({ type: "best-night", from: prev.recommendedDate, to: next.recommendedDate });
  if (prev.robustness !== next.robustness && next.robustness !== "n/a") changes.push({ type: "robustness", from: prev.robustness, to: next.robustness });

  const added: Change[] = [];
  let otherNew = 0;
  for (const [id, e] of Object.entries(next.events)) {
    if (prev.events[id] || prev.excluded[id]) continue;
    if (e.w !== null && e.w > 0) {
      added.push({ type: "new-show", eventId: id, performer: e.p ?? e.n, venue: e.v, date: e.d, weight: e.w, closeness: e.k, url: e.u });
    } else otherNew += 1;
  }
  added.sort((a, b) => (b as { weight: number }).weight - (a as { weight: number }).weight);
  otherNew += Math.max(0, added.length - SHOW_LIMIT);
  changes.push(...added.slice(0, SHOW_LIMIT));

  const gone: Change[] = [];
  let otherGone = 0;
  for (const [id, e] of Object.entries(prev.events)) {
    if (next.events[id]) continue;
    if (e.d && e.d < today) continue; // it happened
    const reason = next.excluded[id] && next.excluded[id] !== "outside-window" ? next.excluded[id] : "unlisted";
    if (reason === "target-act" || reason === "duplicate") continue;
    if (e.w !== null && e.w > 0) gone.push({ type: "show-gone", eventId: id, performer: e.p ?? e.n, venue: e.v, date: e.d, weight: e.w, reason });
    else otherGone += 1;
  }
  gone.sort((a, b) => ((b as { weight: number }).weight ?? 0) - ((a as { weight: number }).weight ?? 0));
  otherGone += Math.max(0, gone.length - SHOW_LIMIT);
  changes.push(...gone.slice(0, SHOW_LIMIT));

  for (const [id, e] of Object.entries(next.events)) {
    const p = prev.events[id];
    if (p && p.d !== e.d && (e.w ?? p.w ?? 0) > 0) changes.push({ type: "show-moved", eventId: id, performer: e.p ?? e.n, venue: e.v, from: p.d, to: e.d });
  }

  const prevRank = new Map(prev.dates.map((d) => [d.date, d.rank]));
  for (const d of next.dates) {
    const from = prevRank.get(d.date);
    if (from !== undefined && from !== d.rank && next.dates.length <= 4) changes.push({ type: "rank", date: d.date, from, to: d.rank });
  }

  // More matched acts means lookups reached further (scores now count shows unscored before).
  // A drop just follows removed listings, which are reported above.
  if (next.matched > prev.matched) changes.push({ type: "coverage", from: prev.matched, to: next.matched });
  return { changes, otherNew, otherGone };
}

const ROBUST_TEXT: Record<Robustness, string> = {
  "worst-case": "holds even in the worst case",
  typical: "holds unless unmatched acts are unusually close",
  sensitive: "could change with unmatched acts",
  "n/a": "not applicable",
};

const GONE_TEXT: Record<string, string> = {
  canceled: "Cancelled",
  postponed: "Postponed",
  "date-tba": "Date now TBA",
  unlisted: "No longer listed",
};

/** Plain-language lines for a diff. Dates stay ISO; the UI formats them. */
export function describeDiff(diff: Diff, artist: string): string[] {
  const lines: string[] = [];
  for (const c of diff.changes) {
    switch (c.type) {
      case "best-night":
        lines.push(c.to ? `Best night moved from ${c.from ?? "none"} to ${c.to}.` : "There is no longer a best night to recommend.");
        break;
      case "robustness":
        lines.push(`The ranking now ${ROBUST_TEXT[c.to]} (before: ${ROBUST_TEXT[c.from]}).`);
        break;
      case "new-show":
        lines.push(
          `New listing: ${c.performer} at ${c.venue}${c.date ? ` on ${c.date}` : ""}${
            c.closeness !== null ? `, closer to ${artist}'s audience than ${Math.min(99, Math.round(c.closeness * 100))}% of acts nearby` : ""
          }.`,
        );
        break;
      case "show-gone":
        lines.push(`${GONE_TEXT[c.reason] ?? "Removed"}: ${c.performer} at ${c.venue}${c.date ? ` on ${c.date}` : ""}.`);
        break;
      case "show-moved":
        lines.push(`Moved: ${c.performer} at ${c.venue}, from ${c.from ?? "TBA"} to ${c.to ?? "TBA"}.`);
        break;
      case "rank":
        lines.push(`${c.date} now ranks ${c.to} (was ${c.from}).`);
        break;
      case "coverage":
        lines.push(`${c.to - c.from} more ${c.to - c.from === 1 ? "act" : "acts"} matched in Qloo than last time, so scores now count shows that were unscored before.`);
        break;
    }
  }
  if (diff.otherNew) lines.push(`${diff.otherNew} other new ${diff.otherNew === 1 ? "listing" : "listings"} with little or no pull.`);
  if (diff.otherGone) lines.push(`${diff.otherGone} other ${diff.otherGone === 1 ? "listing" : "listings"} with little or no pull removed.`);
  return lines.length ? lines : ["No changes since the last check."];
}

/** True when a diff contains something a promoter would want to hear about. */
export function isNotable(diff: Diff): boolean {
  return diff.changes.some((c) => c.type !== "coverage");
}
