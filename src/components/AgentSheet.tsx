"use client";

import { useEffect, useRef, useState } from "react";
import { compactResult } from "@/lib/pipeline";
import type { AnalysisResult } from "@/lib/types";
import Link from "next/link";
import { ArrowUp, Close } from "./icons";
import { saveLocalWatch } from "./watchlist";

interface Msg {
  role: "user" | "assistant" | "error";
  content: string;
  tools?: string[];
  watchId?: string;
}

const TOOL_LABEL: Record<string, string> = {
  list_markets: "Cities",
  find_artist: "Artist lookup",
  analyze_candidate_dates: "Date analysis",
  find_best_nights: "Night search",
  explain_date: "Breakdown",
  compare_dates: "Comparison",
  what_if_exclude: "What-if",
  watch_latest: "Watch",
};

export function AgentSheet({
  open,
  onClose,
  mode,
  available,
  current,
  onAnalysis,
}: {
  open: boolean;
  onClose: () => void;
  mode: "live" | "demo";
  available: boolean;
  current: AnalysisResult | null;
  onAnalysis: (r: AnalysisResult) => void;
}) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs, busy]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const suggestions =
    mode === "demo"
      ? ["Which of May 8, 15 or 22, 2027 is best for Juniper Static in Chicago?", "What changes if Paper Lanterns moves?"]
      : ["I can hold three Saturdays in May for Clairo in Chicago. Which is least crowded for her fans?", "Compare my two best dates."];

  async function send(text: string) {
    const next: Msg[] = [...msgs, { role: "user", content: text }];
    setMsgs(next);
    setDraft("");
    setBusy(true);
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode,
          messages: next.filter((m) => m.role !== "error").map(({ role, content }) => ({ role, content })),
          previous: current?.discover ? compactResult(current) : current,
          today: new Date().toISOString().slice(0, 10),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setMsgs([...next, { role: "error", content: json.error ?? "The agent couldn't answer." }]);
        return;
      }
      const tools = [...new Set<string>((json.trace ?? []).map((t: { tool: string }) => TOOL_LABEL[t.tool] ?? t.tool))];
      setMsgs([...next, { role: "assistant", content: json.text, tools, watchId: json.watchId ?? undefined }]);
      if (json.watchId) saveLocalWatch({ id: json.watchId, artist: json.analysis?.target?.entity?.name ?? "Watch", market: json.analysis?.market?.label ?? "", createdAt: new Date().toISOString() });
      if (json.analysis) onAnalysis(json.analysis);
    } catch {
      setMsgs([...next, { role: "error", content: "Couldn't reach the agent. Check your connection." }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="sheet" role="dialog" aria-modal="true" aria-label="Ask Tidate">
        <div className="sheet-head">
          <div>
            <h2>Ask Tidate</h2>
            <p>Answers come from the same scoring tools as the page.</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <Close size={12} />
          </button>
        </div>

        <div className="sheet-body" ref={bodyRef} aria-live="polite">
          {!available ? (
            <div className="sheet-empty">
              The assistant needs a language model key on the server. Everything else on the page works without it.
            </div>
          ) : msgs.length === 0 ? (
            <div className="sheet-empty">
              Describe the show and the dates you can hold.
              {suggestions.map((s) => (
                <button key={s} type="button" className="suggestion" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          ) : (
            msgs.map((m, i) => (
              <div key={i} style={{ display: "contents" }}>
                <div className={`bubble ${m.role}`}>{m.content}</div>
                {m.watchId && (
                  <Link className="bubble-link" href={`/watch/${m.watchId}`}>
                    Open the watch
                  </Link>
                )}
                {m.tools && m.tools.length > 0 && <div className="tools">Used {m.tools.join(", ")}</div>}
              </div>
            ))
          )}
          {busy && (
            <div className="typing" aria-label="Working">
              <i />
              <i />
              <i />
            </div>
          )}
        </div>

        {available && (
          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault();
              if (draft.trim() && !busy) send(draft.trim());
            }}
          >
            <label htmlFor="ask" className="sr-only">
              Message
            </label>
            <textarea
              id="ask"
              ref={inputRef}
              rows={1}
              value={draft}
              placeholder="Message"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (draft.trim() && !busy) send(draft.trim());
                }
              }}
            />
            <button type="submit" className="send" disabled={!draft.trim() || busy} aria-label="Send">
              <ArrowUp size={16} />
            </button>
          </form>
        )}
      </aside>
    </>
  );
}
