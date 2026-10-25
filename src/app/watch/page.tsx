"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { PageNav } from "@/components/PageNav";
import { loadLocalWatches } from "@/components/watchlist";

function subscribe(cb: () => void) {
  window.addEventListener("tidate-watches", cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener("tidate-watches", cb);
    window.removeEventListener("storage", cb);
  };
}

export default function WatchListPage() {
  const raw = useSyncExternalStore(
    subscribe,
    () => JSON.stringify(loadLocalWatches()),
    () => "[]",
  );
  const watches = JSON.parse(raw) as ReturnType<typeof loadLocalWatches>;
  return (
    <>
      <PageNav />
      <main className="page watch">
        <section className="watch-head plain">
          <div className="watch-text">
            <p className="eyebrow">Watching</p>
            <h1>Your watches</h1>
            <p className="lede">Watches started in this browser. Each one is re-checked daily; anyone with a watch&apos;s link can open it.</p>
          </div>
        </section>
        {watches.length === 0 ? (
          <p className="watch-empty">
            Nothing watched yet. Run an analysis, then choose &ldquo;Watch these dates for changes&rdquo;. <Link href="/">Start an analysis</Link>
          </p>
        ) : (
          <ul className="watch-list">
            {watches.map((w) => (
              <li key={w.id}>
                <Link href={`/watch/${w.id}`}>
                  <b>{w.artist}</b>
                  <span>{w.market}</span>
                  <small>Started {new Date(w.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</small>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
