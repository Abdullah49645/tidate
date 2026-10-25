"use client";

import { useState } from "react";
import type { DateScore } from "@/lib/types";
import { fmt2, fmtDay } from "./format";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOW = ["S", "M", "T", "W", "T", "F", "S"];

function monthsBetween(from: string, to: string): { y: number; m: number }[] {
  const out: { y: number; m: number }[] = [];
  let y = +from.slice(0, 4);
  let m = +from.slice(5, 7) - 1;
  const ey = +to.slice(0, 4);
  const em = +to.slice(5, 7) - 1;
  while (y < ey || (y === ey && m <= em)) {
    out.push({ y, m });
    m += 1;
    if (m === 12) {
      m = 0;
      y += 1;
    }
  }
  return out;
}

const iso = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/**
 * Every searched night on a month calendar, shaded by how much pull it carries
 * on the artist's audience (darker is more). The three best nights are numbered;
 * the night a plain headcount would choose is underlined, so the two answers can
 * be compared at a glance.
 */
export function NightCalendar({
  dates,
  from,
  to,
  selected,
  onSelect,
  skipped,
  onToggleSkip,
  canSkip,
}: {
  dates: DateScore[];
  from: string;
  to: string;
  selected: string | null;
  onSelect: (d: string) => void;
  /** Nights the user left out; drawn crossed out and restored with a click. */
  skipped: Set<string>;
  onToggleSkip: (d: string) => void;
  canSkip: boolean;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const byDate = new Map(dates.map((d) => [d.date, d]));
  const scores = dates.map((d) => d.score);
  const lo = Math.min(...scores);
  const hi = Math.max(...scores);
  const t = (s: number) => (hi > lo ? (s - lo) / (hi - lo) : 0);
  const headcount = [...dates].sort((a, b) => a.baselineRank - b.baselineRank)[0]?.date;
  const focus = byDate.get(hover ?? selected ?? "") ?? null;
  const n = dates.length;

  return (
    <div className="nights">
      <div className="nights-months">
        {monthsBetween(from, to).map(({ y, m }) => {
          const first = new Date(Date.UTC(y, m, 1)).getUTCDay();
          const days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
          return (
            <div className="month" key={`${y}-${m}`}>
              <h3>
                {MONTHS[m]} <span>{y}</span>
              </h3>
              <div className="month-grid" role="grid" aria-label={`${MONTHS[m]} ${y}`}>
                {DOW.map((d, i) => (
                  <span key={`h${i}`} className="dow" aria-hidden>
                    {d}
                  </span>
                ))}
                {Array.from({ length: first }, (_, i) => (
                  <span key={`b${i}`} />
                ))}
                {Array.from({ length: days }, (_, i) => {
                  const day = i + 1;
                  const key = iso(y, m, day);
                  const d = byDate.get(key);
                  if (skipped.has(key)) {
                    return (
                      <button key={key} type="button" className="day skipped" aria-label={`${fmtDay(key)}, skipped. Bring it back`} title="Skipped. Click to bring it back" onClick={() => onToggleSkip(key)}>
                        {day}
                      </button>
                    );
                  }
                  if (!d) {
                    return (
                      <span key={key} className={`day off${key < from || key > to ? " out" : ""}`} aria-hidden>
                        {day}
                      </span>
                    );
                  }
                  const heat = t(d.score);
                  return (
                    <button
                      key={key}
                      type="button"
                      className={`day night${heat > 0.55 ? " deep" : ""}${d.rank <= 3 ? " top" : ""}${key === headcount ? " headcount" : ""}`}
                      style={{ ["--t" as string]: heat.toFixed(3), ["--i" as string]: i }}
                      aria-pressed={selected === key}
                      aria-label={`${fmtDay(key)}: clash score ${fmt2(d.score)}, ranked ${d.rank} of ${n}${key === headcount ? ", the headcount's pick" : ""}`}
                      onClick={() => onSelect(key)}
                      onMouseEnter={() => setHover(key)}
                      onMouseLeave={() => setHover(null)}
                      onFocus={() => setHover(key)}
                      onBlur={() => setHover(null)}
                    >
                      {day}
                      {d.rank <= 3 && <i className="rank">{d.rank}</i>}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="nights-foot">
        <p className="nights-focus" aria-live="polite">
          {focus ? (
            <>
              <strong>{fmtDay(focus.date)}</strong> ranked {focus.rank} of {n}, clash score {fmt2(focus.score)}, {focus.inWindowEvents} shows nearby
              {focus.date === headcount ? ". The headcount's pick." : "."}{" "}
              {canSkip && (
                <button type="button" className="btn-plain skip" onClick={() => onToggleSkip(focus.date)}>
                  Skip this night
                </button>
              )}
            </>
          ) : (
            " "
          )}
        </p>
        <div className="nights-legend" aria-hidden>
          <span className="ramp">
            <span>Less pull</span>
            <i />
            <span>More</span>
          </span>
          <span className="key-top">
            <i className="rank">1</i> Best three
          </span>
          <span className="key-head">
            <i /> Headcount&apos;s pick
          </span>
        </div>
      </div>
    </div>
  );
}
