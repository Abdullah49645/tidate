"use client";

import { IMPUTED_POPULARITY, TEMPORAL_BANDS } from "@/lib/scoring/engine";
import type { AnalysisResult, ExclusionReason } from "@/lib/types";
import { fmtTime } from "./format";

const REASON: Record<ExclusionReason, string> = {
  "target-act": "your artist's own show",
  canceled: "cancelled",
  postponed: "postponed, no date",
  "date-tba": "date not announced",
  duplicate: "duplicate listing",
  "outside-window": "outside the window",
};

export function EvidencePanel({ result }: { result: AnalysisResult }) {
  const resolutions = Object.values(result.resolutions);
  const count = (s: string) => resolutions.filter((r) => r.status === s).length;
  const unmatched = resolutions.filter((r) => r.status !== "exact" && r.status !== "confirmed");
  const reasons = new Map<string, number>();
  for (const x of result.excluded) reasons.set(REASON[x.reason], (reasons.get(REASON[x.reason]) ?? 0) + 1);
  const demo = result.mode === "demo";
  const tmTime = result.events[0]?.provenance.retrievedAt;

  return (
    <div className="panel evidence">
      <div>
        <h3>Where the numbers come from</h3>
        {demo ? (
          <p>Demo fixture: fictional artists, venues and values written for this demonstration. Nothing here comes from Ticketmaster or Qloo.</p>
        ) : (
          <ul>
            <li>
              Events: Ticketmaster Discovery API, music within {result.request.radiusMiles} miles of {result.market.label}, {result.window.start} to {result.window.end}
              {tmTime ? `, retrieved ${fmtTime(tmTime)}` : ""}.
            </li>
            <li>Performer matching: Qloo entity search.</li>
            <li>Affinity and popularity: Qloo Insights, with {result.target.entity?.name} as the signal.</li>
          </ul>
        )}
        <p className="hint">Scoring {result.version}, generated {fmtTime(result.generatedAt)}.</p>
      </div>

      <div>
        <h3>What the score measures</h3>
        <p>
          Clash score = sum over nearby shows of Qloo affinity × popularity × timing weight. Timing weights:{" "}
          {TEMPORAL_BANDS.map((b) => `${b.label} ${b.weight}`).join(", ")}, beyond 14 days 0. Missing popularity uses {IMPUTED_POPULARITY.toFixed(2)}.
        </p>
      </div>

      <div>
        <h3>What it does not measure</h3>
        <ul>
          <li>Affinity is Qloo&apos;s taste-graph signal, a proxy for audience overlap, not a count of shared ticket buyers.</li>
          <li>Popularity is global, not local to {result.market.label}.</li>
          <li>Shows not listed on Ticketmaster are invisible here.</li>
          <li>A lower score is not a forecast of ticket sales.</li>
        </ul>
      </div>

      <div className="wide">
        <h3>Data gaps in this run</h3>
        <ul>
          <li>
            {count("exact") + count("confirmed")} of {resolutions.length} performers matched to Qloo confidently
            {unmatched.length ? `; ${count("ambiguous")} ambiguous, ${count("weak")} no exact name match, ${count("not-found")} not found, ${count("error")} lookup errors` : ""}.
          </li>
          {unmatched.length > 0 && (
            <li>
              Unscored performers include {unmatched.slice(0, 4).map((r) => r.inputName).join(", ")}
              {unmatched.length > 4 ? ` and ${unmatched.length - 4} more` : ""}.
            </li>
          )}
          {reasons.size > 0 && (
            <li>
              Left out: {[...reasons].map(([r, n]) => `${n} ${r}`).join(", ")}.
            </li>
          )}
          {result.diagnostics.map((d) => (
            <li key={d.code} className={d.level === "error" ? "diag-error" : d.level === "warning" ? "diag-warning" : undefined}>
              {d.message}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
