"use client";

import { TEMPORAL_BANDS, WINDOW_DAYS } from "@/lib/scoring/engine";
import type { DateScore } from "@/lib/types";
import { fmt2, fmtDay } from "./format";

/**
 * One candidate date drawn as a waterline spanning ±14 days.
 * Above the line: a thin tick for every nearby show (what a plain count sees).
 * Below the line: each show's Qloo-weighted contribution as depth.
 * Dashed outlines are shows that could not be scored (drawn at worst case).
 */
const W = 600;
const LINE_Y = 30;
const MAX_DEPTH = 56;

export function UndertowStrip({
  d,
  scale,
  best,
  selected,
  onSelect,
}: {
  d: DateScore;
  scale: number;
  best: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const slot = W / (WINDOW_DAYS * 2 + 1);
  const xOf = (days: number) => (days + WINDOW_DAYS) * slot;

  // Spread same-day shows across the day slot.
  const byDay = new Map<number, number>();
  const placed = d.contributions.map((c) => {
    const k = c.daysApart;
    const i = byDay.get(k) ?? 0;
    byDay.set(k, i + 1);
    return { c, i };
  });
  const perDay = (k: number) => byDay.get(k) ?? 1;

  const depth = (v: number) => Math.max(1.5, Math.min(MAX_DEPTH, (v / scale) * MAX_DEPTH));
  const label = `${fmtDay(d.date)}: ${d.inWindowEvents} nearby shows, clash score ${fmt2(d.score)}, ${d.scoredEvents} scored.`;

  return (
    <button type="button" className="strip" aria-pressed={selected} onClick={onSelect}>
      <div className={`strip-date${best ? " best" : ""}`}>
        {fmtDay(d.date)}
        <span>
          {d.inWindowEvents} nearby {d.inWindowEvents === 1 ? "show" : "shows"}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} 92`} preserveAspectRatio="none" role="img" aria-label={label}>
        {/* temporal weight bands, symmetric around the candidate date */}
        {[...TEMPORAL_BANDS].reverse().map((b) => (
          <rect
            key={b.maxDays}
            x={xOf(-b.maxDays)}
            width={slot * (b.maxDays * 2 + 1)}
            y={LINE_Y}
            height={MAX_DEPTH + 4}
            fill="var(--current-wash)"
            opacity={b.weight * 0.55}
          />
        ))}
        {/* count ticks above the line */}
        {placed.map(({ c, i }) => {
          const n = perDay(c.daysApart);
          const x = xOf(c.daysApart) + (slot * (i + 0.5)) / n;
          return <line key={`t-${c.eventId}`} x1={x} x2={x} y1={LINE_Y - 12} y2={LINE_Y - 2} stroke="var(--faint)" strokeWidth={1.5} />;
        })}
        {/* waterline */}
        <line x1={0} x2={W} y1={LINE_Y} y2={LINE_Y} stroke="var(--ink)" strokeWidth={1} />
        {/* candidate date marker */}
        <line x1={xOf(0) + slot / 2} x2={xOf(0) + slot / 2} y1={6} y2={LINE_Y + MAX_DEPTH + 4} stroke="var(--ink)" strokeWidth={1} strokeDasharray="2 3" />
        <path d={`M ${xOf(0) + slot / 2 - 5} 4 L ${xOf(0) + slot / 2 + 5} 4 L ${xOf(0) + slot / 2} 11 Z`} fill={best ? "var(--hold)" : "var(--ink)"} />
        {/* depth bars */}
        {placed.map(({ c, i }) => {
          const n = perDay(c.daysApart);
          const bw = Math.max(2, (slot / n) * 0.7);
          const x = xOf(c.daysApart) + (slot * (i + 0.5)) / n - bw / 2;
          if (c.scored) {
            return (
              <rect key={c.eventId} x={x} y={LINE_Y + 1} width={bw} height={depth(c.contribution ?? 0)} fill="var(--current)">
                <title>{`${c.performer ?? c.eventName}: ${fmt2(c.contribution)}`}</title>
              </rect>
            );
          }
          return (
            <rect
              key={c.eventId}
              x={x + 0.5}
              y={LINE_Y + 1.5}
              width={bw - 1}
              height={depth(c.upperBound)}
              fill="none"
              stroke="var(--current)"
              strokeDasharray="2 2"
              strokeWidth={1}
            >
              <title>{`${c.performer ?? c.eventName}: not scored`}</title>
            </rect>
          );
        })}
      </svg>
      <div className="strip-score">
        <b>{fmt2(d.score)}</b>
        <span>clash score</span>
      </div>
    </button>
  );
}

export function StripLegend() {
  return (
    <div className="legend" aria-hidden="true">
      <span>
        <i className="key-tick" />
        Every nearby show (what a plain count sees)
      </span>
      <span>
        <i className="key-depth" />
        Qloo-weighted pull on your audience
      </span>
      <span>
        <i className="key-unscored" />
        Not scored, drawn at worst case
      </span>
      <span>Shading deepens toward your date: same night counts fully, two weeks out barely.</span>
    </div>
  );
}
