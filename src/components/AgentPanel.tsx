"use client";

import { useState } from "react";
import type { AnalysisResult } from "@/lib/types";

interface Msg {
  role: "user" | "assistant";
  content: string;
  trace?: Array<{ tool: string; ok: boolean; summary: string }>;
  corrected?: boolean;
}

const TOOL_NAMES: Record<string, string> = {
  list_markets: "listed markets",
  find_artist: "looked up artist",
  analyze_candidate_dates: "ran the date analysis",
  explain_date: "broke down a date",
  compare_dates: "compared two dates",
  what_if_exclude: "ran a what-if",
};

export function AgentPanel({
  mode,
  agentAvailable,
  current,
  onAnalysis,
}: {
  mode: "live" | "demo";
  agentAvailable: boolean;
  current: AnalysisResult | null;
  onAnalysis: (r: AnalysisResult) => void;
}) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const example =
    mode === "demo"
      ? "Juniper Static in Chicago: which of May 8, 15 or 22 2027 is safest? Then tell me what changes if Paper Lanterns moves."
      : "I can hold May 9, 16 or 23 for Clairo in Chicago. Which night is least crowded for her fans?";

  async function send(text: string) {
    const next: Msg[] = [...msgs, { role: "user", content: text }];
    setMsgs(next);
    setDraft("");
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode,
          messages: next.map(({ role, content }) => ({ role, content })),
          previous: current,
          today: new Date().toISOString().slice(0, 10),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "The agent could not answer.");
        return;
      }
      setMsgs([...next, { role: "assistant", content: json.text, trace: json.trace, corrected: json.verification?.corrected }]);
      if (json.analysis) onAnalysis(json.analysis);
    } catch {
      setError("Could not reach the agent. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!agentAvailable) {
    return (
      <div>
        <p>The conversational agent needs an LLM key on the server, which this deployment does not have.</p>
        <p className="hint">The form runs exactly the same tools in a fixed order, so every result is still available there.</p>
      </div>
    );
  }

  return (
    <div>
      {msgs.length > 0 && (
        <div className="chat" aria-live="polite">
          {msgs.map((m, i) => (
            <div key={i} className={`msg ${m.role}`}>
              {m.content}
              {m.trace && m.trace.length > 0 && (
                <ul className="trace" aria-label="Tools the agent called">
                  {m.trace.map((t, j) => (
                    <li key={j}>
                      {t.ok ? "✓" : "×"} <code>{t.tool}</code> {TOOL_NAMES[t.tool] ?? ""}: {t.summary}
                    </li>
                  ))}
                  {m.corrected && <li>Answer checked against the engine; the engine&apos;s recommendation was added.</li>}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
      {error && (
        <p className="match warn" role="alert">
          {error}
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.trim() && !busy) send(draft.trim());
        }}
      >
        <label htmlFor="ask" className="sr-only">
          Ask Undertow
        </label>
        <textarea id="ask" className="input" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={example} rows={4} />
        <p className="hint">The agent calls the same scoring tools as the form. It never produces numbers itself.</p>
        <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
          <button type="submit" className="primary" disabled={busy || !draft.trim()}>
            {busy ? "Working…" : "Ask"}
          </button>
        </div>
        {msgs.length === 0 && (
          <button type="button" className="link-btn" style={{ marginTop: 10 }} onClick={() => setDraft(example)}>
            Use the example question
          </button>
        )}
      </form>
    </div>
  );
}
