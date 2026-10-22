"use client";

import type { DateScore } from "@/lib/types";
import { fmt2, fmtDay, fmtShort } from "./format";

function meanAffinity(d: DateScore): number | null {
  const s = d.contributions.filter((c) => c.scored && c.affinity !== null);
  if (!s.length) return null;
  return s.reduce((a, c) => a + (c.affinity ?? 0), 0) / s.length;
}

/** Deterministic, data-derived explanation of where the two methods disagree. */
export function baselineNote(dates: DateScore[], artist: string): string {
  if (dates.length < 2) return "Add a second date to compare the two methods.";
  const q = [...dates].sort((a, b) => a.rank - b.rank)[0];
  const b = [...dates].sort((a, b) => a.baselineRank - b.baselineRank)[0];
  if (q.date === b.date) {
    return `Both methods pick ${fmtShort(q.date)}. Qloo affinity confirms the count here rather than changing the decision.`;
  }
  const busiest = [...dates].sort((x, y) => y.baselineWeighted - x.baselineWeighted)[0];
  const parts = [`The methods disagree. A count favours ${fmtShort(b.date)}; Qloo weighting favours ${fmtShort(q.date)}.`];
  const ma = meanAffinity(q);
  if (busiest.date === q.date && ma !== null) {
    parts.push(
      `${fmtShort(q.date)} has the most nearby shows (${q.inWindowEvents}), but their average affinity with ${artist} is only ${fmt2(ma)}, so they pull less on the same audience.`,
    );
  }
  const top = b.contributions.find((c) => c.scored);
  if (top) {
    parts.push(
      `${fmtShort(b.date)} has fewer shows, but ${top.performer ?? top.eventName} (affinity ${fmt2(top.affinity)}, ${top.daysApart === 0 ? "same night" : `${Math.abs(top.daysApart)} days away`}) is a direct draw on the same fans.`,
    );
  }
  return parts.join(" ");
}

export function BaselinePanel({ dates, artist }: { dates: DateScore[]; artist: string }) {
  const q = [...dates].sort((a, b) => a.rank - b.rank);
  const b = [...dates].sort((a, b) => a.baselineRank - b.baselineRank);
  return (
    <div className="panel">
      <div className="versus">
        <div>
          <h3>Qloo-weighted</h3>
          <p>Each nearby show weighted by affinity with {artist}, popularity and timing.</p>
          <ol>
            {q.map((d, i) => (
              <li key={d.date} className={i === 0 ? "top" : undefined}>
                {fmtDay(d.date)}, score {fmt2(d.score)}
              </li>
            ))}
          </ol>
        </div>
        <div>
          <h3>Plain count</h3>
          <p>Same shows, same timing weights, every show counted alike.</p>
          <ol>
            {b.map((d, i) => (
              <li key={d.date} className={i === 0 ? "top" : undefined}>
                {fmtDay(d.date)}, {d.inWindowEvents} shows (weighted {d.baselineWeighted.toFixed(2)})
              </li>
            ))}
          </ol>
        </div>
      </div>
      <p className="versus-note">{baselineNote(dates, artist)}</p>
    </div>
  );
}
