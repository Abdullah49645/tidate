"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DEMO_DATES, DEMO_MARKET, DEMO_TARGET } from "@/lib/demo/provider";
import { STEP_LABELS, rebuildScoringInputs, type PipelineOutcome, type ProgressEvent, type StepId } from "@/lib/pipeline";
import { buildVerdict, scoreDates } from "@/lib/scoring/engine";
import type { AnalysisResult, ArtistCandidate, DateScore, RankingVerdict } from "@/lib/types";
import { AgentPanel } from "./AgentPanel";
import { BaselinePanel } from "./BaselinePanel";
import { ClashInspector } from "./ClashInspector";
import { EvidencePanel } from "./EvidencePanel";
import { HoldSheet, type SheetValue } from "./HoldSheet";
import { StripLegend, UndertowStrip } from "./UndertowStrip";
import { fmt2, fmtDayYear, fmtShort, humanizeDates } from "./format";

interface Status {
  liveAvailable: boolean;
  qloo: boolean;
  ticketmaster: boolean;
  agent: boolean;
}

const STEPS = Object.keys(STEP_LABELS) as StepId[];

function upcomingSaturdays(): string[] {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 56);
  while (d.getUTCDay() !== 6) d.setUTCDate(d.getUTCDate() + 1);
  return [0, 7, 14].map((k) => {
    const x = new Date(d);
    x.setUTCDate(x.getUTCDate() + k);
    return x.toISOString().slice(0, 10);
  });
}

const demoSheet = (): SheetValue => ({ artist: DEMO_TARGET, marketId: DEMO_MARKET, dates: [...DEMO_DATES], radiusMiles: 30 });
const liveSheet = (): SheetValue => ({ artist: "", marketId: "chicago", dates: upcomingSaturdays(), radiusMiles: 30 });

export function Workstation() {
  const [status, setStatus] = useState<Status | null>(null);
  const [mode, setMode] = useState<"live" | "demo">("demo");
  const [tab, setTab] = useState<"form" | "agent">("form");
  const [sheet, setSheet] = useState<SheetValue>(demoSheet);
  const [progress, setProgress] = useState<Partial<Record<StepId, ProgressEvent>>>({});
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [problem, setProblem] = useState<{ title: string; detail: string[] } | null>(null);
  const [clarify, setClarify] = useState<ArtistCandidate[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [ignored, setIgnored] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch("/api/status")
      .then((r) => r.json())
      .then((s: Status) => {
        setStatus(s);
        if (s.liveAvailable) {
          setMode("live");
          setSheet(liveSheet());
        }
      })
      .catch(() => setStatus({ liveAvailable: false, qloo: false, ticketmaster: false, agent: false }));
  }, []);

  const switchMode = (m: "live" | "demo") => {
    if (m === mode) return;
    setMode(m);
    setSheet(m === "demo" ? demoSheet() : liveSheet());
    setResult(null);
    setProblem(null);
    setClarify(null);
    setProgress({});
    setIgnored(new Set());
  };

  const loadResult = useCallback((r: AnalysisResult) => {
    setResult(r);
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 900px)").matches) {
      requestAnimationFrame(() => document.getElementById("verdict-h")?.parentElement?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
    setSelected(r.verdict.recommendedDate ?? r.dates[0]?.date ?? null);
    setIgnored(new Set());
    setProblem(null);
    setClarify(null);
  }, []);

  async function run() {
    setRunning(true);
    setProgress({});
    setProblem(null);
    setClarify(null);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode,
          request: {
            artist: sheet.artist.trim(),
            artistEntityId: sheet.artistEntityId,
            marketId: sheet.marketId,
            candidateDates: sheet.dates.filter(Boolean),
            radiusMiles: sheet.radiusMiles,
          },
        }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        setProblem({ title: "The analysis could not start.", detail: [j.error ?? `Server returned ${res.status}.`] });
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const msg = JSON.parse(line) as { type: "progress"; event: ProgressEvent } | { type: "outcome"; outcome: PipelineOutcome } | { type: "fatal"; message: string };
          if (msg.type === "progress") setProgress((p) => ({ ...p, [msg.event.step]: msg.event }));
          else if (msg.type === "fatal") setProblem({ title: "The analysis stopped unexpectedly.", detail: [msg.message] });
          else handleOutcome(msg.outcome);
        }
      }
    } catch {
      setProblem({ title: "Could not reach the server.", detail: ["Check your connection and try again."] });
    } finally {
      setRunning(false);
    }
  }

  function handleOutcome(o: PipelineOutcome) {
    if (o.kind === "result") loadResult(o.result);
    else if (o.kind === "clarify") {
      setClarify(o.target.candidates);
      setProblem({ title: o.message, detail: o.target.candidates.length ? ["Pick the right artist in the form, then run again."] : [] });
    } else if (o.kind === "invalid") setProblem({ title: o.message, detail: o.issues });
    else setProblem({ title: "No ranking was produced.", detail: [o.message] });
  }

  // What-if: recompute in the browser with the same engine.
  const view = useMemo((): { dates: DateScore[]; verdict: RankingVerdict } | null => {
    if (!result) return null;
    if (ignored.size === 0) return { dates: result.dates, verdict: result.verdict };
    const { links, signals } = rebuildScoringInputs(result);
    const dates = scoreDates({ candidateDates: result.request.candidateDates, events: result.events, links, signals, ignoredEventIds: [...ignored] });
    return { dates, verdict: buildVerdict(dates) };
  }, [result, ignored]);

  const toggle = (id: string) =>
    setIgnored((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const selectedDate = view?.dates.find((d) => d.date === selected) ?? view?.dates[0];
  const scale = view ? Math.max(0.05, ...view.dates.flatMap((d) => d.contributions.map((c) => (c.scored ? (c.contribution ?? 0) : 0)))) : 1;
  const artistName = result?.target.entity?.name ?? sheet.artist;
  const showSteps = running || Object.keys(progress).length > 0;

  return (
    <div className="shell">
      <header className="masthead">
        <h1 className="wordmark">Undertow</h1>
        <p className="tagline">Know which nights your crowd is already spoken for.</p>
        <div className="mode-switch" role="group" aria-label="Data source">
          <button type="button" aria-pressed={mode === "live"} disabled={!status?.liveAvailable} title={status && !status.liveAvailable ? "Live data needs Qloo and Ticketmaster keys on the server" : undefined} onClick={() => switchMode("live")}>
            Live data
          </button>
          <button type="button" aria-pressed={mode === "demo"} onClick={() => switchMode("demo")}>
            Demo data
          </button>
        </div>
      </header>

      <div className="layout">
        <aside className="sheet" aria-label="Request">
          <div className="tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === "form"} onClick={() => setTab("form")}>
              Hold sheet
            </button>
            <button type="button" role="tab" aria-selected={tab === "agent"} onClick={() => setTab("agent")}>
              Ask the agent
            </button>
          </div>
          {tab === "form" ? (
            <>
              <HoldSheet mode={mode} value={sheet} onChange={setSheet} onRun={run} running={running} clarify={clarify} />
              {showSteps && (
                <ol className="steps" aria-label="Analysis progress" aria-live="polite">
                  {STEPS.map((s) => {
                    const p = progress[s];
                    return (
                      <li key={s} data-status={p?.status ?? "pending"}>
                        <span>
                          {STEP_LABELS[s]}
                          {p?.detail && <span className="detail">{p.detail}</span>}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              )}
            </>
          ) : (
            <AgentPanel mode={mode} agentAvailable={!!status?.agent} current={result} onAnalysis={loadResult} />
          )}
        </aside>

        <main className="main">
          {mode === "demo" && (
            <div className="notice demo" role="note">
              <p>
                <strong>Demo data.</strong> Every artist, venue and number in this mode is fictional, written to show how Undertow works. Switch to live data for real Ticketmaster events
                and Qloo affinity.
              </p>
            </div>
          )}

          {problem && (
            <div className="notice error" role="alert">
              <p>
                <strong>{problem.title}</strong>
              </p>
              {problem.detail.map((d, i) => (
                <p key={i}>{d}</p>
              ))}
            </div>
          )}

          {!result || !view ? (
            <Empty mode={mode} />
          ) : (
            <>
              {ignored.size > 0 && (
                <div className="notice" role="status">
                  <p>
                    What-if: {ignored.size} {ignored.size === 1 ? "show is" : "shows are"} left out of the calculation.{" "}
                    {view.verdict.recommendedDate !== result.verdict.recommendedDate
                      ? `The recommendation changes from ${fmtShort(result.verdict.recommendedDate!)} to ${fmtShort(view.verdict.recommendedDate!)}.`
                      : "The recommendation does not change."}{" "}
                    <button type="button" className="link-btn" onClick={() => setIgnored(new Set())}>
                      Restore all shows
                    </button>
                  </p>
                </div>
              )}

              <section className="verdict" aria-labelledby="verdict-h">
                <h2 id="verdict-h" className="sr-only">
                  Recommendation
                </h2>
                {view.verdict.recommendedDate && (
                  <p className="verdict-date">
                    {fmtDayYear(view.verdict.recommendedDate)}
                    <small>for {artistName}</small>
                  </p>
                )}
                <p className="verdict-summary">{humanizeDates(view.verdict.summary)}</p>
                <ul className="flags">
                  {view.dates.length > 1 && (
                    <li className={`flag ${view.verdict.robust ? "good" : "caution"}`}>
                      {view.verdict.robust ? "Holds even if every unscored show were a direct competitor" : "Could flip if unscored shows overlap strongly"}
                    </li>
                  )}
                  {view.dates.length > 1 && (
                    <li className={`flag ${view.verdict.baselineAgrees ? "" : "contrast"}`}>
                      {view.verdict.baselineAgrees ? "A plain count agrees" : "A plain count would pick differently"}
                    </li>
                  )}
                  <li className="flag">
                    {result.market.label}, {result.request.radiusMiles} miles
                  </li>
                </ul>
                {view.verdict.whatWouldChange.length > 0 && (
                  <details style={{ marginTop: 12 }}>
                    <summary>What would change this</summary>
                    <ul>
                      {view.verdict.whatWouldChange.map((w, i) => (
                        <li key={i}>{humanizeDates(w)}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </section>

              <section className="section" aria-labelledby="strips-h">
                <div className="section-head">
                  <h2 id="strips-h">The pull on each date</h2>
                  <p>Two weeks either side of each date. Pick a date to see the shows behind its score.</p>
                </div>
                <div className="panel strips">
                  {view.dates.map((d) => (
                    <UndertowStrip
                      key={d.date}
                      d={d}
                      scale={scale}
                      best={d.date === view.verdict.recommendedDate}
                      selected={d.date === selectedDate?.date}
                      onSelect={() => setSelected(d.date)}
                    />
                  ))}
                  <StripLegend />
                </div>
              </section>

              {selectedDate && (
                <section className="section" aria-labelledby="inspect-h">
                  <div className="section-head">
                    <h2 id="inspect-h">Shows behind {fmtShort(selectedDate.date)}</h2>
                    <p>Untick a show you know will move to see the ranking recalculated. Contributions always sum to the clash score ({fmt2(selectedDate.score)}).</p>
                  </div>
                  <ClashInspector date={selectedDate} dates={view.dates} events={result.events} resolutions={result.resolutions} ignored={ignored} onToggle={toggle} />
                </section>
              )}

              <section className="section" aria-labelledby="base-h">
                <div className="section-head">
                  <h2 id="base-h">Does Qloo change the answer?</h2>
                  <p>The same shows ranked two ways.</p>
                </div>
                <BaselinePanel dates={view.dates} artist={artistName} />
              </section>

              <section className="section" aria-labelledby="ev-h">
                <div className="section-head">
                  <h2 id="ev-h">Evidence and limits</h2>
                </div>
                <EvidencePanel result={result} />
              </section>
            </>
          )}
        </main>
      </div>

      <footer className="footer">
        <p>
          Event data from the Ticketmaster Discovery API. Taste and affinity data from Qloo. Undertow estimates potential audience competition; it does not measure ticket sales or
          shared buyers.
        </p>
      </footer>
    </div>
  );
}

function Empty({ mode }: { mode: "live" | "demo" }) {
  return (
    <section className="empty">
      <h2>Which of your holds is already spoken for?</h2>
      <p>
        Enter an artist, a market and the dates you can hold. Undertow pulls every music event within two weeks of each date from Ticketmaster, asks Qloo how strongly each competing act&apos;s
        audience overlaps with yours, and ranks your dates by that pull.
      </p>
      <p className="muted">
        {mode === "demo"
          ? "The form is filled in with the fictional demo scenario. Run it to see a busy night that turns out to be safe, and a quiet one that isn't."
          : "Every number on the result traces back to a specific show, a Qloo signal and a timing weight."}
      </p>
    </section>
  );
}
