"use client";

import type { DateScore } from "@/lib/types";
import { fmt2, fmtDay, fmtShort } from "./format";

/** Mean closeness rank (0..1) of scored shows, time-weighted so near shows dominate. */
function meanCloseness(d: DateScore): number | null {
  const s = d.contributions.filter((c) => c.scored && (c.relativeAffinity ?? c.affinity) !== null);
  const w = s.reduce((a, c) => a + c.temporalWeight, 0);
  return w ? s.reduce((a, c) => a + (c.relativeAffinity ?? c.affinity ?? 0) * c.temporalWeight, 0) / w : null;
}

const pctOf = (x: number | null | undefined) => `${Math.round((x ?? 0) * 100)}%`;

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
  const ma = meanCloseness(q);
  const busiest = [...dates].sort((x, y) => y.baselineWeighted - x.baselineWeighted)[0];
  const top = b.contributions.find((c) => c.scored);
  return (
    <>
      <strong>
        A headcount sends you to {fmtShort(b.date)}. Qloo says {fmtShort(q.date)}.
      </strong>{" "}
      {busiest.date === q.date && ma !== null
        ? ma < 0.4
          ? `${fmtShort(q.date)} is the busier stretch, but its shows sit mostly away from ${artist}'s audience: on average they're closer than only ${pctOf(ma)} of acts nearby. `
          : `${fmtShort(q.date)} is the busier stretch, but its shows are about as close to ${artist}'s audience as a typical act nearby${
              (q.contributions.find((c) => c.scored)?.contribution ?? 0) < (top?.contribution ?? 0) ? `, and none pulls as hard as the biggest show around ${fmtShort(b.date)}` : ""
            }. `
        : ""}
      {top
        ? `${fmtShort(b.date)} looks quieter, yet ${top.performer ?? top.eventName} plays ${top.daysApart === 0 ? "the same night" : `${Math.abs(top.daysApart)} day${Math.abs(top.daysApart) === 1 ? "" : "s"} away`}, and sits closer to ${artist}'s audience than ${pctOf(top.relativeAffinity ?? top.affinity)} of acts nearby.`
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
          <p>The same shows, closer dates counting more, every act counted alike.</p>
          <ol className="rank-list">
            {b.map((d, i) => (
              <li key={d.date} className={i === 0 ? "first" : undefined}>
                <span className="n">{i + 1}</span>
                <span>{fmtDay(d.date)}</span>
                <span className="v" title={`${d.inWindowEvents} shows within two weeks, weighted by how close each is to the date`}>
                  {d.baselineWeighted.toFixed(1)} weighted
                  <small>
                    {d.inWindowEvents} {d.inWindowEvents === 1 ? "show" : "shows"}
                  </small>
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
