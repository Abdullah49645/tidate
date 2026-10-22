import { z } from "zod";
import { TtlCache } from "../http/cache";
import { Limiter, UpstreamError, fetchJson } from "../http/fetch";
import type { AffinitySignal, ArtistCandidate } from "../types";

/**
 * Qloo hackathon API client.
 * Guide: https://docs.qloo.com/reference/qloo-llm-hackathon-developer-guide
 *  - base URL https://hackathon.api.qloo.com, header X-Api-Key
 *  - /search?query=..&types=urn:entity:artist        entity lookup
 *  - /v2/insights (GET) filter.type=urn:entity:artist
 *        signal.interests.entities=<target>            the target act as signal
 *        filter.results.entities=<ids>                 "often used to assess the
 *                                                       affinity of an entity towards input"
 *    take max 50.
 * Private server-side caching is permitted; responses are never written to the repository.
 */

const ARTIST = "urn:entity:artist";
const MAX_TAKE = 50;

const limiter = new Limiter(4, 60);
const searchCache = new TtlCache<ArtistCandidate[]>(24 * 3600 * 1000);
const affinityCache = new TtlCache<AffinitySignal>(24 * 3600 * 1000, 20_000);

const num01 = z
  .union([z.number(), z.string()])
  .transform((v) => (typeof v === "string" ? Number(v) : v))
  .pipe(z.number().finite())
  .nullable()
  .optional()
  .catch(null);

const QlooEntity = z.object({
  entity_id: z.string().optional(),
  id: z.string().optional(),
  name: z.string(),
  popularity: num01,
  disambiguation: z.string().nullable().optional().catch(null),
  types: z.array(z.string()).optional().catch(undefined),
  query: z
    .object({ affinity: num01 })
    .passthrough()
    .optional()
    .catch(undefined),
});

const SearchResponse = z.object({ results: z.array(z.unknown()) });
const InsightsResponse = z.object({
  success: z.boolean().optional(),
  results: z.object({ entities: z.array(z.unknown()).optional() }).optional(),
});

export function parseEntity(raw: unknown) {
  const r = QlooEntity.safeParse(raw);
  if (!r.success) return null;
  const id = r.data.entity_id ?? r.data.id;
  if (!id) return null;
  return {
    entityId: id,
    name: r.data.name,
    popularity: r.data.popularity ?? null,
    disambiguation: r.data.disambiguation ?? null,
    types: r.data.types ?? [],
    affinity: r.data.query?.affinity ?? null,
  };
}

export class QlooClient {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = "https://hackathon.api.qloo.com",
  ) {}

  private get headers() {
    return { "X-Api-Key": this.apiKey, accept: "application/json" };
  }

  /** Search artists by name. Returns candidates in Qloo's ranking order. */
  async searchArtists(name: string, take = 5): Promise<ArtistCandidate[]> {
    const key = `${name.toLowerCase().trim()}|${take}`;
    return searchCache.getOrLoad(key, async () => {
      const qs = new URLSearchParams({ query: name, types: ARTIST, take: String(take) });
      const json = await fetchJson({
        service: "qloo",
        url: `${this.baseUrl}/search?${qs}`,
        headers: this.headers,
        limiter,
        label: "Qloo artist search",
      });
      const parsed = SearchResponse.safeParse(json);
      if (!parsed.success) throw new UpstreamError("qloo", 200, "Qloo search returned an unexpected response shape");
      const out: ArtistCandidate[] = [];
      for (const raw of parsed.data.results) {
        const e = parseEntity(raw);
        if (!e) continue;
        // Search can return non-artist types when `types` is ignored; keep artists only when typed.
        if (e.types.length && !e.types.includes(ARTIST)) continue;
        out.push({ entityId: e.entityId, name: e.name, popularity: e.popularity, disambiguation: e.disambiguation });
      }
      return out;
    });
  }

  /**
   * Affinity of each candidate artist towards the target artist signal.
   * Entities Qloo does not return are reported with affinity null (never invented).
   */
  async affinities(targetEntityId: string, entityIds: string[]): Promise<Record<string, AffinitySignal>> {
    const unique = [...new Set(entityIds.filter((id) => id && id !== targetEntityId))];
    const result: Record<string, AffinitySignal> = {};
    const missing: string[] = [];
    for (const id of unique) {
      const hit = affinityCache.get(`${targetEntityId}|${id}`);
      if (hit) result[id] = hit;
      else missing.push(id);
    }
    const chunks: string[][] = [];
    for (let i = 0; i < missing.length; i += MAX_TAKE) chunks.push(missing.slice(i, i + MAX_TAKE));

    await Promise.all(
      chunks.map(async (chunk) => {
        const qs = new URLSearchParams({
          "filter.type": ARTIST,
          "signal.interests.entities": targetEntityId,
          "filter.results.entities": chunk.join(","),
          take: String(Math.min(MAX_TAKE, chunk.length)),
        });
        const request = `GET /v2/insights filter.type=${ARTIST} signal.interests.entities=${targetEntityId} filter.results.entities=[${chunk.length} ids]`;
        const json = await fetchJson({
          service: "qloo",
          url: `${this.baseUrl}/v2/insights?${qs}`,
          headers: this.headers,
          limiter,
          label: "Qloo insights (affinity)",
        });
        const parsed = InsightsResponse.safeParse(json);
        if (!parsed.success) throw new UpstreamError("qloo", 200, "Qloo insights returned an unexpected response shape");
        const retrievedAt = new Date().toISOString();
        const returned = new Map<string, { affinity: number | null; popularity: number | null }>();
        for (const raw of parsed.data.results?.entities ?? []) {
          const e = parseEntity(raw);
          if (e) returned.set(e.entityId, { affinity: e.affinity, popularity: e.popularity });
        }
        for (const id of chunk) {
          const r = returned.get(id);
          const sig: AffinitySignal = {
            entityId: id,
            affinity: r?.affinity ?? null,
            popularity: r?.popularity ?? null,
            provenance: { source: "qloo", retrievedAt, request },
          };
          result[id] = sig;
          affinityCache.set(`${targetEntityId}|${id}`, sig);
        }
      }),
    );
    return result;
  }
}
