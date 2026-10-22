"use client";

import { IMPUTED_POPULARITY, TEMPORAL_BANDS } from "@/lib/scoring/engine";
import type { AnalysisResult, ExclusionReason } from "@/lib/types";
import { fmtTime, humanizeDates } from "./format";
import { Chevron } from "./icons";

const REASON: Record<ExclusionReason, string> = {
  "target-act": "your artist's own show",
  canceled: "cancelled",
  postponed: "postponed with no date",
  "date-tba": "date not announced",
  duplicate: "duplicate listing",
  "outside-window": "outside the window",
};

export function Details({ result, whatWouldChange }: { result: AnalysisResult; whatWouldChange: string[] }) {
  const res = Object.values(result.resolutions);
  const count = (s: string) => res.filter((r) => r.status === s).length;
  const matched = count("exact") + count("confirmed");
  const unmatched = res.filter((r) => r.status !== "exact" && r.status !== "confirmed");
  const reasons = new Map<string, number>();
  for (const x of result.excluded) reasons.set(REASON[x.reason], (reasons.get(REASON[x.reason]) ?? 0) + 1);
  const tmTime = result.events[0]?.provenance.retrievedAt;
  const demo = result.mode === "demo";

  return (
    <div className="disclosures">
      {whatWouldChange.length > 0 && (
        <details>
          <summary>
            <span className="label">What would change the answer</span>
            <span className="meta">{whatWouldChange.length}</span>
            <Chevron size={12} />
          </summary>
          <div className="disclosure-body">
            <ul>
              {whatWouldChange.map((w, i) => (
                <li key={i}>{humanizeDates(w)}</li>
              ))}
            </ul>
          </div>
        </details>
      )}

      <details>
        <summary>
          <span className="label">How the score works</span>
          <Chevron size={12} />
        </summary>
        <div className="disclosure-body">
          <p className="formula">Clash score = Σ affinity × popularity × timing</p>
          <p>
            For each show within two weeks, Qloo&apos;s affinity between that act and your artist is multiplied by the act&apos;s Qloo popularity and a timing
            weight: {TEMPORAL_BANDS.map((b) => `${b.label} ${b.weight}`).join(", ")}. When popularity is missing, {IMPUTED_POPULARITY.toFixed(2)} is used and the
            show is marked.
          </p>
          <p>
            The ranking is called robust when it would hold even if every show that couldn&apos;t be scored turned out to be a perfect match for your audience.
          </p>
        </div>
      </details>

      <details>
        <summary>
          <span className="label">What it doesn&apos;t measure</span>
          <Chevron size={12} />
        </summary>
        <div className="disclosure-body">
          <ul>
            <li>Affinity comes from Qloo&apos;s taste graph. It suggests overlapping audiences; it doesn&apos;t count shared ticket buyers.</li>
            <li>Popularity is global, not specific to {result.market.label}.</li>
            <li>Shows that aren&apos;t on Ticketmaster can&apos;t be seen.</li>
            <li>A lower score isn&apos;t a forecast of ticket sales.</li>
          </ul>
        </div>
      </details>

      <details>
        <summary>
          <span className="label">Data coverage</span>
          <span className="meta">
            {matched} of {res.length} artists matched
          </span>
          <Chevron size={12} />
        </summary>
        <div className="disclosure-body">
          <ul>
            {unmatched.length > 0 && (
              <li>
                Not scored: {unmatched.slice(0, 5).map((r) => r.inputName).join(", ")}
                {unmatched.length > 5 ? ` and ${unmatched.length - 5} more` : ""}.
              </li>
            )}
            {reasons.size > 0 && <li>Left out: {[...reasons].map(([r, n]) => `${n} ${r}`).join(", ")}.</li>}
            {result.diagnostics.map((d) => (
              <li key={d.code} className={d.level === "error" ? "err" : d.level === "warning" ? "warn" : undefined}>
                {humanizeDates(d.message)}
              </li>
            ))}
          </ul>
        </div>
      </details>

      <details>
        <summary>
          <span className="label">Sources</span>
          <Chevron size={12} />
        </summary>
        <div className="disclosure-body">
          {demo ? (
            <p>Demo data. Every artist, venue and value is fictional and comes from neither Ticketmaster nor Qloo.</p>
          ) : (
            <ul>
              <li>
                Events: Ticketmaster Discovery API, music within {result.request.radiusMiles} miles of {result.market.label}
                {tmTime ? `, retrieved ${fmtTime(tmTime)}` : ""}.
              </li>
              <li>Artist matching: Qloo entity search.</li>
              <li>Affinity and popularity: Qloo Insights, with {result.target.entity?.name} as the signal.</li>
            </ul>
          )}
          <p style={{ marginTop: 8 }}>
            Scoring {result.version}. Generated {fmtTime(result.generatedAt)}.
          </p>
        </div>
      </details>
    </div>
  );
}
