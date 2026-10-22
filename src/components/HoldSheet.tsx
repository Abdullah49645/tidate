"use client";

import { useEffect, useRef, useState } from "react";
import { MARKETS } from "@/lib/markets";
import type { ArtistCandidate, MatchStatus } from "@/lib/types";
import { fmt2 } from "./format";

export interface SheetValue {
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

export function HoldSheet({
  mode,
  value,
  onChange,
  onRun,
  running,
  clarify,
}: {
  mode: "live" | "demo";
  value: SheetValue;
  onChange: (v: SheetValue) => void;
  onRun: () => void;
  running: boolean;
  clarify: ArtistCandidate[] | null;
}) {
  const [result, setResult] = useState<Lookup>({ query: "", status: "idle", candidates: [], entityId: null });
  const seq = useRef(0);

  // Real lookup against /api/artists (Qloo search, or the fictional demo catalogue).
  const q = value.artist.trim();
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
        if (id === seq.current) setResult({ query: q, status: "error", candidates: [], entityId: null, message: "Lookup failed. Check your connection." });
      }
    }, 450);
    return () => clearTimeout(t);
  }, [q, mode]);
  const lookup: Lookup = q.length < 2 ? { query: q, status: "idle", candidates: [], entityId: null } : result.query === q ? result : { ...result, status: "loading" };

  const set = (patch: Partial<SheetValue>) => onChange({ ...value, ...patch });
  const choices = clarify ?? (lookup.status === "ambiguous" || lookup.status === "weak" ? lookup.candidates : null);
  const dateIssues = value.dates.map((d, i) => (d && value.dates.indexOf(d) !== i ? "Duplicate date" : null));
  const filled = value.dates.filter(Boolean);
  const canRun = value.artist.trim().length > 0 && filled.length > 0 && !dateIssues.some(Boolean) && !running;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canRun) onRun();
      }}
    >
      <div className="field">
        <label htmlFor="artist">Artist</label>
        <input
          id="artist"
          className="input"
          value={value.artist}
          autoComplete="off"
          onChange={(e) => set({ artist: e.target.value, artistEntityId: undefined })}
          placeholder={mode === "demo" ? "Juniper Static" : "e.g. Clairo"}
          aria-describedby="artist-match"
        />
        <div id="artist-match" className={`match ${lookup.status === "exact" || value.artistEntityId ? "ok" : lookup.status === "error" || lookup.status === "not-found" ? "warn" : ""}`} aria-live="polite">
          {value.artistEntityId
            ? `Using the artist you picked (${value.artistEntityId}).`
            : lookup.status === "loading"
              ? "Looking up in Qloo…"
              : lookup.status === "exact"
                ? `Matched in Qloo: ${lookup.candidates.find((c) => c.entityId === lookup.entityId)?.name ?? value.artist}`
                : lookup.status === "ambiguous"
                  ? "Several Qloo artists share this name. Pick one below."
                  : lookup.status === "weak"
                    ? "No exact name match in Qloo. Pick one below or check the spelling."
                    : lookup.status === "not-found"
                      ? "No Qloo artist found with this name."
                      : lookup.status === "error"
                        ? lookup.message
                        : mode === "demo"
                          ? "Demo catalogue: Juniper Static (or try Echo to see ambiguity)."
                          : ""}
        </div>
        {choices && choices.length > 0 && (
          <ul className="candidates" aria-label="Qloo artist candidates">
            {choices.map((c) => (
              <li key={c.entityId}>
                <button type="button" aria-pressed={value.artistEntityId === c.entityId} onClick={() => set({ artist: c.name, artistEntityId: c.entityId })}>
                  {c.name} <small>{[c.disambiguation, c.popularity !== null ? `popularity ${fmt2(c.popularity)}` : null].filter(Boolean).join(", ")}</small>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="field">
        <label htmlFor="market">Market</label>
        <select id="market" className="select" value={value.marketId} onChange={(e) => set({ marketId: e.target.value })}>
          {MARKETS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      <fieldset className="field" style={{ border: 0, padding: 0, margin: "0 0 16px" }}>
        <legend className="label" style={{ fontWeight: 600, marginBottom: 6, padding: 0 }}>
          Dates you can hold
        </legend>
        {value.dates.map((d, i) => (
          <div className="date-row" key={i}>
            <input
              type="date"
              className="input"
              value={d}
              aria-label={`Candidate date ${i + 1}`}
              aria-invalid={dateIssues[i] ? true : undefined}
              onChange={(e) => set({ dates: value.dates.map((x, j) => (j === i ? e.target.value : x)) })}
            />
            {value.dates.length > 1 && (
              <button type="button" className="icon-btn" aria-label={`Remove date ${i + 1}`} onClick={() => set({ dates: value.dates.filter((_, j) => j !== i) })}>
                ×
              </button>
            )}
          </div>
        ))}
        {dateIssues.some(Boolean) && <p className="match warn">Each date can only be listed once.</p>}
        {value.dates.length < 4 && (
          <button type="button" className="link-btn" onClick={() => set({ dates: [...value.dates, ""] })}>
            Add a date
          </button>
        )}
        <p className="hint">Up to four. Undertow ranks the dates you can actually hold; it does not check venue availability.</p>
      </fieldset>

      <div className="field">
        <label htmlFor="radius">Search radius</label>
        <select id="radius" className="select" value={value.radiusMiles} onChange={(e) => set({ radiusMiles: Number(e.target.value) })}>
          {[15, 30, 50].map((r) => (
            <option key={r} value={r}>
              {r} miles
            </option>
          ))}
        </select>
      </div>

      <button type="submit" className="primary" disabled={!canRun}>
        {running ? "Analysing…" : "Rank these dates"}
      </button>
    </form>
  );
}
