"use client";

import type { DateScore } from "@/lib/types";
import { CountUp } from "./CountUp";
import { fmtDay } from "./format";

const EVIDENCE: Record<DateScore["evidence"], string> = {
  strong: "Strong",
  partial: "Partial",
  weak: "Weak",
  "no-competition-found": "No shows found",
};

export function DateCards({
  dates,
  best,
  selected,
  onSelect,
  total,
}: {
  /** Ranks out of this many (defaults to the number of cards). */
  total?: number;
  dates: DateScore[];
  best: string | null;
  selected: string | null;
  onSelect: (d: string) => void;
}) {
  const max = Math.max(0.0001, ...dates.map((d) => d.score));
  const ordered = [...dates].sort((a, b) => a.date.localeCompare(b.date));
  return (
    <div className="date-cards">
      {ordered.map((d) => {
        const top = d.contributions.find((c) => c.scored && (c.contribution ?? 0) > 0);
        const isBest = d.date === best && dates.length > 1 && dates.some((x) => x.scoredEvents > 0);
        return (
          <button key={d.date} type="button" className="date-card" aria-pressed={selected === d.date} onClick={() => onSelect(d.date)}>
            <div className={`tag${isBest ? " best" : ""}`}>{isBest ? "Best night" : `Ranked ${d.rank} of ${total ?? dates.length}`}</div>
            <div className="day">{fmtDay(d.date)}</div>
            <div className="score-row">
              <span className="score">
                <CountUp value={d.score} />
              </span>
              <span className="score-label">clash score</span>
            </div>
            <div className="meter" aria-hidden>
              <span style={{ width: `${Math.max(2, (d.score / max) * 100)}%` }} />
            </div>
            <dl>
              <div>
                <dt>Nearby shows</dt>
                <dd>{d.inWindowEvents}</dd>
              </div>
              <div>
                <dt>Biggest pull</dt>
                <dd>{top ? (top.performer ?? top.eventName) : "None"}</dd>
              </div>
              <div>
                <dt>Matched in Qloo</dt>
                <dd title={`Evidence: ${EVIDENCE[d.evidence]}`}>
                  {d.inWindowEvents ? `${d.scoredEvents} of ${d.inWindowEvents}` : "–"}
                </dd>
              </div>
            </dl>
          </button>
        );
      })}
    </div>
  );
}
