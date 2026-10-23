"use client";

import { WINDOW_DAYS, addDays } from "@/lib/scoring/engine";
import type { DateScore } from "@/lib/types";
import { fmt2, fmtDay, fmtShort } from "./format";

/**
 * Four weeks around one candidate date. Bars are each show's Qloo-weighted
 * pull; dots under the axis are every show, as a plain count sees them.
 */
export function Timeline({ d, scale }: { d: DateScore; scale: number }) {
  const span = WINDOW_DAYS * 2 + 1;
  const days = Array.from({ length: span }, (_, i) => i - WINDOW_DAYS);
  const byDay = new Map<number, DateScore["contributions"]>();
  for (const c of d.contributions) byDay.set(c.daysApart, [...(byDay.get(c.daysApart) ?? []), c]);
  const pct = (v: number) => Math.max(2, Math.min(100, (v / scale) * 100));
  const ticks = [-14, -7, 0, 7, 14];

  return (
    <div className="card timeline">
      <div className="timeline-head">
        <h3>Two weeks either side of {fmtDay(d.date)}</h3>
        <div className="legend" aria-hidden>
          <span>
            <i className="lg-bar" />
            Pull on your audience
          </span>
          <span>
            <i className="lg-dash" />
            Not matched, shown as a typical act
          </span>
          <span>
            <i className="lg-dot" />
            Every show
          </span>
        </div>
      </div>

      <div
        className="tl-grid"
        role="img"
        aria-label={`${d.inWindowEvents} shows within two weeks of ${fmtDay(d.date)}. Clash score ${fmt2(d.score)}.`}
      >
        {days.map((k, i) => (
          <div key={k} className={`tl-col${k === 0 ? " target" : ""}`} style={{ ["--i" as string]: i }}>
            <div className="tl-bars">
              {(byDay.get(k) ?? []).map((c) => (
                <span
                  key={c.eventId}
                  className={`tl-bar${c.scored ? "" : " unscored"}`}
                  style={{ height: `${c.scored ? pct(c.contribution ?? 0) : pct(c.typicalEstimate)}%` }}
                  title={`${c.performer ?? c.eventName}, ${fmtShort(c.eventDate)}: ${c.scored ? fmt2(c.contribution) : "not matched in Qloo (drawn as a typical act)"}`}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="tl-axis" aria-hidden>
        {days.map((k) => (
          <div key={k} className="tl-dots">
            {(byDay.get(k) ?? []).map((c) => (
              <i key={c.eventId} />
            ))}
          </div>
        ))}
      </div>
      <div className="tl-labels" aria-hidden>
        {ticks.map((k) => (
          <span key={k} className={k === 0 ? "target" : undefined} style={{ left: `${((k + WINDOW_DAYS + 0.5) / span) * 100}%` }}>
            {k === 0 ? fmtShort(d.date) : fmtShort(addDays(d.date, k))}
          </span>
        ))}
      </div>
    </div>
  );
}
