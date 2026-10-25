import { ConfigurationError } from "../providers";
import { WatchError } from "./service";

const STATUS: Record<WatchError["code"], number> = { "not-found": 404, invalid: 400, "too-soon": 429, ended: 410, limit: 503, failed: 502 };

/** Maps watch failures to HTTP responses without leaking internals. */
export function watchErrorResponse(err: unknown): Response {
  if (err instanceof WatchError) {
    return Response.json(
      { error: err.message, code: err.code },
      { status: STATUS[err.code], headers: err.retryAfterSeconds ? { "retry-after": String(err.retryAfterSeconds) } : undefined },
    );
  }
  if (err instanceof ConfigurationError) return Response.json({ error: err.message, code: "not-configured" }, { status: 503 });
  return Response.json({ error: "The watch couldn't be updated. Storage or an upstream service didn't respond.", code: "failed" }, { status: 502 });
}
