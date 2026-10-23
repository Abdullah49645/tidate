import "server-only";
import { cacheLife } from "next/cache";
import type { ArtistCandidate } from "../types";
import { QlooClient } from "./client";

/**
 * Durable, shared server-side cache for Qloo artist search (Qloo permits private
 * server-side caching). On Vercel, "use cache: remote" persists across instances,
 * so each performer name is looked up once per deployment rather than once per
 * request. Errors are thrown, not cached.
 */
export async function cachedSearchArtists(name: string): Promise<ArtistCandidate[]> {
  "use cache: remote";
  cacheLife("weeks");
  const client = new QlooClient(process.env.QLOO_API_KEY ?? "", process.env.QLOO_BASE_URL ?? "https://hackathon.api.qloo.com");
  return client.searchArtists(name);
}
