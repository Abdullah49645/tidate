"use client";

import type { DateScore } from "@/lib/types";
import { fmt2, fmtDay, fmtShort } from "./format";

function meanAffinity(d: DateScore): number | null {
  const s = d.contributions.filter((c) => c.scored && c.affinity !== null);
  return s.length ? s.reduce((a, c) => a + (c.affinity ?? 0), 0) / s.length : null;
}

/** Deterministic explanation of where the two rankings differ, built from the data. */
function note(dates: DateScore[], artist: string) {
  if (dates.length < 2) return <>Add another date to compare the two methods.</>;
  const q = [...dates].sort((a, b) => a.rank - b.rank)[0];
  const b = [...dates].sort((a, b) => a.baselineRank - b.baselineRank)[0];
  if (q.date === b.date) {
    return (
      <>
        <strong>Both pick {fmtShort(q.date)}.</strong> Here Qloo confirms the headcount rather than changing the decision.
      </>
    );
  }
  const ma = meanAffinity(q);
  const busiest = [...dates].sort((x, y) => y.baselineWeighted - x.baselineWeighted)[0];
  const top = b.contributions.find((c) => c.scored);
  return (
    <>
      <strong>
        A headcount sends you to {fmtShort(b.date)}. Qloo says {fmtShort(q.date)}.
      </strong>{" "}
      {busiest.date === q.date && ma !== null
        ? `${fmtShort(q.date)} is the busiest stretch, but those acts share little with ${artist}'s audience (average affinity ${fmt2(ma)}). `
        : ""}
      {top
        ? `${fmtShort(b.date)} looks quieter, yet ${top.performer ?? top.eventName} plays ${top.daysApart === 0 ? "the same night" : `${Math.abs(top.daysApart)} day${Math.abs(top.daysApart) === 1 ? "" : "s"} away`} with an affinity of ${fmt2(top.affinity)}.`
        : ""}
    </>
  );
}

export function Versus({ dates, artist }: { dates: DateScore[]; artist: string }) {
  const q = [...dates].sort((a, b) => a.rank - b.rank);
  const b = [...dates].sort((a, b) => a.baselineRank - b.baselineRank);
  return (
    <>
      <div className="versus">
        <div className="card qloo">
          <h3>With Qloo</h3>
          <p>Each show weighted by how much its audience overlaps with {artist}&apos;s.</p>
          <ol className="rank-list">
            {q.map((d, i) => (
              <li key={d.date} className={i === 0 ? "first" : undefined}>
                <span className="n">{i + 1}</span>
                <span>{fmtDay(d.date)}</span>
                <span className="v">{fmt2(d.score)}</span>
              </li>
            ))}
          </ol>
        </div>
        <div className="card">
          <h3>Headcount</h3>
          <p>The same shows and timing, every show counted alike.</p>
          <ol className="rank-list">
            {b.map((d, i) => (
              <li key={d.date} className={i === 0 ? "first" : undefined}>
                <span className="n">{i + 1}</span>
                <span>{fmtDay(d.date)}</span>
                <span className="v">
                  {d.inWindowEvents} {d.inWindowEvents === 1 ? "show" : "shows"}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>
      <p className="versus-note">{note(dates, artist)}</p>
    </>
  );
}
