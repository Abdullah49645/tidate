import type { AnalysisResult } from "../types";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Ways a model might write a YYYY-MM-DD date in prose. */
export function dateMentions(iso: string): string[] {
  const m = +iso.slice(5, 7);
  const d = +iso.slice(8, 10);
  const full = MONTHS[m - 1];
  const short = full.slice(0, 3);
  return [iso, `${full} ${d}`, `${short} ${d}`, `${short}. ${d}`, `${d} ${full}`, `${d} ${short}`, `${m}/${d}`];
}

export interface Verification {
  text: string;
  checked: boolean;
  mentionsRecommendation: boolean;
  corrected: boolean;
}

/**
 * Deterministic guard on the agent's final answer. If an analysis exists, the
 * answer must name the engine's recommended date; otherwise an authoritative
 * note is appended. The UI always renders the engine's verdict separately.
 */
export function verifyAgentAnswer(text: string, analysis: AnalysisResult | null): Verification {
  const rec = analysis?.verdict.recommendedDate;
  if (!analysis || !rec) return { text, checked: false, mentionsRecommendation: false, corrected: false };
  const mentions = dateMentions(rec).some((s) => {
    const esc = s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
    return new RegExp(`(?<![0-9])${esc}(?![0-9])`, "i").test(text);
  });
  if (mentions) return { text, checked: true, mentionsRecommendation: true, corrected: false };
  return {
    text: `${text.trim()}\n\nEngine result: the lowest estimated clash risk is ${rec}. ${analysis.verdict.summary}`,
    checked: true,
    mentionsRecommendation: false,
    corrected: true,
  };
}
