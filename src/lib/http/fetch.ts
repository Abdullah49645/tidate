/**
 * Small HTTP helpers for server-side API clients: timeouts, bounded
 * concurrency, minimum spacing between requests, and limited retries on 429
 * and 5xx. Secrets are never included in error messages.
 */

export class UpstreamError extends Error {
  constructor(
    public readonly service: "qloo" | "ticketmaster" | "llm",
    public readonly status: number | null,
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}

export class Limiter {
  private active = 0;
  private queue: Array<() => void> = [];
  private last = 0;

  constructor(
    private readonly concurrency: number,
    private readonly minIntervalMs: number,
  ) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await new Promise<void>((resolve) => {
      const go = () => {
        this.active += 1;
        resolve();
      };
      if (this.active < this.concurrency) go();
      else this.queue.push(go);
    });
    try {
      const wait = this.last + this.minIntervalMs - Date.now();
      if (wait > 0) await sleep(wait);
      this.last = Date.now();
      return await fn();
    } finally {
      this.active -= 1;
      this.queue.shift()?.();
    }
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface FetchJsonOptions {
  service: "qloo" | "ticketmaster";
  url: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
  limiter?: Limiter;
  /** Description for error messages (must not include secrets). */
  label: string;
}

export async function fetchJson(opts: FetchJsonOptions): Promise<unknown> {
  const { service, url, headers, timeoutMs = 12_000, retries = 2, limiter, label } = opts;
  let attempt = 0;
  for (;;) {
    const exec = async () => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        return await fetch(url, { headers, signal: ctrl.signal, cache: "no-store" });
      } finally {
        clearTimeout(timer);
      }
    };
    let res: Response;
    try {
      res = limiter ? await limiter.run(exec) : await exec();
    } catch (err) {
      const aborted = err instanceof Error && err.name === "AbortError";
      if (attempt < retries) {
        attempt += 1;
        await sleep(400 * attempt);
        continue;
      }
      throw new UpstreamError(service, null, `${label}: ${aborted ? "timed out" : "network error"}`, true);
    }

    if (res.ok) {
      try {
        return await res.json();
      } catch {
        throw new UpstreamError(service, res.status, `${label}: response was not valid JSON`);
      }
    }

    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt < retries) {
      attempt += 1;
      // Honour Retry-After or Qloo's per-second reset header; otherwise back off.
      const ra = Number(res.headers.get("retry-after") ?? res.headers.get("x-second-ratelimit-reset"));
      const base = res.status === 429 ? 1000 : 700;
      await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(Math.max(ra * 1000, base), 5000) + 100 * attempt : base * attempt);
      continue;
    }
    let detail = "";
    try {
      const body = await res.text();
      detail = body.slice(0, 240).replace(/\s+/g, " ");
    } catch {
      /* ignore */
    }
    throw new UpstreamError(service, res.status, `${label}: HTTP ${res.status}${detail ? ` – ${detail}` : ""}`, retryable);
  }
}
