"use client";

import { useMemo, useState } from "react";
import { dayDiff, diffDates, normaliseName } from "@/lib/scoring/engine";
import type { ArtistResolution, CompetingEvent, Contribution, DateScore, MatchStatus } from "@/lib/types";
import { fmt2, fmtDay, fmtRelative, fmtShort } from "./format";
import { Check, Chevron } from "./icons";

const MATCH_TEXT: Partial<Record<MatchStatus, string>> = {
  ambiguous: "More than one Qloo artist has this name",
  weak: "No exact match in Qloo",
  "not-found": "Not in Qloo",
  error: "Qloo lookup failed",
  "not-checked": "Not looked up in time; run again to check",
};

/** "Closer than 92% of acts nearby" from the relative affinity percentile. */
export function closeness(rel: number | null): string | null {
  if (rel === null) return null;
  const pct = Math.round(rel * 100);
  if (pct >= 50) return `Closer than ${pct}% of acts nearby`;
  return `Further than ${100 - pct}% of acts nearby`;
}

function reason(c: Contribution, e: CompetingEvent | undefined, resolutions: Record<string, ArtistResolution>): string | null {
  if (c.scored) {
    const notes: string[] = [];
    const perf = e?.performers.find((p) => p.name === c.performer);
    if (perf?.fromSplit) notes.push("Matched from a multi-act listing");
    if (perf?.fromTitle) notes.push("Name taken from the event title");
    if (c.flags.includes("popularity-imputed")) notes.push("Popularity unavailable, neutral 0.50 used");
    if (c.flags.includes("rescheduled")) notes.push("Rescheduled");
    return notes.length ? notes.join(". ") : null;
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
  const [showAll, setShowAll] = useState(false);
  const LIMIT = 8;
  const visible = showAll ? date.contributions : date.contributions.slice(0, LIMIT);
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
          {date.scoredEvents} of {date.inWindowEvents} shows scored. Untick one you expect to move and the ranking updates.
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
                    {r.performer ?? r.eventName} <span style={{ color: "var(--text-2)" }}>{fmtShort(r.eventDate)}</span>
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
          {visible.map((c) => {
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
                      {c.venueName}, {fmtShort(c.eventDate)}, {fmtRelative(c.daysApart).toLowerCase()}
                    </div>
                    {note && <div className="row-note">{note}</div>}
                  </button>
                  <div className="row-value">
                    {c.scored ? (
                      <>
                        <b>{fmt2(c.contribution)}</b>
                        <small>{Math.round(share * 100)}% of score</small>
                      </>
                    ) : (
                      <span className="muted">Not scored</span>
                    )}
                  </div>
                  <label className="incl" title="Included. Untick to leave this show out.">
                    <input type="checkbox" checked onChange={() => onToggle(c.eventId)} aria-label={`Include ${c.performer ?? c.eventName}`} />
                    <span>
                      <Check size={11} />
                    </span>
                  </label>
                </div>
                {isOpen && (
                  <div className="row-detail">
                    <dl className="figures">
                      <div>
                        <dt>Qloo affinity</dt>
                        <dd>{c.scored ? fmt2(c.affinity) : "–"}</dd>
                        {c.scored && closeness(c.relativeAffinity) && <small>{closeness(c.relativeAffinity)}</small>}
                      </div>
                      <div>
                        <dt>Popularity</dt>
                        <dd>{c.scored ? (c.popularity === null ? "0.50*" : fmt2(c.popularity)) : "–"}</dd>
                        <small>Global, from Qloo</small>
                      </div>
                      <div>
                        <dt>Timing</dt>
                        <dd>× {c.temporalWeight.toFixed(2)}</dd>
                        <small>{fmtRelative(c.daysApart)}</small>
                      </div>
                      <div>
                        <dt>{c.scored ? "Contribution" : "Worst case"}</dt>
                        <dd className="strong">{fmt2(c.scored ? c.contribution : c.upperBound)}</dd>
                        <small>{c.scored ? "Added to this date" : "Not in the score"}</small>
                      </div>
                    </dl>
                    <div className="foot">
                      {e && e.name !== c.performer ? `Listed as “${e.name}”. ` : ""}
                      {c.scored
                        ? `Closeness weight ${fmt2(c.affinityWeight)} × popularity ${c.popularity === null ? "0.50" : fmt2(c.popularity)} × timing ${c.temporalWeight.toFixed(2)} = ${fmt2(c.contribution)}. `
                        : "Not in the score. It's counted as a worst case, and as a typical act, when checking whether the ranking could flip. "}
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
                    {e.venue.name}, {e.localDate ? fmtShort(e.localDate) : "TBA"}. Switched off.
                  </div>
                </div>
                <div className="row-value">
                  <span className="muted">Excluded</span>
                </div>
                <label className="incl" title="Left out. Tick to include this show again.">
                  <input type="checkbox" checked={false} onChange={() => onToggle(e.eventId)} aria-label={`Include ${e.performers[0]?.name ?? e.name} again`} />
                  <span>
                    <Check size={11} />
                  </span>
                </label>
              </div>
            </div>
          ))}
          {date.contributions.length > LIMIT && (
            <div className="row more">
              <button type="button" className="btn-plain" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}>
                {showAll ? "Show the strongest 8" : `Show all ${date.contributions.length} shows`}
              </button>
              <span>{showAll ? "" : `${date.contributions.length - LIMIT} more, smaller or unmatched`}</span>
            </div>
          )}
        </div>
      )}
    </>
  );
}
