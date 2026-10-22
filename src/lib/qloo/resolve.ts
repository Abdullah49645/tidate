import { normaliseName } from "../scoring/engine";
import type { ArtistCandidate, ArtistResolution, MatchStatus, Provenance } from "../types";

/**
 * Entity-resolution policy (documented in docs/METHODOLOGY.md):
 *
 *  exact      exactly one candidate whose normalised name equals the input, OR
 *             several same-name candidates where the most popular leads the next
 *             by at least DOMINANCE_GAP popularity points (clear namesake case)
 *  ambiguous  several same-name candidates without a clear leader
 *  weak       candidates exist but none has the same normalised name
 *  not-found  no artist candidates
 *
 * Only `exact` (and user-`confirmed`) matches are used in scoring.
 */
export const DOMINANCE_GAP = 0.25;

export function classifyMatch(inputName: string, candidates: ArtistCandidate[]): { status: MatchStatus; entity: ArtistCandidate | null; note?: string } {
  if (candidates.length === 0) return { status: "not-found", entity: null };
  const target = normaliseName(inputName);
  const same = candidates.filter((c) => normaliseName(c.name) === target);
  if (same.length === 0) {
    return { status: "weak", entity: null, note: `Closest Qloo result was "${candidates[0].name}", which does not match the name exactly.` };
  }
  if (same.length === 1) return { status: "exact", entity: same[0] };
  const ranked = [...same].sort((a, b) => (b.popularity ?? -1) - (a.popularity ?? -1));
  const [first, second] = ranked;
  if (first.popularity !== null && (second.popularity ?? 0) + DOMINANCE_GAP <= first.popularity) {
    return {
      status: "exact",
      entity: first,
      note: `${same.length} Qloo artists share this name; using the clearly most popular one.`,
    };
  }
  return { status: "ambiguous", entity: null, note: `${same.length} Qloo artists share this name with no clear leader.` };
}

export async function resolveArtist(
  search: (name: string) => Promise<ArtistCandidate[]>,
  inputName: string,
): Promise<ArtistResolution> {
  const provenance: Provenance = {
    source: "qloo",
    retrievedAt: new Date().toISOString(),
    request: `GET /search types=urn:entity:artist query="${inputName}"`,
  };
  try {
    const candidates = await search(inputName);
    const m = classifyMatch(inputName, candidates);
    return { inputName, status: m.status, entity: m.entity, candidates: candidates.slice(0, 5), provenance, note: m.note };
  } catch (err) {
    return {
      inputName,
      status: "error",
      entity: null,
      candidates: [],
      provenance,
      note: err instanceof Error ? err.message : "Qloo search failed",
    };
  }
}
