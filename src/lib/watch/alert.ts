import "server-only";
import { generateText, type LanguageModel } from "ai";
import { isRouteError, modelFor } from "../agent/agent";
import { getConfig } from "../config";

const SYSTEM = `You write short alerts for a concert promoter who is watching candidate dates for an artist.
Use only the facts you are given; never add shows, numbers, reasons or advice that are not in them.
At most two short sentences and 45 words, plain text, no markdown. Lead with what matters most for choosing a date: a change of best night, then cancelled or new shows close to the artist's audience. Write dates like "Sat, May 8".`;

export interface AlertNote {
  text: string;
  model: string | null;
}

/**
 * Accept the model's note only if every number in it appears in the facts it
 * was given (dates included). Otherwise the deterministic lines are used alone.
 */
export function noteIsGrounded(note: string, facts: string): boolean {
  const allowed = new Set<string>();
  for (const n of facts.match(/\d+(?:\.\d+)?/g) ?? []) {
    allowed.add(n);
    allowed.add(String(Number(n))); // "07" in a date may be written "7"
  }
  return (note.match(/\d+(?:\.\d+)?/g) ?? []).every((n) => allowed.has(n) || allowed.has(String(Number(n))));
}

/**
 * A two-sentence summary of a watch check, written by the configured model from
 * the deterministic change list. Returns null when no model is configured, every
 * route fails, or the note mentions a number that isn't in the facts.
 */
export async function writeAlert(opts: { artist: string; market: string; lines: string[]; model?: LanguageModel }): Promise<AlertNote | null> {
  const facts = `Artist: ${opts.artist}. Market: ${opts.market}.\n${opts.lines.map((l) => `- ${l}`).join("\n")}`;
  const routes = opts.model ? [null] : getConfig().llmRoutes;
  for (const r of routes) {
    try {
      const res = await generateText({
        model: opts.model ?? modelFor(r!),
        system: SYSTEM,
        prompt: `Changes since the last check:\n${facts}`,
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(15_000),
      });
      const text = res.text.trim().replace(/\*\*/g, "");
      if (!text) return null;
      return noteIsGrounded(text, facts) ? { text, model: r ? `${r.provider}/${r.model}` : null } : null;
    } catch (err) {
      if (!isRouteError(err)) return null;
    }
  }
  return null;
}
