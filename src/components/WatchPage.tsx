"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { NIGHTS } from "@/lib/types";
import type { HistoryEntry, WatchView } from "@/lib/watch/service";
import { CalendarTile } from "./CalendarTile";
import { PageNav } from "./PageNav";
import { fmt2, fmtDay, fmtLong, fmtShort, humanizeDates } from "./format";
import { Alert } from "./icons";
import { forgetLocalWatch, saveLocalWatch } from "./watchlist";

const ROBUST: Record<string, string> = {
  "worst-case": "Holds even in the worst case",
  typical: "Holds unless unmatched acts are unusually close",
  sensitive: "Could change with unmatched acts",
  "n/a": "One date, nothing to rank",
};

const TRIGGER: Record<HistoryEntry["trigger"], string> = { created: "Started watching", manual: "Checked now", schedule: "Daily check" };

export function fmtWhen(iso: string, now = Date.now()) {
  const s = Math.round((now - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Link that opens the full analysis for a watch in the main app. */
export function analysisHref(w: WatchView) {
  const r = w.spec.request;
  const q = new URLSearchParams({ mode: w.spec.mode, artist: r.artist, market: r.marketId, radius: String(r.radiusMiles) });
  if (r.artistEntityId) q.set("entity", r.artistEntityId);
  if (w.spec.kind === "discover") {
    q.set("from", w.spec.request.from);
    q.set("to", w.spec.request.to);
    q.set("nights", w.spec.request.nights);
  } else q.set("dates", w.spec.request.candidateDates.join(","));
  return `/?${q}`;
}

function title(w: WatchView) {
  if (w.spec.kind === "discover") return `${NIGHTS[w.spec.request.nights].plural}, ${fmtShort(w.spec.request.from)} to ${fmtShort(w.spec.request.to)}`;
  return w.spec.request.candidateDates.map(fmtShort).join(", ");
}

export function WatchPage({ id }: { id: string }) {
  const router = useRouter();
  const [w, setW] = useState<WatchView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"check" | "stop" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/watch/${encodeURIComponent(id)}`, { cache: "no-store" })
      .then(async (res) => {
        const j = await res.json();
        if (!live) return;
        if (!res.ok) {
          if (res.status === 404) forgetLocalWatch(id);
          setError(j.error ?? "This watch couldn't be loaded.");
          return;
        }
        setW(j);
        saveLocalWatch({ id: j.id, artist: j.artist, market: j.market.label, createdAt: j.createdAt });
      })
      .catch(() => live && setError("Couldn't reach the server."));
    return () => {
      live = false;
    };
  }, [id]);

  async function checkNow() {
    setBusy("check");
    setNotice(null);
    try {
      const res = await fetch(`/api/watch/${encodeURIComponent(id)}/check`, { method: "POST" });
      const j = await res.json();
      if (!res.ok) setNotice(j.error ?? "The check didn't complete.");
      else setW(j);
    } catch {
      setNotice("Couldn't reach the server.");
    } finally {
      setBusy(null);
    }
  }

  async function stop() {
    setBusy("stop");
    try {
      const res = await fetch(`/api/watch/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (res.ok || res.status === 404) {
        forgetLocalWatch(id);
        router.push("/watch");
        return;
      }
      setNotice("The watch couldn't be removed.");
    } catch {
      setNotice("Couldn't reach the server.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageNav />
      {w?.spec.mode === "demo" && (
        <div className="ribbon" role="note">
          <strong>Demo data.</strong> After the first check the fictional calendar announces one show and cancels another, to show what an alert looks like.
        </div>
      )}
      <main className="page watch">
        {error && (
          <div className="alert" role="alert">
            <span className="icon">
              <Alert size={20} />
            </span>
            <div>
              <p>
                <strong>{error}</strong>
              </p>
              <p>
                <Link href="/watch">Your watches</Link>
              </p>
            </div>
          </div>
        )}
        {!w && !error && <p className="watch-loading">Loading the watch…</p>}
        {w && (
          <>
            <section className="watch-head">
              {w.current.recommendedDate && w.current.dates.length > 1 && (
                <CalendarTile iso={w.current.recommendedDate} year={new Date(`${w.current.recommendedDate}T00:00:00Z`).getUTCFullYear() !== new Date().getUTCFullYear()} />
              )}
              <div className="watch-text">
                <p className="eyebrow">
                  {w.status === "ended" ? "Watch ended" : "Watching"} in {w.market.label}
                </p>
                <h1>
                  {w.artist}
                  <span>{title(w)}</span>
                </h1>
                <dl className="ledger">
                  {w.current.dates.length > 1 && (
                    <div>
                      <dt>Best night now</dt>
                      <dd>{w.current.recommendedDate ? fmtLong(w.current.recommendedDate) : "None"}</dd>
                    </div>
                  )}
                  {w.current.dates.length > 1 && (
                    <div>
                      <dt>Robustness</dt>
                      <dd>
                        <i className={`dot ${w.current.robustness === "sensitive" ? "warn" : "good"}`} aria-hidden />
                        {ROBUST[w.current.robustness]}
                      </dd>
                    </div>
                  )}
                  <div>
                    <dt>Last checked</dt>
                    <dd>
                      {fmtWhen(w.lastCheckedAt)}
                      {w.status === "active" && <span className="muted">. Re-checked once a day</span>}
                    </dd>
                  </div>
                  <div>
                    <dt>Coverage</dt>
                    <dd>
                      {w.current.matched} of {w.current.performers} acts matched in Qloo
                    </dd>
                  </div>
                </dl>
                <div className="watch-actions">
                  {w.status === "active" && (
                    <button type="button" className={`btn-primary${busy === "check" ? " working" : ""}`} onClick={checkNow} disabled={!!busy}>
                      {busy === "check" ? "Checking…" : "Check now"}
                    </button>
                  )}
                  <a className="btn-plain" href={analysisHref(w)}>
                    Open the full analysis
                  </a>
                  <button type="button" className="btn-plain danger" onClick={stop} disabled={!!busy}>
                    {busy === "stop" ? "Stopping…" : "Stop watching"}
                  </button>
                </div>
                {notice && (
                  <p className="watch-notice" role="status">
                    {notice}
                  </p>
                )}
                {w.storage === "memory" && (
                  <p className="watch-notice">This server has no database configured, so the watch lives in memory and is lost on restart. Add Upstash Redis to keep it.</p>
                )}
              </div>
            </section>

            {w.current.dates.length > 1 && w.current.dates.length <= 8 && (
              <section className="section" aria-labelledby="watch-dates">
                <h2 className="section-title" id="watch-dates">
                  Where the dates stand.
                </h2>
                <ol className="watch-dates">
                  {[...w.current.dates]
                    .sort((a, b) => a.rank - b.rank)
                    .map((d) => (
                      <li key={d.date} className={d.date === w.current.recommendedDate ? "best" : undefined}>
                        <span className="n">{d.rank}</span>
                        <span className="d">{fmtDay(d.date)}</span>
                        <span className="s">clash score {fmt2(d.score)}</span>
                        <span className="c">
                          {d.inWindow} shows nearby, {d.scored} scored
                        </span>
                      </li>
                    ))}
                </ol>
              </section>
            )}

            <section className="section" aria-labelledby="watch-history">
              <h2 className="section-title" id="watch-history">
                What changed.
              </h2>
              <p className="section-sub">Every check compares Ticketmaster&apos;s listings and the scores with the one before.</p>
              <ol className="history">
                {w.history.map((h) => (
                  <li key={h.at} className={h.notable ? "notable" : undefined}>
                    <div className="when">
                      <b>{TRIGGER[h.trigger]}</b>
                      <time dateTime={h.at}>{fmtWhen(h.at)}</time>
                    </div>
                    <div className="what">
                      {h.note && <p className="note">{humanizeDates(h.note.text)}</p>}
                      <ul>
                        {h.lines.map((l, i) => (
                          <li key={i}>{humanizeDates(l)}</li>
                        ))}
                      </ul>
                      {h.note && <small>Summary written by {h.note.model ?? "the configured model"} from the changes listed, and checked against them.</small>}
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          </>
        )}
      </main>
    </>
  );
}

/** Reads the id from the URL (rendered inside Suspense by the route). */
export function WatchRoute() {
  const { id } = useParams<{ id: string }>();
  return <WatchPage id={id} />;
}
