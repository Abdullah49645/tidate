"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { DEMO_DATES, DEMO_MARKET, DEMO_TARGET } from "@/lib/demo/provider";
import { STEP_LABELS, hydrateResult, rebuildScoringInputs, type PipelineOutcome, type ProgressEvent, type StepId } from "@/lib/pipeline";
import { buildVerdict, scoreDates } from "@/lib/scoring/engine";
import { NIGHTS, type AnalysisResult, type ArtistCandidate, type DateScore, type RankingVerdict, type SharedTaste } from "@/lib/types";
import { AgentSheet } from "./AgentSheet";
import { CalendarTile } from "./CalendarTile";
import { CountUp } from "./CountUp";
import { Tide } from "./Tide";
import { CommandBar, type RequestValue } from "./CommandBar";
import { DateCards } from "./DateCards";
import { Details } from "./Details";
import { FanMap } from "./FanMap";
import { NightCalendar } from "./NightCalendar";
import { Provisional } from "./Provisional";
import { ShowList } from "./ShowList";
import { Timeline } from "./Timeline";
import { Versus } from "./Versus";
import { fmt2, fmtDay, fmtLong, fmtShort, humanizeDates } from "./format";
import { Alert, Check, Exclaim } from "./icons";
import { Logo } from "./Logo";
import { WatchButton } from "./WatchButton";
import { loadLocalWatches } from "./watchlist";

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

function isoIn(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const demoRequest = (): RequestValue => ({
  artist: DEMO_TARGET,
  marketId: DEMO_MARKET,
  dates: [...DEMO_DATES],
  radiusMiles: 30,
  kind: "compare",
  from: "2027-05-01",
  to: "2027-05-29",
  nights: "fri-sat",
});
const liveRequest = (): RequestValue => ({
  artist: "",
  marketId: "chicago",
  dates: upcomingSaturdays(),
  radiusMiles: 30,
  kind: "compare",
  from: isoIn(21),
  to: isoIn(76),
  nights: "fri-sat",
});

/**
 * A link like /?mode=live&artist=Clairo&market=chicago&dates=2026-12-05,2026-12-12
 * (or &from=&to=&nights=) opens the app and runs that request. Watch pages use it.
 */
function requestFromUrl(liveAvailable: boolean): { mode: "live" | "demo"; req: RequestValue } | null {
  const p = new URLSearchParams(window.location.search);
  const artist = p.get("artist")?.trim();
  if (!artist) return null;
  const mode = p.get("mode") === "live" && liveAvailable ? "live" : "demo";
  const base = mode === "demo" ? demoRequest() : liveRequest();
  const iso = (x: string | null) => (x && /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : null);
  const dates = (p.get("dates") ?? "").split(",").map(iso).filter((x): x is string => !!x).slice(0, 4);
  const from = iso(p.get("from"));
  const to = iso(p.get("to"));
  const nights = p.get("nights");
  const req: RequestValue = {
    ...base,
    artist,
    artistEntityId: p.get("entity") ?? undefined,
    marketId: p.get("market") ?? base.marketId,
    radiusMiles: Number(p.get("radius")) || base.radiusMiles,
    ...(from && to ? { kind: "discover" as const, from, to, nights: nights === "thu-sat" || nights === "all" ? nights : "fri-sat" } : { kind: "compare" as const, dates: dates.length ? dates : base.dates }),
  };
  return { mode, req };
}

function subscribeWatches(cb: () => void) {
  window.addEventListener("tidate-watches", cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener("tidate-watches", cb);
    window.removeEventListener("storage", cb);
  };
}

function useLocalWatchCount() {
  return useSyncExternalStore(
    subscribeWatches,
    () => loadLocalWatches().length,
    () => 0,
  );
}

/** The best three nights by each method, so the slope chart stays readable in a night search. */
function versusSet(dates: DateScore[]): DateScore[] {
  if (dates.length <= 4) return dates;
  const q = [...dates].sort((a, b) => a.rank - b.rank).slice(0, 3);
  const b = [...dates].sort((a, b) => a.baselineRank - b.baselineRank).slice(0, 3);
  return [...new Map([...q, ...b].map((d) => [d.date, d])).values()];
}

export function Workstation() {
  const [status, setStatus] = useState<Status | null>(null);
  const [mode, setMode] = useState<"live" | "demo">("demo");
  const [req, setReq] = useState<RequestValue>(demoRequest);
  const modeState = mode;
  const reqState = req;
  const localWatches = useLocalWatchCount();
  const [progress, setProgress] = useState<Partial<Record<StepId, ProgressEvent>>>({});
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [problem, setProblem] = useState<{ title: string; detail: string[]; tone: "error" | "info" } | null>(null);
  const [clarify, setClarify] = useState<ArtistCandidate[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [ignored, setIgnored] = useState<Set<string>>(new Set());
  /** Nights left out of a night search (a holiday, a night the venue is dark). */
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [askOpen, setAskOpen] = useState(false);
  const [taste, setTaste] = useState<{ key: string; rows: Record<string, SharedTaste> }>({ key: "", rows: {} });

  useEffect(() => {
    fetch("/api/status")
      .then((r) => r.json())
      .then((s: Status) => {
        setStatus(s);
        const fromLink = requestFromUrl(s.liveAvailable);
        if (fromLink) {
          window.history.replaceState(null, "", window.location.pathname);
          setMode(fromLink.mode);
          setReq(fromLink.req);
          void run(fromLink);
        } else if (s.liveAvailable) {
          setMode("live");
          setReq(liveRequest());
        }
      })
      .catch(() => setStatus({ liveAvailable: false, agent: false }));
    // run is stable enough here: it is called once, with explicit arguments.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    setSkipped(new Set());
  };

  const loadResult = useCallback((raw: AnalysisResult) => {
    const r = hydrateResult(raw);
    setResult(r);
    setSelected(r.verdict.recommendedDate ?? r.dates[0]?.date ?? null);
    setIgnored(new Set());
    setSkipped(new Set());
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

  async function run(explicit?: { mode: "live" | "demo"; req: RequestValue }) {
    const mode = explicit?.mode ?? modeState;
    const req = explicit?.req ?? reqState;
    setRunning(true);
    setProgress({});
    setProblem(null);
    setClarify(null);
    setResult(null);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          req.kind === "discover"
            ? {
                mode,
                kind: "discover",
                request: { artist: req.artist.trim(), artistEntityId: req.artistEntityId, marketId: req.marketId, from: req.from, to: req.to, nights: req.nights, radiusMiles: req.radiusMiles },
              }
            : {
                mode,
                request: { artist: req.artist.trim(), artistEntityId: req.artistEntityId, marketId: req.marketId, candidateDates: req.dates, radiusMiles: req.radiusMiles },
              },
        ),
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
    if (ignored.size === 0 && skipped.size === 0) return { dates: result.dates, verdict: result.verdict };
    const { links, signals, typicalUnit } = rebuildScoringInputs(result);
    const candidateDates = result.request.candidateDates.filter((d) => !skipped.has(d));
    const dates = scoreDates({ candidateDates, events: result.events, links, signals, typicalUnit, ignoredEventIds: [...ignored] });
    return { dates, verdict: buildVerdict(dates) };
  }, [result, ignored, skipped]);

  const toggleNight = (date: string) => {
    if (!result) return;
    const next = new Set(skipped);
    if (next.has(date)) next.delete(date);
    else if (result.request.candidateDates.length - next.size > 2) next.add(date);
    else return;
    setSkipped(next);
    if (next.has(date) && selected === date) setSelected(null);
  };

  // Shared Qloo tags between the target and each visible act (context only, fetched on demand).
  const targetId = result?.target.entity?.entityId ?? null;
  const tasteKey = targetId ? `${result!.mode}|${targetId}` : "";
  const tasteRows = taste.key === tasteKey ? taste.rows : {};
  const requested = useRef<{ key: string; ids: Set<string> }>({ key: "", ids: new Set() });
  const needTaste = useCallback(
    (ids: string[]) => {
      if (!tasteKey) return;
      if (requested.current.key !== tasteKey) requested.current = { key: tasteKey, ids: new Set() };
      const missing = ids.filter((id) => !requested.current.ids.has(id)).slice(0, 40);
      if (!missing.length) return;
      for (const id of missing) requested.current.ids.add(id);
      const [m, target] = tasteKey.split("|");
      fetch(`/api/taste?mode=${m}&target=${encodeURIComponent(target)}&ids=${missing.map(encodeURIComponent).join(",")}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j: { results: SharedTaste[] } | null) => {
          if (!j) return;
          setTaste((now) => ({ key: tasteKey, rows: { ...(now.key === tasteKey ? now.rows : {}), ...Object.fromEntries(j.results.map((x) => [x.entityId, x])) } }));
        })
        .catch(() => {
          /* tags are optional context */
        });
    },
    [tasteKey],
  );

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
  const discover = result?.discover ?? null;
  const shortlist = discover && view ? ordered.slice(0, 3) : [];
  const provisional = progress.performers?.provisional;
  const noEvidence = !!view && anyShows && view.dates.every((d) => d.scoredEvents === 0);

  return (
    <>
      <nav className="nav" aria-label="Main">
        <div className="nav-inner">
          <Link className="brand" href="/" aria-label="Tidate, home">
            <Logo />
          </Link>
          <span className="nav-spacer" />
          {localWatches > 0 && (
            <Link className="nav-link" href="/watch">
              Watching
            </Link>
          )}
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
        <div className={`stage${result || running ? " settled" : ""}`}>
          <Tide />
          <section className={`hero${result ? " compact" : ""}`}>
            <h1>
              <span className="line">Pick the night</span> <span className="line">your fans are free.</span>
            </h1>
            <p>Tidate checks every show near your dates and weighs each by how much its audience overlaps with yours.</p>
          </section>
          <div className="stage-bar">
            <CommandBar mode={mode} value={req} onChange={setReq} onRun={run} running={running} clarify={clarify} onAsk={() => setAskOpen(true)} />
          </div>
        </div>

        {running && (
          <div
            className="progress"
            aria-live="polite"
            aria-label="Progress"
            style={{ ["--done" as string]: STEPS.filter((x) => progress[x] && progress[x]!.status !== "running").length / STEPS.length }}
          >
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
            {provisional && progress.performers?.status === "running" && <Provisional p={provisional} limit={req.kind === "discover" ? 3 : 4} />}
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
          <ol className="how">
            <li>
              <span className="how-n">1</span>
              <h3>Every nearby show</h3>
              <p>Ticketmaster lists the music events within two weeks of each date you can hold.</p>
            </li>
            <li>
              <span className="how-n">2</span>
              <h3>Weighed against your fans</h3>
              <p>Qloo measures how closely each act&apos;s audience sits to your artist&apos;s.</p>
            </li>
            <li>
              <span className="how-n">3</span>
              <h3>A night you can defend</h3>
              <p>Every score breaks down into shows, signals and timing you can check.</p>
            </li>
          </ol>
        )}

        {result && view && (
          <div className="results">

            <section className="verdict" id="verdict" aria-labelledby="verdict-title" key={result.generatedAt}>
              {rec && (
                <div className={`verdict-layout${noEvidence || !anyShows ? " plain" : ""}`}>
                  {!noEvidence && anyShows && <CalendarTile iso={rec} year={new Date(`${rec}T00:00:00Z`).getUTCFullYear() !== new Date().getUTCFullYear()} />}
                  <div className="verdict-text">
                    <p className={`eyebrow${noEvidence ? " caution" : ""}`}>
                      {noEvidence
                        ? "Not enough data to rank these dates"
                        : !anyShows
                          ? `No competing shows found for ${artist}`
                          : discover
                            ? `Best of ${view.dates.length} ${NIGHTS[discover.nights].plural} in ${result.market.label}`
                            : view.dates.length > 1
                            ? `Best of ${view.dates.length} dates in ${result.market.label}`
                            : `Clash check in ${result.market.label}`}
                    </p>
                    <h2 id="verdict-title">
                      {noEvidence || !anyShows
                        ? `${view.dates.length} ${view.dates.length === 1 ? "date" : "dates"} checked`
                        : view.dates.length > 1
                          ? `${fmtLong(rec)} is ${artist}'s night.`
                          : fmtLong(rec)}
                    </h2>
                    <p className="lede">
                      {noEvidence ? (
                        <>
                          There are {Math.max(...view.dates.map((d) => d.inWindowEvents))} shows nearby, but Qloo returned no affinity for any of them with {artist}, so there&apos;s nothing
                          to weigh. The shows are listed below.
                        </>
                      ) : !anyShows ? (
                        <>Ticketmaster lists no music events within two weeks of these dates in {result.market.label}. Shows sold elsewhere won&apos;t appear here.</>
                      ) : view.dates.length > 1 && runnerUp ? (
                        <>
                          The least pull on {artist}&apos;s audience: a clash score of{" "}
                          <strong>
                            <CountUp value={ordered[0].score} delay={450} />
                          </strong>
                          , against{" "}
                          <strong>
                            <CountUp value={runnerUp.score} delay={450} />
                          </strong>{" "}
                          for{" "}
                          {fmtDay(runnerUp.date)}.
                        </>
                      ) : (
                        <>
                          Clash score <strong>{fmt2(ordered[0]?.score)}</strong> from {ordered[0]?.inWindowEvents ?? 0} shows nearby.
                        </>
                      )}
                    </p>
                    <dl className="ledger">
                      {view.dates.length > 1 && !noEvidence && anyShows && (
                        <div title="Checked against shows Qloo couldn't match: once assuming each is a perfect match for your audience, once assuming each is a typical act nearby.">
                          <dt>Robustness</dt>
                          <dd>
                            <i className={`dot ${view.verdict.robust || view.verdict.holdsIfTypical ? "good" : "warn"}`} aria-hidden />
                            {view.verdict.robust
                              ? "Holds even in the worst case"
                              : view.verdict.holdsIfTypical
                                ? "Holds unless unmatched acts are unusually close"
                                : "Could change with unmatched acts"}
                          </dd>
                        </div>
                      )}
                      {view.dates.length > 1 && !noEvidence && anyShows && (
                        <div>
                          <dt>Headcount</dt>
                          <dd>
                            {view.verdict.baselineAgrees ? (
                              "Agrees with this date"
                            ) : (
                              <>
                                Would pick <span className="accent">{fmtDay([...view.dates].sort((a, b) => a.baselineRank - b.baselineRank)[0].date)}</span> instead
                              </>
                            )}
                          </dd>
                        </div>
                      )}
                      {result.diagnostics
                        .filter((d) => d.code === "quiet-market-night")
                        .map((d) => (
                          <div key={d.code}>
                            <dt>Check</dt>
                            <dd>
                              <i className="dot warn" aria-hidden />
                              {humanizeDates(d.message)}
                            </dd>
                          </div>
                        ))}
                      <div>
                        <dt>Coverage</dt>
                        <dd>
                          {matchedCount} of {resolutions.length} artists matched in Qloo, across {result.events.length + result.excluded.length} shows
                        </dd>
                      </div>
                    </dl>
                    {!noEvidence && <WatchButton key={result.generatedAt} result={result} />}
                  </div>
                </div>
              )}
              {(ignored.size > 0 || skipped.size > 0) && (
                <div className="whatif-bar" role="status">
                  <span>
                    {[ignored.size ? `${ignored.size} ${ignored.size === 1 ? "show" : "shows"} switched off.` : null, skipped.size ? `${skipped.size} ${skipped.size === 1 ? "night" : "nights"} skipped.` : null]
                      .filter(Boolean)
                      .join(" ")}{" "}
                    {rec !== result.verdict.recommendedDate ? `Best night moves from ${fmtShort(result.verdict.recommendedDate!)} to ${fmtShort(rec!)}.` : "The best night doesn't change."}
                  </span>
                  <button
                    type="button"
                    className="btn-plain"
                    onClick={() => {
                      setIgnored(new Set());
                      setSkipped(new Set());
                    }}
                  >
                    Reset
                  </button>
                </div>
              )}
            </section>

            {discover ? (
              <section className="section" aria-labelledby="dates-title">
                <h2 className="section-title" id="dates-title">
                  Every night, at a glance.
                </h2>
                <p className="section-sub">
                  {view.dates.length} {NIGHTS[discover.nights].plural} from {fmtShort(discover.from)} to {fmtShort(discover.to)}. Darker nights carry more pull on {artist}&apos;s
                  audience.
                </p>
                <NightCalendar
                  dates={view.dates}
                  from={discover.from}
                  to={discover.to}
                  selected={selectedDate?.date ?? null}
                  onSelect={setSelected}
                  skipped={skipped}
                  onToggleSkip={toggleNight}
                  canSkip={view.dates.length > 2}
                />
                <h3 className="sub-title">The shortlist</h3>
                <DateCards dates={shortlist} total={view.dates.length} best={rec} selected={selectedDate?.date ?? null} onSelect={setSelected} />
                {selectedDate && <Timeline key={selectedDate.date} d={selectedDate} scale={scale} />}
              </section>
            ) : (
              <section className="section" aria-labelledby="dates-title">
                <h2 className="section-title" id="dates-title">
                  Your dates, side by side.
                </h2>
                <p className="section-sub">Lower is better. Choose a date to see what&apos;s around it.</p>
                <DateCards dates={view.dates} best={rec} selected={selectedDate?.date ?? null} onSelect={setSelected} />
                {selectedDate && <Timeline key={selectedDate.date} d={selectedDate} scale={scale} />}
              </section>
            )}

            {view.dates.length > 1 && (
              <section className="section" aria-labelledby="versus-title">
                <h2 className="section-title" id="versus-title">
                  Does Qloo change the answer?
                </h2>
                <p className="section-sub">{discover ? "The best three nights by each method, with their ranks among all the nights searched." : "The same shows, ranked two ways."}</p>
                <Versus dates={versusSet(view.dates)} artist={artist} />
              </section>
            )}

            {selectedDate && (
              <section className="section" aria-labelledby="shows-title">
                <h2 className="section-title" id="shows-title">
                  What&apos;s pulling on {fmtDay(selectedDate.date)}.
                </h2>
                <p className="section-sub">Each show&apos;s share of the score, strongest first.</p>
                <ShowList
                  key={selectedDate.date}
                  date={selectedDate}
                  dates={view.dates}
                  events={result.events}
                  resolutions={result.resolutions}
                  ignored={ignored}
                  onToggle={toggle}
                  artist={artist}
                  taste={tasteRows}
                  onNeedTaste={needTaste}
                />
              </section>
            )}

            {selectedDate && targetId && (
              <section className="section" aria-labelledby="map-title">
                <h2 className="section-title" id="map-title">
                  Where {artist}&apos;s audience lives.
                </h2>
                <p className="section-sub">Qloo&apos;s heatmap of {result.market.label}, with the venues pulling most on {fmtDay(selectedDate.date)}. Context only; it doesn&apos;t change any score.</p>
                <FanMap
                  mode={result.mode}
                  targetId={targetId}
                  artist={artist}
                  marketId={result.market.id}
                  marketLabel={result.market.label}
                  radiusMiles={result.request.radiusMiles}
                  date={selectedDate}
                  events={result.events}
                />
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
          <p>Tidate estimates potential competition for an audience. It doesn&apos;t measure ticket sales or shared buyers.</p>
        </div>
      </footer>

      <AgentSheet open={askOpen} onClose={() => setAskOpen(false)} mode={mode} available={!!status?.agent} current={result} onAnalysis={loadResult} />
    </>
  );
}
