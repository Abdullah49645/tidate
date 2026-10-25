import "server-only";

/**
 * Server-side configuration. Values are read from the environment at call
 * time and never sent to the browser; only booleans describing what is
 * configured are exposed.
 */

export type LlmProvider = "google" | "openai" | "anthropic";

/** One way to reach a model: provider, model id and the key to use. */
export interface LlmRoute {
  provider: LlmProvider;
  model: string;
  apiKey: string;
  /** Position of the key in its list (for logs; the key itself is never logged). */
  keyIndex: number;
}

export interface ServerConfig {
  qlooApiKey: string | null;
  qlooBaseUrl: string;
  ticketmasterApiKey: string | null;
  /** Ordered fallbacks: every key x every model for the chosen provider. */
  llmRoutes: LlmRoute[];
  /** Force demo mode even if keys are present (useful for presentations). */
  forceDemo: boolean;
}

const clean = (v: string | undefined) => (v && v.trim() ? v.trim() : null);

const list = (...vals: Array<string | undefined>) => {
  const out: string[] = [];
  for (const v of vals) for (const part of (v ?? "").split(",")) if (part.trim() && !out.includes(part.trim())) out.push(part.trim());
  return out;
};

/**
 * Model fallback order per provider. Google ids were checked against the
 * models available to the configured keys in October 2026; when one is
 * overloaded (503) or rate limited (429), the next route is tried.
 */
const DEFAULT_MODELS: Record<LlmProvider, string[]> = {
  google: ["gemini-3.5-flash", "gemini-3.8-flash", "gemini-flash-latest"],
  openai: ["gpt-4.1-mini"],
  anthropic: ["claude-haiku-4-5"],
};

export function getConfig(): ServerConfig {
  const keys: Record<LlmProvider, string[]> = {
    google: list(process.env.GOOGLE_GENERATIVE_AI_API_KEYS, process.env.GOOGLE_GENERATIVE_AI_API_KEY),
    openai: list(process.env.OPENAI_API_KEY),
    anthropic: list(process.env.ANTHROPIC_API_KEY),
  };
  const preferred = clean(process.env.TIDATE_LLM_PROVIDER) as LlmProvider | null;
  const order: LlmProvider[] = preferred && keys[preferred]?.length ? [preferred] : (["google", "openai", "anthropic"] as LlmProvider[]);
  const provider = order.find((p) => keys[p].length > 0) ?? null;

  const llmRoutes: LlmRoute[] = [];
  if (provider) {
    const models = list(process.env.TIDATE_LLM_MODEL).length ? list(process.env.TIDATE_LLM_MODEL) : DEFAULT_MODELS[provider];
    // Model-major order: try the preferred model on every key before moving to the next model.
    for (const model of models) keys[provider].forEach((apiKey, keyIndex) => llmRoutes.push({ provider, model, apiKey, keyIndex }));
  }

  return {
    qlooApiKey: clean(process.env.QLOO_API_KEY),
    qlooBaseUrl: clean(process.env.QLOO_BASE_URL) ?? "https://hackathon.api.qloo.com",
    ticketmasterApiKey: clean(process.env.TICKETMASTER_API_KEY),
    llmRoutes,
    forceDemo: process.env.TIDATE_FORCE_DEMO === "1",
  };
}

export interface PublicStatus {
  liveAvailable: boolean;
  qloo: boolean;
  ticketmaster: boolean;
  agent: boolean;
  llmProvider: string | null;
  /** Where watches are stored: "upstash" persists, "memory" is lost on restart. */
  watchStorage: "upstash" | "memory";
}

export function publicStatus(): PublicStatus {
  const c = getConfig();
  const live = !c.forceDemo && !!c.qlooApiKey && !!c.ticketmasterApiKey;
  return {
    liveAvailable: live,
    qloo: !!c.qlooApiKey,
    ticketmaster: !!c.ticketmasterApiKey,
    agent: c.llmRoutes.length > 0,
    llmProvider: c.llmRoutes[0]?.provider ?? null,
    watchStorage:
      (process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL)?.trim() && (process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN)?.trim() ? "upstash" : "memory",
  };
}
