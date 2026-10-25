import "server-only";

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

export interface Kv {
  kind: "upstash" | "memory";
  get(key: string): Promise<string | null>;
  mget(keys: string[]): Promise<(string | null)[]>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  /** Several writes in one round trip. */
  setMany(entries: { key: string; value: string; ttlSeconds?: number }[]): Promise<void>;
  del(key: string): Promise<void>;
  sadd(key: string, member: string): Promise<void>;
  srem(key: string, member: string): Promise<void>;
  smembers(key: string): Promise<string[]>;
}

export class KvError extends Error {}

export function upstashKv(url: string, token: string): Kv {
  const base = url.replace(/\/+$/, "");
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

  async function call<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(body), cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new KvError(`Storage returned ${res.status}`);
    return (await res.json()) as T;
  }
  const cmd = async <T>(...args: (string | number)[]) => {
    const r = await call<{ result?: T; error?: string }>("", args);
    if (r.error) throw new KvError(`Storage error: ${r.error}`);
    return r.result as T;
  };

  return {
    kind: "upstash",
    get: (key) => cmd<string | null>("GET", key),
    async mget(keys) {
      const out: (string | null)[] = [];
      // Keep each request well under the REST body limit.
      for (let i = 0; i < keys.length; i += 200) out.push(...(await cmd<(string | null)[]>("MGET", ...keys.slice(i, i + 200))));
      return out;
    },
    async set(key, value, ttl) {
      await cmd(...(ttl ? ["SET", key, value, "EX", ttl] : ["SET", key, value]));
    },
    async setMany(entries) {
      for (let i = 0; i < entries.length; i += 100) {
        const batch = entries.slice(i, i + 100).map((e) => (e.ttlSeconds ? ["SET", e.key, e.value, "EX", e.ttlSeconds] : ["SET", e.key, e.value]));
        const r = await call<{ error?: string }[]>("/pipeline", batch);
        const failed = r.find((x) => x.error);
        if (failed) throw new KvError(`Storage error: ${failed.error}`);
      }
    },
    async del(key) {
      await cmd("DEL", key);
    },
    async sadd(key, member) {
      await cmd("SADD", key, member);
    },
    async srem(key, member) {
      await cmd("SREM", key, member);
    },
    smembers: (key) => cmd<string[]>("SMEMBERS", key),
  };
}

export function memoryKv(): Kv {
  const values = new Map<string, { v: string; exp: number | null }>();
  const sets = new Map<string, Set<string>>();
  const live = (key: string) => {
    const e = values.get(key);
    if (!e) return null;
    if (e.exp !== null && e.exp < Date.now()) {
      values.delete(key);
      return null;
    }
    return e.v;
  };
  return {
    kind: "memory",
    get: async (key) => live(key),
    mget: async (keys) => keys.map(live),
    async set(key, value, ttl) {
      values.set(key, { v: value, exp: ttl ? Date.now() + ttl * 1000 : null });
    },
    async setMany(entries) {
      for (const e of entries) values.set(e.key, { v: e.value, exp: e.ttlSeconds ? Date.now() + e.ttlSeconds * 1000 : null });
    },
    async del(key) {
      values.delete(key);
    },
    async sadd(key, member) {
      if (!sets.has(key)) sets.set(key, new Set());
      sets.get(key)!.add(member);
    },
    async srem(key, member) {
      sets.get(key)?.delete(member);
    },
    smembers: async (key) => [...(sets.get(key) ?? [])],
  };
}

const g = globalThis as unknown as { __tidateMemoryKv?: Kv };

/** Upstash when configured, otherwise one in-memory store per server process. */
export function getKv(): Kv {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url?.trim() && token?.trim()) return upstashKv(url.trim(), token.trim());
  return (g.__tidateMemoryKv ??= memoryKv());
}
