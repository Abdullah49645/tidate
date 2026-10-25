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

const ROW = 64;

/**
 * Slope chart: the headcount ranking on the left, Qloo's on the right, one line
 * per date. When Qloo reorders the dates the lines cross, so its effect is seen,
 * not described. The line for Qloo's pick is drawn in the accent colour.
 */
export function Versus({ dates, artist }: { dates: DateScore[]; artist: string }) {
  const q = [...dates].sort((a, b) => a.rank - b.rank);
  const b = [...dates].sort((a, b) => a.baselineRank - b.baselineRank);
  const n = dates.length;
  const h = n * ROW;
  const y = (rank: number) => (rank - 0.5) * ROW;
  const pick = q[0]?.date;
  const agrees = b[0]?.date === pick;

  return (
    <>
      <div className="slope" style={{ ["--rows" as string]: n }}>
        <div className="slope-head left">
          <h3>Headcount</h3>
          <p>Every nearby show counted alike, closer dates counting more.</p>
        </div>
        <div />
        <div className="slope-head right">
          <h3>With Qloo</h3>
          <p>Each show weighted by how close its audience is to {artist}&apos;s.</p>
        </div>

        <ol className="slope-col left" aria-label="Ranked by headcount">
          {b.map((d, i) => (
            <li key={d.date} className={d.date === pick ? "pick" : undefined}>
              <span className="n">{i + 1}</span>
              <span className="d">{fmtDay(d.date)}</span>
              <small>
                {d.inWindowEvents} shows<span className="wide-only">, {d.baselineWeighted.toFixed(1)} weighted</span>
              </small>
            </li>
          ))}
        </ol>

        <svg className="slope-lines" viewBox={`0 0 100 ${h}`} preserveAspectRatio="none" aria-hidden>
          {dates.map((d) => {
            const y1 = y(d.baselineRank);
            const y2 = y(d.rank);
            const isPick = d.date === pick;
            return (
              <g key={d.date} className={isPick ? "pick" : undefined}>
                <path d={`M 0 ${y1} C 50 ${y1}, 50 ${y2}, 100 ${y2}`} vectorEffect="non-scaling-stroke" />
              </g>
            );
          })}
        </svg>

        <ol className="slope-col right" aria-label="Ranked with Qloo">
          {q.map((d, i) => (
            <li key={d.date} className={d.date === pick ? "pick" : undefined}>
              <span className="n">{i + 1}</span>
              <span className="d">{fmtDay(d.date)}</span>
              <small>clash score {fmt2(d.score)}</small>
            </li>
          ))}
        </ol>
      </div>
      <p className={`versus-note${agrees ? " agrees" : ""}`}>{note(dates, artist)}</p>
    </>
  );
}
