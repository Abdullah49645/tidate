"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { MARKETS } from "@/lib/markets";
import type { PipelineOutcome, ProgressEvent } from "@/lib/pipeline";
import { planRun, type CityNights, type RunPlan } from "@/lib/tour";
import { NIGHTS, candidateNights, type AnalysisResult, type ArtistCandidate, type NightsId } from "@/lib/types";
import { rangeProblem } from "./CommandBar";
import { PageNav } from "./PageNav";
import { analysisLink } from "./ShareLink";
import { fmt2, fmtDay, fmtShort } from "./format";
import { Alert, Check } from "./icons";

const MAX_CITIES = 4;

function isoIn(days: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

type CityState =
  | { phase: "waiting" }
  | { phase: "running"; detail: string }
  | { phase: "done"; result: AnalysisResult }
  | { phase: "failed"; message: string };

/** Runs one night search over the streaming analyze endpoint. */
async function nightSearch(body: unknown, onProgress: (e: ProgressEvent) => void): Promise<PipelineOutcome> {
  const res = await fetch("/api/analyze", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok || !res.body) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error ?? `The server returned ${res.status}.`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let outcome: PipelineOutcome | null = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg.type === "progress") onProgress(msg.event);
      else if (msg.type === "outcome") outcome = msg.outcome;
      else if (msg.type === "fatal") throw new Error(msg.message);
    }
  }
  if (!outcome) throw new Error("The search ended without a result.");
  return outcome;
}

/** Why a city didn't get its own best night: the stop that sits too close to it. */
function blockedBy(plan: RunPlan, r: AnalysisResult, gap: number, skipped: Set<string>) {
  const best = [...r.dates].filter((d) => !skipped.has(d.date)).sort((a, b) => a.rank - b.rank)[0]?.date;
  if (!best) return null;
  const other = plan.stops.find((s) => s.marketId !== r.market.id && Math.abs(Date.parse(s.date) - Date.parse(best)) / 86_400_000 < Math.max(1, gap));
  return other ? { best, other } : null;
}

export function TourPlanner() {
  const [live, setLive] = useState<boolean | null>(null);
  const [artist, setArtist] = useState("");
  const [entity, setEntity] = useState<ArtistCandidate | null>(null);
  const [choices, setChoices] = useState<ArtistCandidate[] | null>(null);
  const [cities, setCities] = useState<string[]>(["nashville", "atlanta", "chicago"]);
  // Dates are set after mount: the page is prerendered, so "today" isn't known at build time.
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [nights, setNights] = useState<NightsId>("fri-sat");
  const [gap, setGap] = useState(2);
  const [states, setStates] = useState<Record<string, CityState>>({});
  const [running, setRunning] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  /** Nights left out of the plan (a holiday, a date the artist can't do). Re-plans instantly. */
  const [skipped, setSkipped] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch("/api/status")
      .then((r) => r.json())
      .then((s) => {
        setLive(!!s.liveAvailable);
        setFrom((f) => f || isoIn(21));
        setTo((t) => t || isoIn(62));
      })
      .catch(() => {
        setLive(false);
        setFrom((f) => f || isoIn(21));
        setTo((t) => t || isoIn(62));
      });
  }, []);

  const rangeErr = rangeProblem({ from, to, nights });
  const count = rangeErr ? 0 : candidateNights(from, to, nights).length;
  const canRun = !running && artist.trim().length > 0 && cities.length >= 2 && !rangeErr && live === true;

  const toggleCity = (id: string) =>
    setCities((c) => (c.includes(id) ? c.filter((x) => x !== id) : c.length >= MAX_CITIES ? c : [...c, id]));

  async function start(chosen?: ArtistCandidate) {
    setProblem(null);
    setChoices(null);
    let target = chosen ?? (entity && entity.name.toLowerCase() === artist.trim().toLowerCase() ? entity : null);
    if (!target) {
      try {
        const res = await fetch(`/api/artists?mode=live&q=${encodeURIComponent(artist.trim())}`);
        const j = await res.json();
        if (!res.ok) return setProblem(j.error ?? "Couldn't look the artist up in Qloo.");
        if (j.status === "exact") target = j.candidates.find((c: ArtistCandidate) => c.entityId === j.entityId) ?? null;
        else if (j.candidates?.length) return setChoices(j.candidates);
        else return setProblem(`Qloo has no artist matching "${artist.trim()}".`);
      } catch {
        return setProblem("Couldn't reach the server.");
      }
    }
    if (!target) return setProblem("Couldn't resolve the artist.");
    setEntity(target);
    setArtist(target.name);
    setRunning(true);
    setSkipped(new Set());
    const init: Record<string, CityState> = Object.fromEntries(cities.map((c) => [c, { phase: "waiting" } as CityState]));
    setStates(init);
    // One city at a time: each search already uses Qloo at close to its rate limit.
    for (const id of cities) {
      setStates((s) => ({ ...s, [id]: { phase: "running", detail: "Starting" } }));
      try {
        const outcome = await nightSearch(
          { mode: "live", kind: "discover", request: { artist: target.name, artistEntityId: target.entityId, marketId: id, from, to, nights, radiusMiles: 30 } },
          (e) => {
            if (e.status === "running" || e.status === "done") setStates((s) => ({ ...s, [id]: { phase: "running", detail: e.detail ?? e.step } }));
          },
        );
        if (outcome.kind === "result") setStates((s) => ({ ...s, [id]: { phase: "done", result: outcome.result } }));
        else setStates((s) => ({ ...s, [id]: { phase: "failed", message: outcome.message } }));
      } catch (err) {
        setStates((s) => ({ ...s, [id]: { phase: "failed", message: err instanceof Error ? err.message : "Search failed" } }));
      }
    }
    setRunning(false);
  }

  const done = cities.map((c) => states[c]).filter((s): s is Extract<CityState, { phase: "done" }> => s?.phase === "done").map((s) => s.result);
  const allDone = cities.length > 0 && cities.every((c) => states[c]?.phase === "done" || states[c]?.phase === "failed") && done.length >= 2;
  const input: CityNights[] = done.map((r) => ({
    marketId: r.market.id,
    label: r.market.label,
    nights: r.dates.filter((d) => !skipped.has(d.date)).map((d) => ({ date: d.date, score: d.score, rank: d.rank, baselineRank: d.baselineRank })),
  }));
  const plan = allDone ? planRun(input, gap) : null;
  const headcount = allDone ? planRun(input, gap, "baselineRank") : null;
  const differs = !!plan && !!headcount && plan.stops.some((s) => headcount.stops.find((h) => h.marketId === s.marketId)?.date !== s.date);
  const byMarket = new Map(done.map((r) => [r.market.id, r]));

  return (
    <>
      <PageNav />
      <main className="page tour">
        <section className="watch-head plain">
          <div className="watch-text">
            <p className="eyebrow">Plan a run</p>
            <h1>One night per city, none of them crowded.</h1>
            <p className="lede">
              Tidate searches every night in each city, then picks one per city so no two shows are too close together and the run as a whole carries the least pull on your fans.
            </p>
          </div>
        </section>

        {live === false && (
          <div className="alert info" role="alert">
            <span className="icon">
              <Alert size={20} />
            </span>
            <div>
              <p>
                <strong>Run planning needs live data.</strong>
              </p>
              <p>The demo calendar has only one fictional city. Add Qloo and Ticketmaster keys on the server to plan a run.</p>
            </div>
          </div>
        )}

        <form
          className="tour-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (canRun) void start();
          }}
        >
          <label className="tour-field">
            <span>Artist</span>
            <input
              className="cmd-input"
              value={artist}
              placeholder="Kirk Franklin"
              autoComplete="off"
              onChange={(e) => {
                setArtist(e.target.value);
                setChoices(null);
              }}
            />
          </label>
          {choices && (
            <div className="tour-choices" role="group" aria-label="Choose the artist">
              <span>More than one artist has that name:</span>
              {choices.map((c) => (
                <button key={c.entityId} type="button" className="btn-plain" onClick={() => void start(c)}>
                  {c.name}
                  {c.disambiguation ? ` (${c.disambiguation})` : ""}
                </button>
              ))}
            </div>
          )}
          <fieldset className="tour-field">
            <legend>
              Cities <small>{cities.length} of up to {MAX_CITIES}</small>
            </legend>
            <div className="city-grid">
              {MARKETS.map((m) => (
                <button key={m.id} type="button" className="city" aria-pressed={cities.includes(m.id)} onClick={() => toggleCity(m.id)} disabled={running}>
                  {cities.includes(m.id) && <Check size={11} />}
                  {m.label.replace(/,.*$/, "")}
                </button>
              ))}
            </div>
          </fieldset>
          <div className="tour-row">
            <label className="tour-field">
              <span>From</span>
              <input type="date" className="cmd-input" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} />
            </label>
            <label className="tour-field">
              <span>To</span>
              <input type="date" className="cmd-input" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} />
            </label>
            <label className="tour-field">
              <span>Nights</span>
              <select className="cmd-select" value={nights} onChange={(e) => setNights(e.target.value as NightsId)}>
                {(Object.keys(NIGHTS) as NightsId[]).map((k) => (
                  <option key={k} value={k}>
                    {NIGHTS[k].label}
                  </option>
                ))}
              </select>
            </label>
            <label className="tour-field">
              <span>Days between shows</span>
              <select className="cmd-select" value={gap} onChange={(e) => setGap(Number(e.target.value))}>
                {[1, 2, 3, 4, 7].map((g) => (
                  <option key={g} value={g}>
                    At least {g}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="tour-submit">
            <button type="submit" className={`btn-primary${running ? " working" : ""}`} disabled={!canRun}>
              {running ? "Planning…" : "Plan the run"}
            </button>
            <span className={rangeErr ? "err" : undefined}>
              {rangeErr ?? (cities.length < 2 ? "Pick at least two cities" : `${count} nights in each of ${cities.length} cities. About a minute per city the first time.`)}
            </span>
          </div>
          {problem && <p className="tour-problem">{problem}</p>}
        </form>

        {Object.keys(states).length > 0 && (
          <ol className="tour-progress" aria-live="polite">
            {cities.map((id) => {
              const st = states[id];
              const label = MARKETS.find((m) => m.id === id)?.label ?? id;
              if (!st) return null;
              return (
                <li key={id} data-phase={st.phase}>
                  <b>{label}</b>
                  <span>
                    {st.phase === "waiting"
                      ? "Waiting"
                      : st.phase === "running"
                        ? st.detail
                        : st.phase === "failed"
                          ? st.message
                          : `Best night ${fmtDay([...st.result.dates].sort((a, b) => a.rank - b.rank)[0].date)}`}
                  </span>
                </li>
              );
            })}
          </ol>
        )}

        {allDone && !plan && skipped.size > 0 && (
          <p className="tour-problem">
            With those nights skipped nothing fits. <button type="button" className="btn-plain" onClick={() => setSkipped(new Set())}>Bring them back</button>
          </p>
        )}
        {allDone && !plan && skipped.size === 0 && <p className="tour-problem">No way to fit one night per city with at least {gap} days between shows in this range. Widen the range or shorten the gap.</p>}

        {plan && (
          <section className="section" aria-labelledby="run-title">
            <h2 className="section-title" id="run-title">
              {artist}&apos;s run.
            </h2>
            <p className="section-sub">
              {plan.allBest
                ? "Every city gets its own best night."
                : "Each city's night, ranked among that city's nights. Where a city's best night is taken, the reason is shown."}
            </p>
            <ol className="itinerary">
              {plan.stops.map((s, i) => {
                const r = byMarket.get(s.marketId)!;
                const blocked = s.rank > 1 ? blockedBy(plan, r, gap, skipped) : null;
                const quiet = r.diagnostics.some((x) => x.code === "quiet-market-night" && x.message.startsWith(s.date));
                return (
                  <li key={s.marketId} style={{ ["--i" as string]: i }}>
                    <div className="it-date">
                      <span>{fmtDay(s.date).split(",")[0]}</span>
                      <b>{fmtShort(s.date)}</b>
                    </div>
                    <div className="it-city">
                      <b>{s.label}</b>
                      <span>
                        {s.rank === 1 ? `The best of ${r.dates.length} nights there` : `Ranked ${s.rank} of ${r.dates.length} there`}, clash score {fmt2(s.score)}
                      </span>
                      {blocked && (
                        <small>
                          Its best night, {fmtShort(blocked.best)},{" "}
                          {blocked.other.date === blocked.best
                            ? `is the night ${blocked.other.label.replace(/,.*$/, "")} gets.`
                            : `is less than ${gap} ${gap === 1 ? "day" : "days"} from ${blocked.other.label.replace(/,.*$/, "")} on ${fmtShort(blocked.other.date)}.`}
                        </small>
                      )}
                      {quiet && <small>Quiet for every act in {s.label.replace(/,.*$/, "")}; check it isn&apos;t a holiday.</small>}
                    </div>
                    <div className="it-actions">
                      <button type="button" className="btn-plain" onClick={() => setSkipped((x) => new Set(x).add(s.date))}>
                        Skip {fmtShort(s.date)}
                      </button>
                      <a className="btn-plain" href={analysisLink(r, "")}>
                        Open in full
                      </a>
                    </div>
                  </li>
                );
              })}
            </ol>
            {skipped.size > 0 && (
              <div className="whatif-bar" role="status">
                <span>
                  Skipping {[...skipped].sort().map(fmtShort).join(", ")} in every city.
                </span>
                <button type="button" className="btn-plain" onClick={() => setSkipped(new Set())}>
                  Reset
                </button>
              </div>
            )}
            {headcount && (
              <p className={`versus-note${differs ? "" : " agrees"}`}>
                {differs ? (
                  <>
                    <strong>A headcount would route it differently:</strong>{" "}
                    {headcount.stops.map((h) => `${h.label.replace(/,.*$/, "")} ${fmtShort(h.date)}`).join(", ")}. Qloo moves the run away from nights where acts close to {artist}&apos;s audience play.
                  </>
                ) : (
                  <>
                    <strong>A headcount picks the same run.</strong> Here Qloo confirms it rather than changing it.
                  </>
                )}
              </p>
            )}
            <p className="openers-foot">
              Cities are compared by rank, not raw score: each city&apos;s acts are ranked against a different pool, so scores aren&apos;t comparable across cities. Travel and
              routing costs aren&apos;t considered. <Link href="/">Back to a single city</Link>
            </p>
          </section>
        )}
      </main>
    </>
  );
}
