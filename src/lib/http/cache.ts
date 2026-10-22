/**
 * Private, per-instance, in-memory TTL cache for upstream API responses.
 *
 * Qloo permits private server-side caching; Ticketmaster permits caching for a
 * "reasonable period" needed to provide the service, so its TTL is short.
 * Nothing here is ever written to disk or to the repository.
 */

interface Entry<T> {
  value: T;
  expires: number;
}

export class TtlCache<T> {
  private store = new Map<string, Entry<T>>();
  private inflight = new Map<string, Promise<T>>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 5000,
  ) {}

  get(key: string): T | undefined {
    const e = this.store.get(key);
    if (!e) return undefined;
    if (e.expires < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return e.value;
  }

  set(key: string, value: T) {
    if (this.store.size >= this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.store.set(key, { value, expires: Date.now() + this.ttlMs });
  }

  /** Returns a cached value or computes it once, de-duplicating concurrent callers. */
  async getOrLoad(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.get(key);
    if (hit !== undefined) return hit;
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const p = load()
      .then((v) => {
        this.set(key, v);
        return v;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }
}
