"use client";

import { AFFINITY_EXPONENT, IMPUTED_POPULARITY, TEMPORAL_BANDS } from "@/lib/scoring/engine";
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
          <p className="formula">Clash score = Σ closeness × popularity × timing</p>
          <p>
            Qloo gives every act an affinity with your artist. Most acts land in a narrow band, so Tidate ranks each one against the other acts playing
            nearby: closeness is that rank raised to the power {AFFINITY_EXPONENT}, which makes an act in the top tenth count about ten times as much as a
            typical one. It&apos;s multiplied by the act&apos;s Qloo popularity and a timing weight: {TEMPORAL_BANDS.map((b) => `${b.label} ${b.weight}`).join(", ")}. When
            popularity is missing, {IMPUTED_POPULARITY.toFixed(2)} is used and the show is marked.
          </p>
          <p>
            Shows Qloo can&apos;t match are left out of the score. The ranking is checked twice against them: as if each were a perfect match for your audience
            (worst case), and as if each were a typical act nearby.
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
            {count("not-checked") > 0 && <li>{count("not-checked")} far from your dates weren&apos;t looked up in time. Running again checks more.</li>}
            {unmatched.length > 0 && (
              <li>
                Not scored, for example: {unmatched.filter((r) => r.status !== "not-checked").slice(0, 5).map((r) => r.inputName).join(", ")}
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
