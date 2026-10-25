import type { SharedTaste, TasteTag } from "../types";

/**
 * Explains an audience overlap with the Qloo tags two artists have in common.
 *
 * Only tags that describe what the music is or where it comes from are compared:
 * genres, subgenres, lineage ("influence") and named influences. Qloo also tags
 * nearly every artist with adjectives such as "Passionate" or "Energetic"; those
 * are left out because sharing them says nothing. This is context for a person
 * reading the result. It never feeds the score.
 */

const GENRE_TYPES = new Set(["urn:tag:genre", "urn:tag:genre:qloo", "urn:tag:subgenre:qloo", "urn:tag:influence:qloo"]);
const INFLUENCE_TYPES = new Set(["urn:tag:influenced_by:qloo"]);

/** Labels too broad to count as a shared taste. */
const STOP = new Set(["american", "unitedstates", "music", "usa"]);
/** Spellings Qloo uses for the same genre. */
const ALIAS: Record<string, string> = { randb: "rhythmandblues", rnb: "rhythmandblues", hiphoprap: "hiphop", rap: "hiphop" };

export function tagKey(name: string): string {
  const k = name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]/g, "");
  return ALIAS[k] ?? k;
}

function kindOf(t: TasteTag): "genre" | "influence" | null {
  if (GENRE_TYPES.has(t.type)) return "genre";
  if (INFLUENCE_TYPES.has(t.type)) return "influence";
  return null;
}

function index(tags: TasteTag[]) {
  const m = new Map<string, { name: string; kind: "genre" | "influence" }>();
  for (const t of tags) {
    const kind = kindOf(t);
    const key = tagKey(t.name);
    if (!kind || !key || STOP.has(key) || m.has(key)) continue;
    m.set(key, { name: t.name, kind });
  }
  return m;
}

/**
 * Tags the other artist shares with the target, genres first, in the target's
 * tag order. `checked` is false when either artist has no comparable tags, so
 * an empty list is only presented as a finding when both were tagged.
 */
export function sharedTaste(entityId: string, target: TasteTag[] | undefined, other: TasteTag[] | undefined, limit = 4): SharedTaste {
  const a = index(target ?? []);
  const b = index(other ?? []);
  const checked = a.size > 0 && b.size > 0;
  const shared = [...a.entries()]
    .filter(([k]) => b.has(k))
    .map(([, v]) => v)
    .sort((x, y) => (x.kind === y.kind ? 0 : x.kind === "genre" ? -1 : 1))
    .slice(0, limit);
  return { entityId, shared, checked };
}
