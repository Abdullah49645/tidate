/**
 * DEMO DATA — ENTIRELY FICTIONAL.
 *
 * Every artist, venue, event and affinity value below is invented for a
 * reproducible demonstration of the workflow. None of it comes from Qloo or
 * Ticketmaster, and none of it describes real people, places or audiences.
 * The UI labels every demo result as synthetic.
 */
import type { DataProvider } from "../pipeline";
import { normaliseName } from "../scoring/engine";
import { geohash } from "../markets";
import type { AffinitySignal, ArtistCandidate, CompetingEvent, EventStatus, HeatCell, TasteTag } from "../types";

export const DEMO_TARGET = "Juniper Static";
export const DEMO_MARKET = "chicago";
export const DEMO_DATES = ["2027-05-08", "2027-05-15", "2027-05-22"];

interface DemoArtist {
  id: string;
  name: string;
  popularity: number | null;
  affinity: number | null; // toward Juniper Static; null = "not returned"
  genre: string;
}

const ARTISTS: DemoArtist[] = [
  { id: "demo-juniper-static", name: "Juniper Static", popularity: 0.71, affinity: null, genre: "Indie Pop" },
  { id: "demo-paper-lanterns", name: "Paper Lanterns", popularity: 0.82, affinity: 0.93, genre: "Indie Pop" },
  { id: "demo-halcyon-drift", name: "Halcyon Drift", popularity: 0.64, affinity: 0.71, genre: "Dream Pop" },
  { id: "demo-glass-orchard", name: "Glass Orchard", popularity: 0.5, affinity: 0.55, genre: "Indie Rock" },
  { id: "demo-saint-ember", name: "Saint Ember", popularity: 0.75, affinity: 0.66, genre: "Alternative" },
  { id: "demo-coastline-saints", name: "Coastline Saints", popularity: null, affinity: 0.4, genre: "Folk" },
  { id: "demo-morrow-finch", name: "Morrow & Finch", popularity: 0.45, affinity: 0.62, genre: "Singer-Songwriter" },
  { id: "demo-iron-choir", name: "Iron Choir", popularity: 0.7, affinity: 0.08, genre: "Metal" },
  { id: "demo-bassline-union", name: "Bassline Union", popularity: 0.6, affinity: 0.12, genre: "Dance/Electronic" },
  { id: "demo-lone-prairie", name: "Lone Prairie Band", popularity: 0.55, affinity: 0.05, genre: "Country" },
  { id: "demo-velvet-mandate", name: "Velvet Mandate", popularity: 0.4, affinity: 0.18, genre: "Hip-Hop/Rap" },
  { id: "demo-dj-kestrel", name: "DJ Kestrel", popularity: 0.5, affinity: 0.1, genre: "Dance/Electronic" },
  { id: "demo-quiet-harbor", name: "Quiet Harbor", popularity: 0.3, affinity: null, genre: "Ambient" },
  { id: "demo-echo-a", name: "Echo", popularity: 0.41, affinity: 0.5, genre: "Electronic" },
  { id: "demo-echo-b", name: "Echo", popularity: 0.38, affinity: 0.2, genre: "Hard Rock" },
];

/** Fictional Qloo-style tags: genres plus invented influences. */
const TAGS: Record<string, [genres: string[], influences: string[]]> = {
  "demo-juniper-static": [["Indie Pop", "Dream Pop", "Bedroom Pop"], ["Marlowe Vance", "The Tin Gardens"]],
  "demo-paper-lanterns": [["Indie Pop", "Bedroom Pop", "Singer-Songwriter"], ["Marlowe Vance"]],
  "demo-halcyon-drift": [["Dream Pop", "Shoegaze"], ["The Tin Gardens"]],
  "demo-glass-orchard": [["Indie Rock", "Indie Pop"], []],
  "demo-saint-ember": [["Alternative", "Indie Rock"], ["The Tin Gardens"]],
  "demo-coastline-saints": [["Folk", "Americana"], []],
  "demo-morrow-finch": [["Singer-Songwriter", "Folk"], ["Marlowe Vance"]],
  "demo-iron-choir": [["Metal", "Hard Rock"], []],
  "demo-bassline-union": [["Electronic", "House"], []],
  "demo-lone-prairie": [["Country", "Americana"], []],
  "demo-velvet-mandate": [["Hip Hop"], []],
  "demo-dj-kestrel": [["Electronic", "Techno"], []],
  "demo-echo-a": [["Electronic", "Dream Pop"], []],
  "demo-echo-b": [["Hard Rock"], []],
};

function demoTags(id: string): TasteTag[] | undefined {
  const t = TAGS[id];
  if (!t) return undefined;
  return [
    ...t[0].map((name) => ({ id: `demo-tag-${name}`, name, type: "urn:tag:genre:qloo" })),
    ...t[1].map((name) => ({ id: `demo-tag-${name}`, name, type: "urn:tag:influenced_by:qloo" })),
  ];
}

/** Deterministic fictional heatmap around a point: one hotspot north of the centre, one smaller to the west. */
function demoHeatmap(lat: number, lng: number): HeatCell[] {
  const cells: { lat: number; lng: number; raw: number }[] = [];
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // Steps match a geohash-6 cell (about 0.0055 deg latitude by 0.011 deg longitude).
  for (let i = -44; i <= 44; i++) {
    for (let j = -22; j <= 22; j++) {
      const la = lat + i * 0.0055;
      const lo = lng + j * 0.011;
      const dist = Math.hypot(i / 44, j / 22);
      if (dist > 1 || rand() > 0.8 * (1.1 - dist)) continue;
      const hot = Math.exp(-((i - 22) ** 2 / 2 + (j + 1) ** 2 * 2) / 60) + 0.6 * Math.exp(-((i + 6) ** 2 / 2 + (j + 9) ** 2 * 2) / 30);
      cells.push({ lat: la, lng: lo, raw: hot + rand() * 0.25 });
    }
  }
  const rank = new Map([...cells].sort((a, b) => a.raw - b.raw).map((c, k) => [c, k]));
  const seen = new Set<string>();
  return cells
    .map((c) => ({
      lat: +c.lat.toFixed(5),
      lng: +c.lng.toFixed(5),
      geohash: geohash(c.lat, c.lng, 6),
      affinity: cells.length > 1 ? rank.get(c)! / (cells.length - 1) : 1,
    }))
    .filter((c) => !seen.has(c.geohash) && !!seen.add(c.geohash));
}

const V = {
  larkspur: { id: "demo-v-larkspur", name: "Larkspur Hall", lat: 41.889, lng: -87.636 },
  foundry: { id: "demo-v-foundry", name: "The Foundry Room", lat: 41.91, lng: -87.677 },
  riverside: { id: "demo-v-riverside", name: "Riverside Pavilion", lat: 41.866, lng: -87.617 },
  northgate: { id: "demo-v-northgate", name: "Northgate Arena", lat: 41.881, lng: -87.674 },
  copper: { id: "demo-v-copper", name: "Copper Lantern", lat: 41.94, lng: -87.654 },
  union: { id: "demo-v-union", name: "Union Ballroom", lat: 41.97, lng: -87.659 },
  marigold: { id: "demo-v-marigold", name: "Marigold Theatre", lat: 41.885, lng: -87.627 },
};

type Row = [id: string, performers: string[], date: string | null, venue: keyof typeof V, status?: EventStatus, name?: string];

const ROWS: Row[] = [
  ["demo-e01", ["Morrow & Finch"], "2027-05-01", "copper"],
  ["demo-e02", ["Velvet Mandate"], "2027-05-07", "union"],
  ["demo-e03", ["Iron Choir"], "2027-05-08", "northgate"],
  ["demo-e04", ["Bassline Union"], "2027-05-08", "riverside"],
  ["demo-e05", ["DJ Kestrel"], "2027-05-08", "foundry"],
  ["demo-e06", ["Lone Prairie Band"], "2027-05-09", "marigold"],
  ["demo-e07", ["Paper Lanterns", "Glass Orchard"], "2027-05-15", "larkspur"],
  ["demo-e08", ["Paper Lanterns"], "2027-05-15", "larkspur", "onsale", "Paper Lanterns – VIP Package"],
  ["demo-e09", ["Halcyon Drift"], "2027-05-16", "foundry", "rescheduled"],
  ["demo-e10", ["Paper Lanterns"], "2027-05-17", "larkspur", "canceled", "Paper Lanterns – Second Night"],
  ["demo-e11", ["Quiet Harbor"], "2027-05-19", "copper"],
  ["demo-e12", ["Echo"], "2027-05-25", "union"],
  ["demo-e13", ["Glass Orchard"], "2027-05-21", "foundry"],
  ["demo-e14", ["Decades Revue: A Tribute to the 80s"], "2027-05-23", "marigold"],
  ["demo-e15", ["Saint Ember"], "2027-05-24", "riverside"],
  ["demo-e16", ["Coastline Saints"], "2027-05-28", "copper"],
  ["demo-e17", ["Halcyon Drift"], null, "union", "onsale", "Halcyon Drift – Date TBA"],
];

function demoEvents(): CompetingEvent[] {
  const retrievedAt = "2026-10-22T00:00:00Z";
  return ROWS.map(([id, performers, date, venueKey, status = "onsale", name]) => {
    const v = V[venueKey];
    // The VIP listing duplicates e07 (same venue, date and primary performer).
    const perf = id === "demo-e08" ? ["Paper Lanterns", "Glass Orchard"] : performers;
    return {
      eventId: id,
      name: name ?? perf.join(" with "),
      url: null,
      localDate: date,
      localTime: date ? "20:00:00" : null,
      status,
      venue: { id: v.id, name: v.name, city: "Demo City", lat: v.lat, lng: v.lng },
      performers: perf.map((p) => ({
        attractionId: `demo-a-${normaliseName(p).replace(/ /g, "-")}`,
        name: p,
        genre: ARTISTS.find((a) => a.name === p)?.genre ?? null,
      })),
      genre: ARTISTS.find((a) => a.name === perf[0])?.genre ?? null,
      provenance: { source: "demo-fixture", retrievedAt, request: "demo fixture (fictional)" },
    };
  });
}

export function createDemoProvider(): DataProvider {
  return {
    mode: "demo",
    async searchEvents({ startDate, endDate }) {
      const events = demoEvents().filter((e) => !e.localDate || (e.localDate >= startDate && e.localDate <= endDate));
      return { events, pagesFetched: 1, totalReported: events.length, truncated: false, malformed: 0 };
    },
    async searchArtists(name: string): Promise<ArtistCandidate[]> {
      const q = normaliseName(name);
      if (!q) return [];
      return ARTISTS.filter((a) => normaliseName(a.name) === q || normaliseName(a.name).startsWith(q))
        .sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0))
        .map((a) => ({ entityId: a.id, name: a.name, popularity: a.popularity, disambiguation: a.genre }));
    },
    async affinities(targetEntityId: string, ids: string[]) {
      const out: Record<string, AffinitySignal> = {};
      for (const id of ids) {
        const a = ARTISTS.find((x) => x.id === id);
        const useful = targetEntityId === "demo-juniper-static";
        out[id] = {
          entityId: id,
          affinity: useful ? (a?.affinity ?? null) : null,
          popularity: a?.popularity ?? null,
          provenance: { source: "demo-fixture", retrievedAt: "2026-10-22T00:00:00Z", request: "demo fixture (fictional)" },
        };
      }
      return out;
    },
    async entityTags(ids: string[]) {
      const out: Record<string, TasteTag[]> = {};
      for (const id of ids) {
        const t = demoTags(id);
        if (t) out[id] = t;
      }
      return out;
    },
    async fanHeatmap(targetEntityId, market) {
      return targetEntityId === "demo-juniper-static" ? demoHeatmap(market.lat, market.lng) : [];
    },
  };
}
