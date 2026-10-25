import type { DataProvider } from "./pipeline";
import type { Market } from "./markets";
import { sharedTaste } from "./qloo/taste";
import type { HeatCell, SharedTaste } from "./types";

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
