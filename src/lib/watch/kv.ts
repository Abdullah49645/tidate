import "server-only";
import { memoryKv, upstashKv, type Kv } from "./kv-core";

export { KvError, memoryKv, upstashKv, type Kv } from "./kv-core";

/**
 * Minimal key-value store for watches and the shared performer-match cache.
 *
 * Production: Upstash Redis over its REST API (free tier; added from the Vercel
 * Marketplace, which sets KV_REST_API_URL and KV_REST_API_TOKEN, or set
 * UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN directly). No SDK needed.
 *
 * Development: an in-memory map, so everything works locally without an
 * account. It does not survive a restart and is not shared between server
 * instances; the UI says so when it is in use.
 */

const g = globalThis as unknown as { __tidateMemoryKv?: Kv };

/** Upstash when configured, otherwise one in-memory store per server process. */
export function getKv(): Kv {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url?.trim() && token?.trim()) return upstashKv(url.trim(), token.trim());
  return (g.__tidateMemoryKv ??= memoryKv());
}
