/**
 * Exercises the MCP handler over HTTP JSON-RPC (Streamable HTTP, stateless),
 * the same way an MCP client would, using the fictional demo provider.
 */
import { describe, expect, it } from "vitest";
import { createDemoProvider, DEMO_DATES, DEMO_MARKET, DEMO_TARGET } from "@/lib/demo/provider";
import { createTidateMcpHandler } from "@/lib/mcp/server";

const handler = createTidateMcpHandler(() => ({ provider: createDemoProvider(), note: "[DEMO DATA]" }));
const PROTOCOL = "2025-06-18";

async function rpc(method: string, params: unknown, id = 1) {
  const res = await handler(
    new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": PROTOCOL,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    }),
  );
  const raw = await res.text();
  // Responses may be plain JSON or a single SSE `data:` frame.
  const dataLine = raw.split("\n").find((l) => l.startsWith("data:"));
  const body = JSON.parse(dataLine ? dataLine.slice(5) : raw);
  return { status: res.status, body };
}

async function init() {
  return rpc("initialize", { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "tidate-test", version: "0" } }, 0);
}

describe("MCP server", () => {
  it("initializes and lists the Tidate tools", async () => {
    const i = await init();
    expect(i.status).toBe(200);
    expect(i.body.result.serverInfo.name).toBe("tidate");
    const list = await rpc("tools/list", {});
    const names = list.body.result.tools.map((t: { name: string }) => t.name).sort();
    expect(names).toEqual(["find_artist", "find_best_nights", "list_markets", "score_candidate_dates"]);
    const score = list.body.result.tools.find((t: { name: string }) => t.name === "score_candidate_dates");
    expect(score.inputSchema.required).toEqual(expect.arrayContaining(["artist", "marketId", "candidateDates"]));
  });

  it("scores candidate dates with the shared engine and returns structured evidence", async () => {
    await init();
    const r = await rpc("tools/call", {
      name: "score_candidate_dates",
      arguments: { artist: DEMO_TARGET, marketId: DEMO_MARKET, candidateDates: DEMO_DATES, mode: "demo" },
    });
    const result = r.body.result;
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent.recommendation).toBe("2027-05-08");
    expect(result.structuredContent.dates).toHaveLength(3);
    expect(result.content[0].text).toMatch(/DEMO DATA/);
  });

  it("rejects invalid input with an error rather than a score", async () => {
    await init();
    const bad = await rpc("tools/call", { name: "score_candidate_dates", arguments: { artist: DEMO_TARGET, marketId: DEMO_MARKET, candidateDates: ["not-a-date"] } });
    const isErr = bad.body.error !== undefined || bad.body.result?.isError === true;
    expect(isErr).toBe(true);
    const missing = await rpc("tools/call", { name: "score_candidate_dates", arguments: { artist: DEMO_TARGET } });
    expect(missing.body.error !== undefined || missing.body.result?.isError === true).toBe(true);
  });

  it("searches a range of nights", async () => {
    await init();
    const r = await rpc("tools/call", {
      name: "find_best_nights",
      arguments: { artist: DEMO_TARGET, marketId: DEMO_MARKET, from: "2027-05-01", to: "2027-05-29", mode: "demo" },
    });
    const sc = r.body.result.structuredContent;
    expect(r.body.result.isError).toBeFalsy();
    expect(sc.nightsScored).toBe(9);
    expect(sc.bestNights).toHaveLength(3);
    expect(sc.allNights.map((n: { rank: number }) => n.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("reports ambiguity through find_artist", async () => {
    await init();
    const r = await rpc("tools/call", { name: "find_artist", arguments: { name: "Echo" } });
    expect(r.body.result.structuredContent.match).toBe("ambiguous");
  });
});
