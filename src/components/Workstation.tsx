"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DEMO_DATES, DEMO_MARKET, DEMO_TARGET } from "@/lib/demo/provider";
import { STEP_LABELS, rebuildScoringInputs, type PipelineOutcome, type ProgressEvent, type StepId } from "@/lib/pipeline";
import { buildVerdict, scoreDates } from "@/lib/scoring/engine";
import type { AnalysisResult, ArtistCandidate, DateScore, RankingVerdict } from "@/lib/types";
import { AgentSheet } from "./AgentSheet";
import { CommandBar, type RequestValue } from "./CommandBar";
import { DateCards } from "./DateCards";
import { Details } from "./Details";
import { ShowList } from "./ShowList";
import { Timeline } from "./Timeline";
import { Versus } from "./Versus";
import { fmt2, fmtDay, fmtLong, fmtShort } from "./format";
import { Alert, Calendar, Check, Exclaim, Mark, Scale, Waves } from "./icons";

interface Status {
  liveAvailable: boolean;
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

const demoRequest = (): RequestValue => ({ artist: DEMO_TARGET, marketId: DEMO_MARKET, dates: [...DEMO_DATES], radiusMiles: 30 });
const liveRequest = (): RequestValue => ({ artist: "", marketId: "chicago", dates: upcomingSaturdays(), radiusMiles: 30 });

export function Workstation() {
  const [status, setStatus] = useState<Status | null>(null);
  const [mode, setMode] = useState<"live" | "demo">("demo");
  const [req, setReq] = useState<RequestValue>(demoRequest);
  const [progress, setProgress] = useState<Partial<Record<StepId, ProgressEvent>>>({});
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [problem, setProblem] = useState<{ title: string; detail: string[]; tone: "error" | "info" } | null>(null);
  const [clarify, setClarify] = useState<ArtistCandidate[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [ignored, setIgnored] = useState<Set<string>>(new Set());
  const [askOpen, setAskOpen] = useState(false);

  useEffect(() => {
    fetch("/api/status")
      .then((r) => r.json())
      .then((s: Status) => {
        setStatus(s);
        if (s.liveAvailable) {
          setMode("live");
          setReq(liveRequest());
        }
      })
      .catch(() => setStatus({ liveAvailable: false, agent: false }));
  }, []);

  const switchMode = (m: "live" | "demo") => {
    if (m === mode) return;
    setMode(m);
    setReq(m === "demo" ? demoRequest() : liveRequest());
    setResult(null);
    setProblem(null);
    setClarify(null);
    setProgress({});
    setIgnored(new Set());
  };

  const loadResult = useCallback((r: AnalysisResult) => {
    setResult(r);
    setSelected(r.verdict.recommendedDate ?? r.dates[0]?.date ?? null);
    setIgnored(new Set());
    setProblem(null);
    setClarify(null);
    requestAnimationFrame(() => document.getElementById("verdict")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, []);

  function handleOutcome(o: PipelineOutcome) {
    if (o.kind === "result") loadResult(o.result);
    else if (o.kind === "clarify") {
      setClarify(o.target.candidates);
      setProblem({ tone: "info", title: o.message, detail: o.target.candidates.length ? ["Choose one under the artist field, then analyze again."] : [] });
    } else if (o.kind === "invalid") setProblem({ tone: "error", title: "Check the request.", detail: o.issues });
    else setProblem({ tone: "error", title: "No ranking was produced.", detail: [o.message] });
  }

  async function run() {
    setRunning(true);
    setProgress({});
    setProblem(null);
    setClarify(null);
    setResult(null);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode,
          request: { artist: req.artist.trim(), artistEntityId: req.artistEntityId, marketId: req.marketId, candidateDates: req.dates, radiusMiles: req.radiusMiles },
        }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        setProblem({ tone: "error", title: "The analysis couldn't start.", detail: [j.error ?? `The server returned ${res.status}.`] });
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
          else if (msg.type === "fatal") setProblem({ tone: "error", title: "The analysis stopped.", detail: [msg.message] });
          else handleOutcome(msg.outcome);
        }
      }
    } catch {
      setProblem({ tone: "error", title: "Couldn't reach the server.", detail: ["Check your connection and try again."] });
    } finally {
      setRunning(false);
    }
  }

  // What-if: recompute in the browser with the same engine.
  const view = useMemo((): { dates: DateScore[]; verdict: RankingVerdict } | null => {
    if (!result) return null;
    if (ignored.size === 0) return { dates: result.dates, verdict: result.verdict };
    const { links, signals, typicalUnit } = rebuildScoringInputs(result);
    const dates = scoreDates({ candidateDates: result.request.candidateDates, events: result.events, links, signals, typicalUnit, ignoredEventIds: [...ignored] });
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
  const artist = result?.target.entity?.name ?? req.artist;
  const rec = view?.verdict.recommendedDate ?? null;
  const ordered = view ? [...view.dates].sort((a, b) => a.rank - b.rank) : [];
  const runnerUp = ordered[1];
  const resolutions = result ? Object.values(result.resolutions) : [];
  const matchedCount = resolutions.filter((r) => r.status === "exact" || r.status === "confirmed").length;
  const anyShows = view?.dates.some((d) => d.inWindowEvents > 0) ?? false;
  const noEvidence = !!view && anyShows && view.dates.every((d) => d.scoredEvents === 0);

  return (
    <>
      <nav className="nav" aria-label="Main">
        <div className="nav-inner">
          <p className="brand">
            <Mark className="brand-mark" />
            Undertow
          </p>
          <span className="nav-spacer" />
          <button type="button" className="nav-link" onClick={() => setAskOpen(true)}>
            Ask
          </button>
          <div className="segmented" role="group" aria-label="Data source">
            <button
              type="button"
              aria-pressed={mode === "live"}
              disabled={!status?.liveAvailable}
              title={status && !status.liveAvailable ? "Live data needs Qloo and Ticketmaster keys on the server" : undefined}
              onClick={() => switchMode("live")}
            >
              Live
            </button>
            <button type="button" aria-pressed={mode === "demo"} onClick={() => switchMode("demo")}>
              Demo
            </button>
          </div>
        </div>
      </nav>
      {mode === "demo" && (
        <div className="ribbon" role="note">
          <strong>Demo data.</strong> Every artist, venue and number here is fictional.
        </div>
      )}

      <main className="page">
        <section className={`hero${result ? " compact" : ""}`}>
          <h1>Pick the night your fans are free.</h1>
          <p>Undertow checks every show near your dates and weighs each by how much its audience overlaps with yours.</p>
        </section>

        <CommandBar mode={mode} value={req} onChange={setReq} onRun={run} running={running} clarify={clarify} onAsk={() => setAskOpen(true)} />

        {running && (
          <div className="progress" aria-live="polite" aria-label="Progress">
            <ol>
              {STEPS.map((s) => {
                const p = progress[s];
                const st = p?.status ?? "pending";
                return (
                  <li key={s} data-status={st}>
                    <span className="step-icon">{st === "done" ? <Check size={11} /> : st === "warning" || st === "error" ? <Exclaim size={11} /> : null}</span>
                    <span>
                      {STEP_LABELS[s]}
                      {p?.detail && <span className="detail">{p.detail}</span>}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        )}

        {problem && (
          <div className={`alert${problem.tone === "info" ? " info" : ""}`} role="alert">
            <span className="icon">
              <Alert size={20} />
            </span>
            <div>
              <p>
                <strong>{problem.title}</strong>
              </p>
              {problem.detail.map((d, i) => (
                <p key={i}>{d}</p>
              ))}
            </div>
          </div>
        )}

        {!result && !running && !problem && (
          <div className="how">
            <div className="card">
              <span className="how-icon">
                <Calendar />
              </span>
              <h3>Every nearby show</h3>
              <p>Music events within two weeks of each date, straight from Ticketmaster.</p>
            </div>
            <div className="card">
              <span className="how-icon">
                <Waves />
              </span>
              <h3>Weighted by your fans</h3>
              <p>Qloo measures how closely each act&apos;s audience overlaps with your artist&apos;s.</p>
            </div>
            <div className="card">
              <span className="how-icon">
                <Scale />
              </span>
              <h3>Nothing hidden</h3>
              <p>Every score breaks down into shows, signals and timing you can check.</p>
            </div>
          </div>
        )}

        {result && view && (
          <div className="results">
            <p className="run-summary">
              Checked {result.events.length + result.excluded.length} shows in {result.market.label} · matched {matchedCount} of {resolutions.length} artists in Qloo
            </p>

            <section className="verdict" id="verdict" aria-labelledby="verdict-title">
              {rec && (
                <>
                  <p className={`eyebrow${noEvidence ? " caution" : ""}`}>
                    {noEvidence
                      ? "Not enough data to rank these dates"
                      : !anyShows
                        ? `No competing shows found for ${artist}`
                        : view.dates.length > 1
                          ? `Best night for ${artist}`
                          : `Clash check for ${artist}`}
                  </p>
                  <h2 id="verdict-title">{noEvidence || !anyShows ? `${view.dates.length} ${view.dates.length === 1 ? "date" : "dates"} checked` : fmtLong(rec)}</h2>
                  <p className="lede">
                    {noEvidence ? (
                      <>
                        There are {Math.max(...view.dates.map((d) => d.inWindowEvents))} shows nearby, but Qloo returned no affinity for any of them with {artist}, so there&apos;s nothing to
                        weigh. The shows are listed below.
                      </>
                    ) : !anyShows ? (
                      <>Ticketmaster lists no music events within two weeks of these dates in {result.market.label}. Shows sold elsewhere won&apos;t appear here.</>
                    ) : view.dates.length > 1 && runnerUp ? (
                      <>
                        The least pull on {artist}&apos;s audience in {result.market.label}. It scores <strong>{fmt2(ordered[0].score)}</strong>, against{" "}
                        <strong>{fmt2(runnerUp.score)}</strong> for {fmtDay(runnerUp.date)}.
                      </>
                    ) : (
                      <>Clash score {fmt2(ordered[0]?.score)} from {ordered[0]?.inWindowEvents ?? 0} shows nearby.</>
                    )}
                  </p>
                  <ul className="pills">
                    {view.dates.length > 1 && !noEvidence && anyShows && (
                      <li
                        className={`pill ${view.verdict.robust || view.verdict.holdsIfTypical ? "good" : "warn"}`}
                        title="Checked against shows Qloo couldn't match: once assuming each is a perfect match for your audience, once assuming each is a typical act nearby."
                      >
                        {view.verdict.robust
                          ? "Holds even in the worst case"
                          : view.verdict.holdsIfTypical
                            ? "Holds unless unmatched acts are unusually close"
                            : "Could change with unmatched acts"}
                      </li>
                    )}
                    {view.dates.length > 1 && !noEvidence && anyShows && !view.verdict.baselineAgrees && <li className="pill blue">A headcount would pick differently</li>}
                    {view.dates.length > 1 && !noEvidence && anyShows && view.verdict.baselineAgrees && <li className="pill">A headcount agrees</li>}
                  </ul>
                </>
              )}
              {ignored.size > 0 && (
                <div className="whatif-bar" role="status">
                  <span>
                    {ignored.size} {ignored.size === 1 ? "show" : "shows"} switched off.{" "}
                    {rec !== result.verdict.recommendedDate ? `Best night moves from ${fmtShort(result.verdict.recommendedDate!)} to ${fmtShort(rec!)}.` : "The best night doesn't change."}
                  </span>
                  <button type="button" className="btn-plain" onClick={() => setIgnored(new Set())}>
                    Reset
                  </button>
                </div>
              )}
            </section>

            <section className="section" aria-labelledby="dates-title">
              <h2 className="section-title" id="dates-title">
                Your dates, side by side.
              </h2>
              <p className="section-sub">Lower is better. Choose a date to see what&apos;s around it.</p>
              <DateCards dates={view.dates} best={rec} selected={selectedDate?.date ?? null} onSelect={setSelected} />
              {selectedDate && <Timeline d={selectedDate} scale={scale} />}
            </section>

            {selectedDate && (
              <section className="section" aria-labelledby="shows-title">
                <h2 className="section-title" id="shows-title">
                  What&apos;s pulling on {fmtDay(selectedDate.date)}.
                </h2>
                <p className="section-sub">Each show&apos;s share of the score, strongest first.</p>
                <ShowList date={selectedDate} dates={view.dates} events={result.events} resolutions={result.resolutions} ignored={ignored} onToggle={toggle} />
              </section>
            )}

            {view.dates.length > 1 && (
              <section className="section" aria-labelledby="versus-title">
                <h2 className="section-title" id="versus-title">
                  Does Qloo change the answer?
                </h2>
                <p className="section-sub">The same shows, ranked two ways.</p>
                <Versus dates={view.dates} artist={artist} />
              </section>
            )}

            <section className="section" aria-labelledby="details-title">
              <h2 className="section-title" id="details-title">
                The details.
              </h2>
              <p className="section-sub">How the score works, what it can&apos;t see, and where the data came from.</p>
              <Details result={result} whatWouldChange={view.verdict.whatWouldChange} />
            </section>
          </div>
        )}
      </main>

      <footer className="footer">
        <div className="footer-inner">
          <p>Event data from Ticketmaster. Taste and affinity data from Qloo.</p>
          <p>Undertow estimates potential competition for an audience. It doesn&apos;t measure ticket sales or shared buyers.</p>
        </div>
      </footer>

      <AgentSheet open={askOpen} onClose={() => setAskOpen(false)} mode={mode} available={!!status?.agent} current={result} onAnalysis={loadResult} />
    </>
  );
}
