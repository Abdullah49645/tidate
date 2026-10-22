import "server-only";

/**
 * Server-side configuration. Values are read from the environment at call
 * time and never sent to the browser; only booleans describing what is
 * configured are exposed.
 */

export interface ServerConfig {
  qlooApiKey: string | null;
  qlooBaseUrl: string;
  ticketmasterApiKey: string | null;
  llm: { provider: "google" | "openai" | "anthropic"; model: string } | null;
  /** Force demo mode even if keys are present (useful for presentations). */
  forceDemo: boolean;
}

const clean = (v: string | undefined) => (v && v.trim() ? v.trim() : null);

export function getConfig(): ServerConfig {
  const google = clean(process.env.GOOGLE_GENERATIVE_AI_API_KEY);
  const openai = clean(process.env.OPENAI_API_KEY);
  const anthropic = clean(process.env.ANTHROPIC_API_KEY);
  const preferred = clean(process.env.UNDERTOW_LLM_PROVIDER);
  let llm: ServerConfig["llm"] = null;
  const pick = (p: "google" | "openai" | "anthropic") => {
    const defaults = { google: "gemini-2.5-flash", openai: "gpt-4.1-mini", anthropic: "claude-haiku-4-5" } as const;
    llm = { provider: p, model: clean(process.env.UNDERTOW_LLM_MODEL) ?? defaults[p] };
  };
  if (preferred === "google" && google) pick("google");
  else if (preferred === "openai" && openai) pick("openai");
  else if (preferred === "anthropic" && anthropic) pick("anthropic");
  else if (google) pick("google");
  else if (openai) pick("openai");
  else if (anthropic) pick("anthropic");

  return {
    qlooApiKey: clean(process.env.QLOO_API_KEY),
    qlooBaseUrl: clean(process.env.QLOO_BASE_URL) ?? "https://hackathon.api.qloo.com",
    ticketmasterApiKey: clean(process.env.TICKETMASTER_API_KEY),
    llm,
    forceDemo: process.env.UNDERTOW_FORCE_DEMO === "1",
  };
}

export interface PublicStatus {
  liveAvailable: boolean;
  qloo: boolean;
  ticketmaster: boolean;
  agent: boolean;
  llmProvider: string | null;
}

export function publicStatus(): PublicStatus {
  const c = getConfig();
  const live = !c.forceDemo && !!c.qlooApiKey && !!c.ticketmasterApiKey;
  return {
    liveAvailable: live,
    qloo: !!c.qlooApiKey,
    ticketmaster: !!c.ticketmasterApiKey,
    agent: !!c.llm,
    llmProvider: c.llm?.provider ?? null,
  };
}
