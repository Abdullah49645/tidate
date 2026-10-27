"use client";

import { useState } from "react";
import type { AnalysisResult } from "@/lib/types";

/** A link that reopens this analysis. It re-runs with current data rather than freezing old numbers. */
export function analysisLink(r: AnalysisResult, origin: string) {
  const q = new URLSearchParams({ mode: r.mode, artist: r.target.entity?.name ?? r.request.artist, market: r.market.id, radius: String(r.request.radiusMiles) });
  if (r.target.entity) q.set("entity", r.target.entity.entityId);
  if (r.discover) {
    q.set("from", r.discover.from);
    q.set("to", r.discover.to);
    q.set("nights", r.discover.nights);
  } else q.set("dates", r.request.candidateDates.join(","));
  return `${origin}/?${q}`;
}

export function ShareLink({ result }: { result: AnalysisResult }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  async function copy() {
    const url = analysisLink(result, window.location.origin);
    try {
      await navigator.clipboard.writeText(url);
      setState("copied");
    } catch {
      window.prompt("Copy this link", url);
      setState("idle");
    }
  }
  return (
    <p className="watch-cta share">
      <button type="button" className="btn-plain" onClick={copy}>
        {state === "copied" ? "Link copied" : "Copy a link to this analysis"}
      </button>
      <span>{state === "copied" ? "It reopens and re-runs with that day's listings." : "Send it to the artist's agent or your team."}</span>
    </p>
  );
}
