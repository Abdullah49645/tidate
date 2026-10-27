"use client";

import { useEffect, useMemo, useState } from "react";
import { affinityNear, rankVenues } from "@/lib/context";
import type { CompetingEvent, DateScore, HeatCell } from "@/lib/types";
import { fmtShort } from "./format";

interface MapData {
  key: string;
  cells: HeatCell[];
  center: { lat: number; lng: number };
  radiusMiles: number;
  source: string;
}

const W = 640;
const KM_PER_LAT = 110.57;

function topShare(a: number) {
  return a >= 0.5 ? `top ${Math.max(1, Math.round((1 - a) * 100))}%` : `bottom ${Math.max(1, Math.round(a * 100))}%`;
}

/**
 * Qloo's heatmap of where the artist's audience is relatively concentrated
 * around the market, with the venues of the shows pulling most on the chosen
 * night pinned on top. Context only: the map never changes a score.
 */
export function FanMap({
  mode,
  targetId,
  artist,
  marketId,
  marketLabel,
  radiusMiles,
  date,
  events,
}: {
  mode: "live" | "demo";
  targetId: string;
  artist: string;
  marketId: string;
  marketLabel: string;
  radiusMiles: number;
  date: DateScore;
  events: CompetingEvent[];
}) {
  const key = `${mode}|${targetId}|${marketId}|${radiusMiles}`;
  const [data, setData] = useState<MapData | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/fanmap?mode=${mode}&target=${encodeURIComponent(targetId)}&market=${marketId}&radius=${radiusMiles}`)
      .then(async (r) => {
        const j = await r.json();
        if (!live) return;
        if (!r.ok) setFailed(`${key}|${j.error ?? "unavailable"}`);
        else setData({ key, ...j });
      })
      .catch(() => live && setFailed(`${key}|unreachable`));
    return () => {
      live = false;
    };
  }, [key, mode, targetId, marketId, radiusMiles]);

  const current = data?.key === key ? data : null;
  const error = failed?.startsWith(key) ? failed.slice(key.length + 1) : null;

  const geo = useMemo(() => {
    if (!current || current.cells.length === 0) return null;
    const { lat: lat0, lng: lng0 } = current.center;
    const kx = 111.32 * Math.cos((lat0 * Math.PI) / 180);
    const px = (lng: number) => (lng - lng0) * kx;
    const py = (lat: number) => -(lat - lat0) * KM_PER_LAT;
    // Frame the bulk of the cells (2nd to 98th percentile) plus the pinned venues,
    // so a few outlying cells don't shrink the city to a corner.
    const q = (v: number[], f: number) => [...v].sort((a, b) => a - b)[Math.min(v.length - 1, Math.max(0, Math.round(f * (v.length - 1))))];
    const venueXs = events.filter((e) => e.venue.lng !== null).map((e) => px(e.venue.lng!));
    const venueYs = events.filter((e) => e.venue.lat !== null).map((e) => py(e.venue.lat!));
    const xs = current.cells.map((c) => px(c.lng));
    const ys = current.cells.map((c) => py(c.lat));
    const pad = 3;
    const near = (v: number[], lo: number, hi: number) => v.filter((x) => x >= lo - 8 && x <= hi + 8);
    let minX = Math.min(q(xs, 0.02), ...near(venueXs, q(xs, 0.02), q(xs, 0.98))) - pad;
    let maxX = Math.max(q(xs, 0.98), ...near(venueXs, q(xs, 0.02), q(xs, 0.98))) + pad;
    const minY = Math.min(q(ys, 0.02), ...near(venueYs, q(ys, 0.02), q(ys, 0.98))) - pad;
    const maxY = Math.max(q(ys, 0.98), ...near(venueYs, q(ys, 0.02), q(ys, 0.98))) + pad;
    // Keep the map landscape so it reads at page width: widen a tall extent.
    const minW = (maxY - minY) * 1.35;
    if (maxX - minX < minW) {
      const grow = (minW - (maxX - minX)) / 2;
      minX -= grow;
      maxX += grow;
    }
    const s = W / (maxX - minX);
    const H = Math.round((maxY - minY) * s);
    const X = (lng: number) => (px(lng) - minX) * s;
    const Y = (lat: number) => (py(lat) - minY) * s;
    // geohash-6 cells: about 0.0055 deg of latitude by 0.011 deg of longitude
    const cw = 0.011 * kx * s;
    const ch = 0.0055 * KM_PER_LAT * s;
    return { X, Y, H, s, cw, ch };
  }, [current, events]);

  const pins = useMemo(() => {
    if (!current || !geo) return [];
    const byId = new Map(events.map((e) => [e.eventId, e]));
    const groups = new Map<string, { name: string; lat: number; lng: number; acts: string[]; pull: number; dates: string[] }>();
    for (const c of date.contributions) {
      if (!c.scored || (c.contribution ?? 0) <= 0) continue;
      const e = byId.get(c.eventId);
      if (!e || e.venue.lat === null || e.venue.lng === null) continue;
      const k = e.venue.id ?? e.venue.name;
      const g = groups.get(k) ?? { name: e.venue.name, lat: e.venue.lat, lng: e.venue.lng, acts: [], pull: 0, dates: [] };
      if (!g.acts.includes(c.performer ?? c.eventName)) g.acts.push(c.performer ?? c.eventName);
      g.pull += c.contribution ?? 0;
      g.dates.push(c.eventDate);
      groups.set(k, g);
    }
    return [...groups.values()]
      .sort((a, b) => b.pull - a.pull)
      .slice(0, 5)
      .map((g) => ({ ...g, x: geo.X(g.lng), y: geo.Y(g.lat), local: affinityNear(current.cells, g.lat, g.lng) }))
      .filter((g) => g.x >= 0 && g.x <= W && g.y >= 0 && g.y <= geo.H);
  }, [current, geo, date, events]);

  const picks = useMemo(() => {
    if (!current || !geo) return [];
    return rankVenues(events, date, current.cells).map((v, i) => ({ ...v, letter: String.fromCharCode(65 + i), x: geo.X(v.lng), y: geo.Y(v.lat) }));
  }, [current, geo, date, events]);

  if (error) {
    return <p className="fanmap-empty">Qloo didn&apos;t return a heatmap for {artist} around {marketLabel}, so there&apos;s no map to show. The scores above don&apos;t depend on it.</p>;
  }
  if (!current) {
    return (
      <div className="fanmap loading" aria-busy>
        <p>Loading Qloo&apos;s heatmap for {artist}…</p>
      </div>
    );
  }
  if (!geo) {
    return <p className="fanmap-empty">Qloo has no heatmap cells for {artist} around {marketLabel}.</p>;
  }

  const mile = 1.609344 * geo.s;
  const scaleMiles = geo.s * 1.609344 * 5 > W / 4 ? 2 : 5;

  return (
    <>
      <div className="fanmap" style={{ aspectRatio: `${W} / ${geo.H}` }}>
        <svg viewBox={`0 0 ${W} ${geo.H}`} role="img" aria-label={`Heatmap of ${artist}'s audience around ${marketLabel}, with ${pins.length} venues pinned`}>
          <defs>
            <filter id="fan-soft" x="-10%" y="-10%" width="120%" height="120%">
              <feGaussianBlur stdDeviation={Math.max(3, geo.cw * 0.9)} />
            </filter>
          </defs>
          <g className="grain">
            {current.cells.map((c) => (
              <circle key={c.geohash} cx={geo.X(c.lng)} cy={geo.Y(c.lat)} r={1.1} />
            ))}
          </g>
          <g className="heat" filter="url(#fan-soft)">
            {current.cells
              .filter((c) => c.affinity >= 0.35)
              .map((c) => (
                <circle key={c.geohash} cx={geo.X(c.lng)} cy={geo.Y(c.lat)} r={Math.max(4, geo.cw * 1.25)} style={{ opacity: (((c.affinity - 0.35) / 0.65) ** 1.6 * 0.75).toFixed(3) }} />
              ))}
          </g>
          <g className="centre" transform={`translate(${geo.X(current.center.lng)} ${geo.Y(current.center.lat)})`}>
            <path d="M -5 0 H 5 M 0 -5 V 5" />
          </g>
          <g className="scale" transform={`translate(16 ${geo.H - 16})`}>
            <path d={`M 0 0 H ${mile * scaleMiles}`} />
            <path d={`M 0 -4 V 0 M ${mile * scaleMiles} -4 V 0`} />
          </g>
        </svg>
        {picks
          .filter((p) => p.x >= 0 && p.x <= W && p.y >= 0 && p.y <= geo.H)
          .map((p, i) => (
            <span key={p.key} className="pin pick" aria-hidden style={{ left: `${(p.x / W) * 100}%`, top: `${(p.y / geo.H) * 100}%`, ["--i" as string]: i + 6 }}>
              {p.letter}
            </span>
          ))}
        {pins
          .map((p, i) => ({ ...p, n: i + 1 }))
          .reverse()
          .map((p) => (
            <span key={p.name} className="pin" aria-hidden style={{ left: `${(p.x / W) * 100}%`, top: `${(p.y / geo.H) * 100}%`, ["--i" as string]: p.n }}>
              {p.n}
            </span>
          ))}
        <span className="scale-label" style={{ left: 16, bottom: 22 }}>
          {scaleMiles} mi
        </span>
      </div>
      <div className="fanmap-foot">
        <div className="nights-legend" aria-hidden>
          <span className="ramp">
            <span>{artist}&apos;s audience, relatively</span>
            <span>sparse</span>
            <i />
            <span>concentrated</span>
          </span>
          <span className="key-pin">
            <i>1</i> Venues pulling most on {fmtShort(date.date)}
          </span>
          <span className="key-pick">
            <i>A</i> Venues in {artist}&apos;s strongest areas
          </span>
          <span className="key-centre">
            <i>+</i> City centre
          </span>
        </div>
        {pins.length > 0 && (
          <ul className="fanmap-venues">
            {pins.map((p, i) => (
              <li key={p.name}>
                <span>
                  <i className="pin-n">{i + 1}</i>
                  <b>{p.name}</b>
                  <span>
                    {p.acts.slice(0, 4).join(", ")}
                    {p.acts.length > 4 ? ` and ${p.acts.length - 4} more` : ""}
                  </span>
                </span>
                <small>{p.local === null ? "Outside Qloo's mapped areas" : `In the ${topShare(p.local)} of mapped areas for ${artist}'s audience`}</small>
              </li>
            ))}
          </ul>
        )}
        {picks.length > 0 && (
          <>
            <h3 className="sub-title">Where to play.</h3>
            <ul className="fanmap-venues picks">
              {picks.map((p) => (
                <li key={p.key}>
                  <span>
                    <i className="pin-n pick">{p.letter}</i>
                    <b>{p.name}</b>
                    <span>
                      {p.bookedBy ? `Booked on ${fmtShort(date.date)} (${p.bookedBy}). ` : ""}
                      {p.showsNearby ? `${p.showsNearby} competing ${p.showsNearby === 1 ? "show" : "shows"} within 1 km around ${fmtShort(date.date)}, pull ${p.pullNearby.toFixed(2)}` : `No scored competition within 1 km around ${fmtShort(date.date)}`}
                    </span>
                  </span>
                  <small>{`In the ${topShare(p.fans)} of mapped areas for ${artist}'s audience`}</small>
                </li>
              ))}
            </ul>
            <p className="openers-foot">
              Venues Ticketmaster lists music at, ranked by how concentrated {artist}&apos;s audience is around them, then by how little competing shows within 1 km pull.
              Venues already booked that night come last. Ticketmaster
              doesn&apos;t publish capacities, so check the room fits the draw.
            </p>
          </>
        )}
      </div>
    </>
  );
}
