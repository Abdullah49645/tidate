"use client";

import type { ProvisionalRanking } from "@/lib/types";
import { fmt2, fmtDay } from "./format";

/**
 * The ranking from the lookups finished so far, shown while the rest run. It is
 * labelled provisional: matched acts are still being added, and each act's
 * closeness is ranked against a pool that is still growing.
 */
export function Provisional({ p, limit = 4 }: { p: ProvisionalRanking; limit?: number }) {
  const ordered = [...p.dates].sort((a, b) => a.rank - b.rank).slice(0, limit);
  const max = Math.max(0.0001, ...p.dates.map((d) => d.score));
  return (
    <div className="provisional" aria-live="polite">
      <p className="provisional-head">
        <span>So far</span>
        {p.checked} of {p.total} acts looked up
      </p>
      <div className="provisional-list" role="list">
        {ordered.map((d) => (
          <div key={d.date} role="listitem" className="provisional-row">
            <span className="n">{d.rank}</span>
            <span className="d">{fmtDay(d.date)}</span>
            <span className="bar" aria-hidden>
              <span style={{ width: `${Math.max(2, (d.score / max) * 100)}%` }} />
            </span>
            <span className="v">{fmt2(d.score)}</span>
          </div>
        ))}
      </div>
      {p.dates.length > limit && <p className="provisional-more">Best {limit} of {p.dates.length} nights</p>}
    </div>
  );
}
