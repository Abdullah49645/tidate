"use client";

import { useEffect, useRef, useState } from "react";
import { MARKETS } from "@/lib/markets";
import type { ArtistCandidate, MatchStatus } from "@/lib/types";
import { fmt2, fmtDay } from "./format";
import { Check, Close } from "./icons";

export interface RequestValue {
  artist: string;
  artistEntityId?: string;
  marketId: string;
  dates: string[];
  radiusMiles: number;
}

interface Lookup {
  query: string;
  status: MatchStatus | "idle" | "loading" | "error";
  candidates: ArtistCandidate[];
  entityId: string | null;
  message?: string;
}

function openPicker(e: React.MouseEvent<HTMLInputElement>) {
  try {
    e.currentTarget.showPicker?.();
  } catch {
    /* some browsers only allow showPicker on user gesture targets; the native input still works */
  }
}

export function CommandBar({
  mode,
  value,
  onChange,
  onRun,
  running,
  clarify,
  onAsk,
}: {
  mode: "live" | "demo";
  value: RequestValue;
  onChange: (v: RequestValue) => void;
  onRun: () => void;
  running: boolean;
  clarify: ArtistCandidate[] | null;
  onAsk: () => void;
}) {
  const [result, setResult] = useState<Lookup>({ query: "", status: "idle", candidates: [], entityId: null });
  const [dismissed, setDismissed] = useState<string | null>(null);
  const seq = useRef(0);
  const q = value.artist.trim();

  // Real lookup against /api/artists (Qloo search, or the fictional demo catalogue).
  useEffect(() => {
    if (q.length < 2) return;
    const id = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/artists?mode=${mode}&q=${encodeURIComponent(q)}`);
        const json = await res.json();
        if (id !== seq.current) return;
        if (!res.ok) setResult({ query: q, status: "error", candidates: [], entityId: null, message: json.error });
        else setResult({ query: q, status: json.status, candidates: json.candidates, entityId: json.entityId, message: json.note ?? undefined });
      } catch {
        if (id === seq.current) setResult({ query: q, status: "error", candidates: [], entityId: null, message: "Couldn't reach Qloo." });
      }
    }, 400);
    return () => clearTimeout(t);
  }, [q, mode]);

  const lookup: Lookup = q.length < 2 ? { query: q, status: "idle", candidates: [], entityId: null } : result.query === q ? result : { ...result, status: "loading" };
  const set = (patch: Partial<RequestValue>) => onChange({ ...value, ...patch });

  const matched = !!value.artistEntityId || lookup.status === "exact";
  const matchedName = value.artistEntityId ? value.artist : lookup.candidates.find((c) => c.entityId === lookup.entityId)?.name;
  const needsPick = !value.artistEntityId && (lookup.status === "ambiguous" || lookup.status === "weak");
  const choices = clarify && !value.artistEntityId ? clarify : needsPick ? lookup.candidates : null;
  const showPopover = !!choices?.length && dismissed !== q;

  const note = value.artistEntityId
    ? { cls: "ok", text: "Selected in Qloo" }
    : lookup.status === "loading"
      ? { cls: "", text: "Searching Qloo…" }
      : lookup.status === "exact"
        ? { cls: "ok", text: matchedName && matchedName !== value.artist ? `Matched: ${matchedName}` : "Found in Qloo" }
        : lookup.status === "ambiguous"
          ? { cls: "warn", text: "More than one artist has this name" }
          : lookup.status === "weak"
            ? { cls: "warn", text: "No exact match. Choose one." }
            : lookup.status === "not-found"
              ? { cls: "err", text: "Not found in Qloo" }
              : lookup.status === "error"
                ? { cls: "err", text: lookup.message ?? "Lookup failed" }
                : { cls: "", text: mode === "demo" ? "Try Juniper Static" : "Any artist Qloo knows" };

  const dates = value.dates;
  const duplicate = dates.some((d, i) => dates.indexOf(d) !== i);
  const canRun = q.length > 0 && dates.length > 0 && !duplicate && !running;

  return (
    <>
      <form
        className="command"
        onSubmit={(e) => {
          e.preventDefault();
          if (canRun) onRun();
        }}
        aria-label="Analyze candidate dates"
      >
        <div className="cmd-field" onKeyDown={(e) => e.key === "Escape" && setDismissed(q)}>
          <label className="cmd-label" htmlFor="artist">
            Artist
          </label>
          <input
            id="artist"
            className="cmd-input"
            value={value.artist}
            autoComplete="off"
            spellCheck={false}
            placeholder={mode === "demo" ? "Juniper Static" : "Clairo"}
            onChange={(e) => {
              set({ artist: e.target.value, artistEntityId: undefined });
              setDismissed(null);
            }}
            aria-describedby="artist-note"
          />
          <div id="artist-note" className={`field-note ${note.cls}`} aria-live="polite">
            {note.text}
          </div>
          <span className="cmd-status" aria-hidden>
            {lookup.status === "loading" ? <span className="spinner" /> : matched ? <Check size={14} /> : null}
          </span>
          {showPopover && (
            <div className="popover" role="listbox" aria-label="Choose the artist">
              <div className="popover-title">Which one do you mean?</div>
              {choices!.map((c) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={value.artistEntityId === c.entityId}
                  key={c.entityId}
                  onClick={() => set({ artist: c.name, artistEntityId: c.entityId })}
                >
                  <span>{c.name}</span>
                  <small>{[c.disambiguation, c.popularity !== null ? `popularity ${fmt2(c.popularity)}` : null].filter(Boolean).join(" · ")}</small>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="cmd-field">
          <label className="cmd-label" htmlFor="market">
            City
          </label>
          <select id="market" className="cmd-select" value={value.marketId} onChange={(e) => set({ marketId: e.target.value })}>
            {MARKETS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          <div className="field-note">
            Within{" "}
            <select className="inline-select" value={value.radiusMiles} onChange={(e) => set({ radiusMiles: Number(e.target.value) })} aria-label="Search radius">
              {[15, 30, 50].map((r) => (
                <option key={r} value={r}>
                  {r} miles
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="cmd-field">
          <span className="cmd-label" id="dates-label">
            Dates you can hold
          </span>
          <div className="chips" role="group" aria-labelledby="dates-label">
            {dates.map((d, i) => (
              <span key={`${d}-${i}`} className={`chip${dates.indexOf(d) !== i ? " invalid" : ""}`}>
                {fmtDay(d)}
                <input
                  type="date"
                  value={d}
                  aria-label={`Change ${fmtDay(d)}`}
                  onClick={openPicker}
                  onChange={(e) => e.target.value && set({ dates: dates.map((x, j) => (j === i ? e.target.value : x)) })}
                />
                <button type="button" className="x" aria-label={`Remove ${fmtDay(d)}`} onClick={() => set({ dates: dates.filter((_, j) => j !== i) })}>
                  <Close size={10} />
                </button>
              </span>
            ))}
            {dates.length < 4 && (
              <span className={`chip add${dates.length ? " round" : ""}`} title="Add a date">
                {dates.length ? "+" : "Add a date"}
                <input type="date" value="" aria-label="Add a date" onClick={openPicker} onChange={(e) => e.target.value && set({ dates: [...dates, e.target.value].sort() })} />
              </span>
            )}
          </div>
          <div className={`field-note${duplicate ? " err" : ""}`}>{duplicate ? "Each date only once" : dates.length === 4 ? "Up to four dates" : "\u00a0"}</div>
        </div>

        <div className="cmd-action">
          <button type="submit" className="btn-primary" disabled={!canRun}>
            {running ? "Analyzing…" : "Analyze"}
          </button>
        </div>
      </form>

      <div className="cmd-meta">
        <button type="button" className="btn-plain" onClick={onAsk}>
          Ask in plain language
        </button>
      </div>
    </>
  );
}
