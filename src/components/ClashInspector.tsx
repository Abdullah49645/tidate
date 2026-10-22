"use client";

import { useMemo, useState } from "react";
import { diffDates, normaliseName } from "@/lib/scoring/engine";
import type { ArtistResolution, CompetingEvent, Contribution, DateScore, MatchStatus, UncertaintyFlag } from "@/lib/types";
import { fmt2, fmtDay, fmtRelative, fmtShort, humanizeDates } from "./format";

const FLAG_TEXT: Record<UncertaintyFlag, string> = {
  "unresolved-performer": "Performer not matched in Qloo",
  "affinity-missing": "Qloo returned no affinity",
  "popularity-imputed": "Popularity missing, 0.50 used",
  rescheduled: "Rescheduled",
};

const MATCH_TEXT: Partial<Record<MatchStatus, string>> = {
  ambiguous: "Several Qloo artists share this name",
  weak: "No exact name match in Qloo",
  "not-found": "Not found in Qloo",
  error: "Qloo lookup failed",
};

export function ClashInspector({
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
  const others = dates.filter((d) => d.date !== date.date);
  const [compareTo, setCompareTo] = useState<string>("");
  const eventById = useMemo(() => new Map(events.map((e) => [e.eventId, e])), [events]);

  // Rows: current contributions plus any ignored events that would fall in this window.
  const ignoredRows = [...ignored]
    .map((id) => eventById.get(id))
    .filter((e): e is CompetingEvent => !!e && !date.contributions.some((c) => c.eventId === e.eventId))
    .filter((e) => e.localDate && Math.abs(Date.parse(e.localDate) - Date.parse(date.date)) <= 14 * 86_400_000);

  const comparison = compareTo ? dates.find((d) => d.date === compareTo) : undefined;
  const diff = comparison ? diffDates(date, comparison).filter((r) => Math.abs(r.delta) > 1e-9).slice(0, 6) : [];

  return (
    <div className="panel">
      <div className="toolbar">
        <strong>{fmtDay(date.date)}</strong>
        <span>
          {date.scoredEvents} of {date.inWindowEvents} shows scored, evidence {evidenceWord(date.evidence)}
        </span>
        <span className="spacer" />
        {others.length > 0 && (
          <label>
            Compare with{" "}
            <select className="select" value={compareTo} onChange={(e) => setCompareTo(e.target.value)}>
              <option value="">no comparison</option>
              {others.map((o) => (
                <option key={o.date} value={o.date}>
                  {fmtDay(o.date)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <p className="explain">{humanizeDates(date.explanation)}</p>

      {comparison && (
        <div className="explain">
          <strong>
            Why {fmtShort(date.date)} scores {date.score >= comparison.score ? "higher" : "lower"} than {fmtShort(comparison.date)} ({fmt2(date.score)} vs{" "}
            {fmt2(comparison.score)})
          </strong>
          {diff.length === 0 ? (
            <p style={{ margin: "6px 0 0" }}>Both dates draw on the same shows with the same weights.</p>
          ) : (
            <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              {diff.map((r) => (
                <li key={r.eventId}>
                  {r.performer ?? r.eventName} ({fmtShort(r.eventDate)}, {r.venueName}): {fmt2(r.a ?? 0)} here vs {fmt2(r.b ?? 0)} on {fmtShort(comparison.date)}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {date.contributions.length === 0 && ignoredRows.length === 0 ? (
        <p className="explain">Nothing to inspect: no music events on Ticketmaster within two weeks of this date.</p>
      ) : (
        <div className="table-wrap">
          <table className="clash">
            <caption className="sr-only">Shows contributing to the clash score for {fmtDay(date.date)}</caption>
            <thead>
              <tr>
                <th scope="col">Include</th>
                <th scope="col">Competing show</th>
                <th scope="col">When</th>
                <th scope="col" className="num">
                  Qloo affinity
                </th>
                <th scope="col" className="num">
                  Popularity
                </th>
                <th scope="col" className="num">
                  Timing weight
                </th>
                <th scope="col" className="num">
                  Contribution
                </th>
              </tr>
            </thead>
            <tbody>
              {date.contributions.map((c) => (
                <Row key={c.eventId} c={c} total={date.score} event={eventById.get(c.eventId)} resolutions={resolutions} onToggle={() => onToggle(c.eventId)} />
              ))}
              {ignoredRows.map((e) => (
                <tr key={e.eventId} className="off">
                  <td>
                    <input type="checkbox" checked={false} onChange={() => onToggle(e.eventId)} aria-label={`Include ${e.name} again`} />
                  </td>
                  <td colSpan={6}>
                    <span className="performer">{e.performers[0]?.name ?? e.name}</span>
                    <span className="sub">
                      {e.venue.name}, {e.localDate ? fmtShort(e.localDate) : "date TBA"}, left out of this what-if
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Row({
  c,
  total,
  event,
  resolutions,
  onToggle,
}: {
  c: Contribution;
  total: number;
  event?: CompetingEvent;
  resolutions: Record<string, ArtistResolution>;
  onToggle: () => void;
}) {
  const flagText = (f: UncertaintyFlag) => {
    if (f !== "unresolved-performer") return FLAG_TEXT[f];
    const statuses = (event?.performers ?? []).map((p) => resolutions[normaliseName(p.name)]?.status).filter(Boolean) as MatchStatus[];
    const s = statuses.find((x) => MATCH_TEXT[x]);
    return (s && MATCH_TEXT[s]) ?? FLAG_TEXT[f];
  };
  const share = c.scored && total > 0 ? (c.contribution ?? 0) / total : 0;
  return (
    <tr className={c.scored ? undefined : "unscored"}>
      <td>
        <input type="checkbox" checked onChange={onToggle} aria-label={`Include ${c.performer ?? c.eventName} in the score`} />
      </td>
      <td>
        <span className="performer">{c.performer ?? c.eventName}</span>
        <span className="sub">
          {c.venueName}
          {event && event.name !== c.performer ? `, “${event.name}”` : ""}
          {event?.url ? (
            <>
              {", "}
              <a href={event.url} target="_blank" rel="noreferrer">
                Ticketmaster listing
              </a>
            </>
          ) : null}
        </span>
        {c.flags.map((f) => (
          <span key={f} className={`tag${f === "unresolved-performer" || f === "affinity-missing" ? " warn" : ""}`}>
            {flagText(f)}
          </span>
        ))}
      </td>
      <td>
        {fmtShort(c.eventDate)}
        <span className="sub">{fmtRelative(c.daysApart)}</span>
      </td>
      <td className="num">{c.scored ? fmt2(c.affinity) : "–"}</td>
      <td className="num">{c.scored ? (c.popularity === null ? "0.50*" : fmt2(c.popularity)) : "–"}</td>
      <td className="num">× {c.temporalWeight.toFixed(2)}</td>
      <td className="num">
        {c.scored ? (
          <>
            {fmt2(c.contribution)}
            <span className="share" style={{ width: `${Math.round(share * 48)}px` }} aria-hidden="true" />
            <span className="sub">{Math.round(share * 100)}% of total</span>
          </>
        ) : (
          <span className="sub">up to {fmt2(c.upperBound)}</span>
        )}
      </td>
    </tr>
  );
}

export function evidenceWord(e: DateScore["evidence"]) {
  return { strong: "strong", partial: "partial", weak: "weak", "no-competition-found": "n/a (no shows found)" }[e];
}
