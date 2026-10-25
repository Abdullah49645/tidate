"use client";

import Link from "next/link";
import { useState } from "react";
import type { AnalysisResult } from "@/lib/types";
import type { WatchView } from "@/lib/watch/service";
import { saveLocalWatch } from "./watchlist";

/** Turns the current result into a watch: re-checked daily, with changes recorded. */
export function WatchButton({ result }: { result: AnalysisResult }) {
  const [state, setState] = useState<{ phase: "idle" | "saving" | "done" | "error"; id?: string; message?: string }>({ phase: "idle" });

  async function start() {
    setState({ phase: "saving" });
    const r = result.request;
    const request = result.discover
      ? { artist: r.artist, artistEntityId: result.target.entity?.entityId, marketId: r.marketId, radiusMiles: r.radiusMiles, ...result.discover }
      : { artist: r.artist, artistEntityId: result.target.entity?.entityId, marketId: r.marketId, radiusMiles: r.radiusMiles, candidateDates: r.candidateDates };
    try {
      const res = await fetch("/api/watch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: result.discover ? "discover" : "compare", mode: result.mode, request }),
      });
      const j = await res.json();
      if (!res.ok) return setState({ phase: "error", message: j.error ?? "The watch couldn't be started." });
      const w = j as WatchView;
      saveLocalWatch({ id: w.id, artist: w.artist, market: w.market.label, createdAt: w.createdAt });
      setState({ phase: "done", id: w.id });
    } catch {
      setState({ phase: "error", message: "Couldn't reach the server." });
    }
  }

  if (state.phase === "done" && state.id) {
    return (
      <p className="watch-cta done" role="status">
        <span className="watch-pulse" aria-hidden />
        Watching. Tidate re-checks these dates every day and records what changes.{" "}
        <Link href={`/watch/${state.id}`}>Open the watch</Link>
      </p>
    );
  }
  return (
    <p className="watch-cta">
      <button type="button" className="btn-plain" onClick={start} disabled={state.phase === "saving"}>
        {state.phase === "saving" ? "Starting the watch…" : "Watch these dates for changes"}
      </button>
      <span>{state.phase === "error" ? state.message : "New shows, cancellations and a changing best night, checked daily."}</span>
    </p>
  );
}
