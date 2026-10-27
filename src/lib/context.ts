import type { DataProvider } from "./pipeline";
import type { Market } from "./markets";
import { sharedTaste } from "./qloo/taste";
import type { CompetingEvent, DateScore, HeatCell, SharedTaste } from "./types";

/**
 * Context shown beside a result: why audiences overlap, and where the target's
 * audience lives. Both are display-only and never change a score.
 */

export const MAX_TASTE_IDS = 40;

export async function tasteOverlap(provider: DataProvider, targetId: string, ids: string[]): Promise<SharedTaste[] | null> {
  if (!provider.entityTags) return null;
  const wanted = [...new Set(ids.filter((id) => id && id !== targetId))].slice(0, MAX_TASTE_IDS);
  const tags = await provider.entityTags([targetId, ...wanted]);
  return wanted.map((id) => sharedTaste(id, tags[targetId], tags[id]));
}

/** Artists whose audiences are closest to the target's around this market (support-act ideas). */
export async function openerIdeas(provider: DataProvider, targetId: string, market: Market) {
  if (!provider.recommendArtists) return null;
  return provider.recommendArtists(targetId, market);
}

export async function fanMap(provider: DataProvider, targetId: string, market: Market, radiusMiles: number): Promise<HeatCell[] | null> {
  if (!provider.fanHeatmap) return null;
  return provider.fanHeatmap(targetId, market, radiusMiles);
}

/**
 * Qloo heatmap affinity at a point: the value of the nearest cell, if one lies
 * within `maxKm`. Heatmap cells are geohash-6 (about 1.2 km by 0.6 km).
 */
export function affinityNear(cells: HeatCell[], lat: number, lng: number, maxKm = 1.5): number | null {
  let best: { d: number; a: number } | null = null;
  const kx = 111.32 * Math.cos((lat * Math.PI) / 180);
  for (const c of cells) {
    const d = Math.hypot((c.lat - lat) * 110.57, (c.lng - lng) * kx);
    if (d <= maxKm && (!best || d < best.d)) best = { d, a: c.affinity };
  }
  return best ? best.a : null;
}

const kmBetween = (aLat: number, aLng: number, bLat: number, bLng: number) =>
  Math.hypot((aLat - bLat) * 110.57, (aLng - bLng) * 111.32 * Math.cos((aLat * Math.PI) / 180));

export interface VenuePick {
  key: string;
  name: string;
  lat: number;
  lng: number;
  /** Heatmap affinity of the nearest cell: how concentrated the artist's audience is around the venue. */
  fans: number;
  /** Clash-score contributions, on the chosen date, from shows within `radiusKm` of the venue. */
  pullNearby: number;
  showsNearby: number;
  /** A listed show at this venue on the chosen night, if any. */
  bookedBy: string | null;
  /** Music events listed at the venue in the analysis window (shows it is a working music room). */
  listed: number;
}

/**
 * Venues from the Ticketmaster listings, ranked by how concentrated the artist's
 * audience is around them (Qloo heatmap), then by how little pull competing
 * shows nearby (within 1 km) have on the chosen date. Venues already booked that
 * night go last. Capacity is not available from
 * Ticketmaster, so size is not considered.
 */
export function rankVenues(events: CompetingEvent[], date: DateScore, cells: HeatCell[], opts: { radiusKm?: number; limit?: number } = {}): VenuePick[] {
  const radiusKm = opts.radiusKm ?? 1;
  const byId = new Map(events.map((e) => [e.eventId, e]));
  const venues = new Map<string, { name: string; lat: number; lng: number; listed: number; bookedBy: string | null }>();
  for (const e of events) {
    if (e.venue.lat === null || e.venue.lng === null) continue;
    // Ticketmaster sometimes lists one room under two venue records; merge by name.
    const key = e.venue.name.toLowerCase().replace(/[^a-z0-9]/g, "");
    const v = venues.get(key) ?? { name: e.venue.name, lat: e.venue.lat, lng: e.venue.lng, listed: 0, bookedBy: null };
    v.listed += 1;
    if (e.localDate === date.date && !v.bookedBy) v.bookedBy = e.performers[0]?.name ?? e.name;
    venues.set(key, v);
  }
  const pulls = date.contributions
    .filter((c) => c.scored && (c.contribution ?? 0) > 0)
    .map((c) => ({ c, e: byId.get(c.eventId) }))
    .filter((x): x is { c: (typeof date.contributions)[number]; e: CompetingEvent } => !!x.e && x.e.venue.lat !== null && x.e.venue.lng !== null);
  const out: VenuePick[] = [];
  for (const [key, v] of venues) {
    const fans = affinityNear(cells, v.lat, v.lng);
    if (fans === null) continue;
    let pullNearby = 0;
    let showsNearby = 0;
    for (const { c, e } of pulls) {
      if (kmBetween(v.lat, v.lng, e.venue.lat!, e.venue.lng!) <= radiusKm) {
        pullNearby += c.contribution ?? 0;
        showsNearby += 1;
      }
    }
    out.push({ key, name: v.name, lat: v.lat, lng: v.lng, fans, pullNearby, showsNearby, bookedBy: v.bookedBy, listed: v.listed });
  }
  // Free that night first, then where fans are most concentrated (in steps of 5
  // percentile points, so near-identical cells don't hide the competition), then least pull.
  const band = (x: number) => Math.round(x * 20);
  return out
    .sort((a, b) => Number(!!a.bookedBy) - Number(!!b.bookedBy) || band(b.fans) - band(a.fans) || a.pullNearby - b.pullNearby || a.name.localeCompare(b.name))
    .slice(0, opts.limit ?? 5);
}
