import { connection } from "next/server";
import { publicStatus } from "@/lib/config";
import { SCORING_VERSION } from "@/lib/scoring/engine";

/** Health and configuration check. Reports which integrations are configured, never their values. */
export async function GET() {
  await connection(); // evaluate at request time, not at build time
  return Response.json({ ok: true, scoringVersion: SCORING_VERSION, ...publicStatus() }, { headers: { "cache-control": "no-store" } });
}
