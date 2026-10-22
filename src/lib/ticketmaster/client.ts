import { z } from "zod";
import { TtlCache } from "../http/cache";
import { Limiter, UpstreamError, fetchJson } from "../http/fetch";
import { geohash, type Market } from "../markets";
import type { CompetingEvent, EventStatus } from "../types";

/**
 * Ticketmaster Discovery API v2 client.
 * Docs: https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/
 *  - auth via `apikey` query parameter
 *  - 5 requests/second, 5000/day; deep paging limited to size * page < 1000
 *  - dates.status.code: onsale | offsale | canceled | postponed | rescheduled
 */

const BASE = "https://app.ticketmaster.com/discovery/v2/events.json";
const PAGE_SIZE = 200;
const MAX_ITEMS = 1000;

// ~4 req/s keeps us under the documented 5 req/s limit.
const limiter = new Limiter(2, 250);
// Short TTL: Ticketmaster allows caching only for a reasonable period.
const cache = new TtlCache<EventSearchResult>(15 * 60 * 1000, 200);

/* ---------- Runtime schemas (only the fields we use) ---------- */

const Classification = z
  .object({
    genre: z.object({ name: z.string().optional() }).optional(),
    segment: z.object({ name: z.string().optional() }).optional(),
  })
  .partial();

const Attraction = z.object({
  id: z.string().optional(),
  name: z.string(),
  classifications: z.array(Classification).optional(),
});

const Venue = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  city: z.object({ name: z.string().optional() }).optional(),
  location: z.object({ latitude: z.string().optional(), longitude: z.string().optional() }).optional(),
});

const TmEvent = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string().optional(),
  dates: z
    .object({
      start: z
        .object({
          localDate: z.string().optional(),
          localTime: z.string().optional(),
          dateTBA: z.boolean().optional(),
          dateTBD: z.boolean().optional(),
          timeTBA: z.boolean().optional(),
        })
        .optional(),
      status: z.object({ code: z.string().optional() }).optional(),
    })
    .optional(),
  classifications: z.array(Classification).optional(),
  _embedded: z
    .object({
      venues: z.array(Venue).optional(),
      attractions: z.array(Attraction).optional(),
    })
    .optional(),
});

const SearchResponse = z.object({
  _embedded: z.object({ events: z.array(z.unknown()) }).optional(),
  page: z
    .object({
      size: z.number(),
      totalElements: z.number(),
      totalPages: z.number(),
      number: z.number(),
    })
    .optional(),
});

const STATUS: Record<string, EventStatus> = {
  onsale: "onsale",
  offsale: "offsale",
  canceled: "canceled",
  cancelled: "canceled",
  postponed: "postponed",
  rescheduled: "rescheduled",
};

export function normaliseTmEvent(raw: unknown, retrievedAt: string, request: string): CompetingEvent | null {
  const parsed = TmEvent.safeParse(raw);
  if (!parsed.success) return null;
  const e = parsed.data;
  const venue = e._embedded?.venues?.[0];
  const start = e.dates?.start;
  const tba = start?.dateTBA || start?.dateTBD;
  const localDate = !tba && start?.localDate && /^\d{4}-\d{2}-\d{2}$/.test(start.localDate) ? start.localDate : null;
  const genreOf = (c?: z.infer<typeof Classification>[]) => {
    const g = c?.[0]?.genre?.name;
    return g && g !== "Undefined" ? g : null;
  };
  const lat = venue?.location?.latitude ? Number(venue.location.latitude) : null;
  const lng = venue?.location?.longitude ? Number(venue.location.longitude) : null;
  return {
    eventId: e.id,
    name: e.name,
    url: e.url ?? null,
    localDate,
    localTime: start?.timeTBA ? null : (start?.localTime ?? null),
    status: STATUS[e.dates?.status?.code ?? ""] ?? "unknown",
    venue: {
      id: venue?.id ?? null,
      name: venue?.name ?? "Unknown venue",
      city: venue?.city?.name ?? null,
      lat: lat !== null && Number.isFinite(lat) ? lat : null,
      lng: lng !== null && Number.isFinite(lng) ? lng : null,
    },
    performers: (e._embedded?.attractions ?? []).map((a) => ({
      attractionId: a.id ?? null,
      name: a.name,
      genre: genreOf(a.classifications),
    })),
    genre: genreOf(e.classifications),
    provenance: { source: "ticketmaster", retrievedAt, request },
  };
}

export interface EventSearchParams {
  market: Market;
  radiusMiles: number;
  /** Inclusive local-date range. */
  startDate: string;
  endDate: string;
}

export interface EventSearchResult {
  events: CompetingEvent[];
  pagesFetched: number;
  totalReported: number | null;
  truncated: boolean;
  /** Raw records that failed validation (counted, not used). */
  malformed: number;
}

/**
 * Searches music events around a market centre for a date range.
 * The UTC window is widened by one day on each side so that events whose
 * local date falls inside the range are not lost to time-zone offsets; the
 * engine compares local calendar dates.
 */
export async function searchMusicEvents(apiKey: string, p: EventSearchParams): Promise<EventSearchResult> {
  const gh = geohash(p.market.lat, p.market.lng, 9);
  const startUtc = `${shiftDate(p.startDate, -1)}T00:00:00Z`;
  const endUtc = `${shiftDate(p.endDate, 1)}T23:59:59Z`;
  const describe = `GET discovery/v2/events classificationName=music geoPoint=${gh} radius=${p.radiusMiles}mi ${startUtc}..${endUtc}`;
  const cacheKey = `${gh}|${p.radiusMiles}|${startUtc}|${endUtc}`;

  return cache.getOrLoad(cacheKey, async () => {
    const meta = { pagesFetched: 0, totalReported: null as number | null, truncated: false, malformed: 0 };
    const out: CompetingEvent[] = [];
    const retrievedAt = new Date().toISOString();
    for (let page = 0; page * PAGE_SIZE < MAX_ITEMS; page++) {
      const qs = new URLSearchParams({
        apikey: apiKey,
        classificationName: "music",
        geoPoint: gh,
        radius: String(p.radiusMiles),
        unit: "miles",
        startDateTime: startUtc,
        endDateTime: endUtc,
        size: String(PAGE_SIZE),
        page: String(page),
        sort: "date,asc",
      });
      const json = await fetchJson({
        service: "ticketmaster",
        url: `${BASE}?${qs}`,
        limiter,
        label: "Ticketmaster event search",
      });
      const parsed = SearchResponse.safeParse(json);
      if (!parsed.success) throw new UpstreamError("ticketmaster", 200, "Ticketmaster returned an unexpected response shape");
      meta.pagesFetched += 1;
      meta.totalReported = parsed.data.page?.totalElements ?? meta.totalReported;
      const items = parsed.data._embedded?.events ?? [];
      for (const raw of items) {
        const ev = normaliseTmEvent(raw, retrievedAt, describe);
        if (ev) out.push(ev);
        else meta.malformed += 1;
      }
      const totalPages = parsed.data.page?.totalPages ?? 0;
      if (items.length < PAGE_SIZE || page + 1 >= totalPages) break;
      if ((page + 2) * PAGE_SIZE > MAX_ITEMS) {
        meta.truncated = true;
        break;
      }
    }
    return { events: out, ...meta };
  });
}

function shiftDate(d: string, days: number): string {
  const t = Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}
