"use client";

import { useEffect, useState } from "react";
import type { RecommendedArtist } from "@/lib/qloo/client";
import type { DateScore, SharedTaste } from "@/lib/types";
import { fmt2, fmtDay } from "./format";

const SHOW = 6;

/**
 * Support-act ideas: the artists Qloo places closest to the headliner's audience
 * around this market, leaving out anyone already playing nearby around the
 * chosen night (they compete for the same fans). Display only.
 */
export function Openers({
  mode,
  targetId,
  artist,
  targetPopularity,
  marketId,
  marketLabel,
  date,
  taste,
  onNeedTaste,
}: {
  mode: "live" | "demo";
  targetId: string;
  artist: string;
  targetPopularity: number | null;
  marketId: string;
  marketLabel: string;
  date: DateScore;
  taste: Record<string, SharedTaste>;
  onNeedTaste: (ids: string[]) => void;
}) {
  const key = `${mode}|${targetId}|${marketId}`;
  const [data, setData] = useState<{ key: string; artists: RecommendedArtist[] } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/openers?mode=${mode}&target=${encodeURIComponent(targetId)}&market=${marketId}`)
      .then(async (r) => {
        const j = await r.json();
        if (!live) return;
        if (r.ok) setData({ key, artists: j.artists });
        else setFailed(key);
      })
      .catch(() => live && setFailed(key));
    return () => {
      live = false;
    };
  }, [key, mode, targetId, marketId]);

  const all = data?.key === key ? data.artists : null;
  const nearby = new Map(date.contributions.filter((c) => c.qlooEntityId).map((c) => [c.qlooEntityId!, c.performer ?? c.eventName]));
  const free = (all ?? []).filter((a) => !nearby.has(a.entityId));
  const busy = (all ?? []).filter((a) => nearby.has(a.entityId)).slice(0, 4);
  const rank = (a: RecommendedArtist) => (targetPopularity !== null && a.popularity !== null && a.popularity > targetPopularity + 0.02 ? 1 : 0);
  const picks = [...free].sort((a, b) => rank(a) - rank(b)).slice(0, SHOW);
  const ids = picks.map((p) => p.entityId).join(",");

  useEffect(() => {
    if (ids) onNeedTaste(ids.split(","));
  }, [ids, onNeedTaste]);

  if (failed === key) return <p className="fanmap-empty">Qloo didn&apos;t return recommendations for {artist} here.</p>;
  if (!all) return <p className="fanmap-empty">Asking Qloo which audiences sit closest to {artist}&apos;s…</p>;
  if (!picks.length) return <p className="fanmap-empty">Every close match Qloo suggests is already playing near {marketLabel} around {fmtDay(date.date)}.</p>;

  return (
    <>
      <ol className="openers">
        {picks.map((a, i) => {
          const t = taste[a.entityId];
          const shared = t?.checked && t.shared.length ? t.shared.slice(0, 3).map((x) => x.name) : null;
          return (
            <li key={a.entityId} style={{ ["--i" as string]: i }}>
              <b>{a.name}</b>
              <span>
                Popularity {fmt2(a.popularity)}
                {targetPopularity !== null ? ` (${artist}: ${fmt2(targetPopularity)})` : ""}
              </span>
              {shared ? <small>Shares {shared.join(", ")}</small> : t?.checked ? <small>No genre in common; the overlap is in listeners</small> : <small>&nbsp;</small>}
            </li>
          );
        })}
      </ol>
      <p className="openers-foot">
        {busy.length > 0 && (
          <>
            Left out because they already play nearby around {fmtDay(date.date)}: {busy.map((a) => a.name).join(", ")}.{" "}
          </>
        )}
        Qloo can say whose fans overlap, not who is touring or free, so treat these as names to ask about.
      </p>
    </>
  );
}
