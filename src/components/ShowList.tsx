"use client";

import { useMemo, useState } from "react";
import { dayDiff, diffDates, normaliseName } from "@/lib/scoring/engine";
import type { ArtistResolution, CompetingEvent, Contribution, DateScore, MatchStatus } from "@/lib/types";
import { fmt2, fmtDay, fmtRelative, fmtShort } from "./format";
import { Chevron } from "./icons";

const MATCH_TEXT: Partial<Record<MatchStatus, string>> = {
  ambiguous: "More than one Qloo artist has this name",
  weak: "No exact match in Qloo",
  "not-found": "Not in Qloo",
  error: "Qloo lookup failed",
};

function reason(c: Contribution, e: CompetingEvent | undefined, resolutions: Record<string, ArtistResolution>): string | null {
  if (c.scored) {
    const notes: string[] = [];
    if (c.flags.includes("popularity-imputed")) notes.push("Popularity unavailable, neutral 0.50 used");
    if (c.flags.includes("rescheduled")) notes.push("Rescheduled");
    return notes.length ? notes.join(" · ") : null;
  }
  if (c.flags.includes("affinity-missing")) return "Qloo returned no affinity";
  const statuses = (e?.performers ?? []).map((p) => resolutions[normaliseName(p.name)]?.status).filter(Boolean) as MatchStatus[];
  const s = statuses.find((x) => MATCH_TEXT[x]);
  return (s && MATCH_TEXT[s]) ?? "Not matched in Qloo";
}

export function ShowList({
  date,
  dates,
  events,
  resolutions,
  ignored,
  onToggle,
}: {
  date: DateScore;
  dates: DateScore[];
  events: CompetingEvent[];
  resolutions: Record<string, ArtistResolution>;
  ignored: Set<string>;
  onToggle: (eventId: string) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [compareTo, setCompareTo] = useState("");
  const eventById = useMemo(() => new Map(events.map((e) => [e.eventId, e])), [events]);
  const others = dates.filter((d) => d.date !== date.date).sort((a, b) => a.date.localeCompare(b.date));
  const comparison = others.find((d) => d.date === compareTo);
  const diff = comparison ? diffDates(date, comparison).filter((r) => Math.abs(r.delta) > 1e-9).slice(0, 5) : [];

  const hidden = [...ignored]
    .map((id) => eventById.get(id))
    .filter((e): e is CompetingEvent => !!e && !!e.localDate && Math.abs(dayDiff(date.date, e.localDate)) <= 14);

  return (
    <>
      <div className="list-head">
        <p>
          {date.scoredEvents} of {date.inWindowEvents} shows scored. Switch one off to see the ranking without it.
        </p>
        {others.length > 0 && (
          <select className="select-pill" value={compareTo} onChange={(e) => setCompareTo(e.target.value)} aria-label="Compare with another date">
            <option value="">Compare with…</option>
            {others.map((o) => (
              <option key={o.date} value={o.date}>
                {fmtDay(o.date)}
              </option>
            ))}
          </select>
        )}
      </div>

      {comparison && (
        <div className="compare-box">
          <h4>
            {fmtShort(date.date)} {date.score >= comparison.score ? "carries" : "is spared"} {fmt2(Math.abs(date.score - comparison.score))}{" "}
            {date.score >= comparison.score ? "more" : "less"} pull than {fmtShort(comparison.date)}
          </h4>
          {diff.length === 0 ? (
            <p style={{ margin: 0, color: "var(--text-2)" }}>Both dates draw on the same shows equally.</p>
          ) : (
            <ul>
              {diff.map((r) => (
                <li key={r.eventId}>
                  <span>
                    {r.performer ?? r.eventName} <span style={{ color: "var(--text-2)" }}>· {fmtShort(r.eventDate)}</span>
                  </span>
                  <span className="delta">
                    {fmt2(r.a ?? 0)} vs {fmt2(r.b ?? 0)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {date.contributions.length === 0 && hidden.length === 0 ? (
        <div className="list">
          <div className="row">
            <div className="row-main">
              <div className="row-sub">No music events on Ticketmaster within two weeks of this date.</div>
            </div>
          </div>
        </div>
      ) : (
        <div className="list" role="list">
          {date.contributions.map((c) => {
            const e = eventById.get(c.eventId);
            const note = reason(c, e, resolutions);
            const share = c.scored && date.score > 0 ? (c.contribution ?? 0) / date.score : 0;
            const isOpen = open === c.eventId;
            return (
              <div key={c.eventId} className="row" role="listitem" data-open={isOpen}>
                <div className="row-main">
                  <button type="button" className="row-btn" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : c.eventId)}>
                    <div className="row-title">
                      <span>{c.performer ?? c.eventName}</span>
                      <Chevron size={12} />
                    </div>
                    <div className="row-sub">
                      {c.venueName} · {fmtShort(c.eventDate)} · {fmtRelative(c.daysApart).toLowerCase()}
                    </div>
                    {note && <div className="row-note">{note}</div>}
                  </button>
                  <div className="row-value">
                    {c.scored ? (
                      <>
                        <b>{fmt2(c.contribution)}</b>
                        <span className="bar" aria-hidden>
                          <i style={{ width: `${Math.round(share * 100)}%` }} />
                        </span>
                        <small>{Math.round(share * 100)}% of score</small>
                      </>
                    ) : (
                      <span className="muted">Not scored</span>
                    )}
                  </div>
                  <label className="switch">
                    <input type="checkbox" checked onChange={() => onToggle(c.eventId)} aria-label={`Include ${c.performer ?? c.eventName}`} />
                    <span />
                  </label>
                </div>
                {isOpen && (
                  <div className="row-detail">
                    <div className="stat">
                      <span>Qloo affinity</span>
                      <b>{c.scored ? fmt2(c.affinity) : "–"}</b>
                    </div>
                    <div className="stat">
                      <span>Popularity</span>
                      <b>{c.scored ? (c.popularity === null ? "0.50*" : fmt2(c.popularity)) : "–"}</b>
                    </div>
                    <div className="stat">
                      <span>Timing</span>
                      <b>× {c.temporalWeight.toFixed(2)}</b>
                    </div>
                    <div className="stat">
                      <span>{c.scored ? "Contribution" : "Worst case"}</span>
                      <b>{fmt2(c.scored ? c.contribution : c.upperBound)}</b>
                    </div>
                    <div className="foot">
                      {e && e.name !== c.performer ? `Listed as “${e.name}”. ` : ""}
                      {c.scored
                        ? `${fmt2(c.affinity)} × ${c.popularity === null ? "0.50" : fmt2(c.popularity)} × ${c.temporalWeight.toFixed(2)} = ${fmt2(c.contribution)}. `
                        : "Not included in the score; counted at its worst case when checking whether the ranking could flip. "}
                      {e?.url ? (
                        <a href={e.url} target="_blank" rel="noreferrer">
                          View on Ticketmaster
                        </a>
                      ) : null}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {hidden.map((e) => (
            <div key={e.eventId} className="row off" role="listitem">
              <div className="row-main">
                <div className="row-btn">
                  <div className="row-title">
                    <span>{e.performers[0]?.name ?? e.name}</span>
                  </div>
                  <div className="row-sub">
                    {e.venue.name} · {e.localDate ? fmtShort(e.localDate) : "TBA"} · switched off
                  </div>
                </div>
                <div className="row-value">
                  <span className="muted">Excluded</span>
                </div>
                <label className="switch">
                  <input type="checkbox" checked={false} onChange={() => onToggle(e.eventId)} aria-label={`Include ${e.performers[0]?.name ?? e.name} again`} />
                  <span />
                </label>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
