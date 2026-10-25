import { afterEach, describe, expect, it, vi } from "vitest";
import { DEMO_DATES, DEMO_MARKET, DEMO_TARGET, createDemoProvider } from "@/lib/demo/provider";
import { runAnalysis } from "@/lib/pipeline";
import { noteIsGrounded } from "@/lib/watch/alert";
import { memoryKv, upstashKv } from "@/lib/watch/kv";
import { withMatchCache } from "@/lib/watch/match-cache";
import { createWatchService, type WatchSpec } from "@/lib/watch/service";
import { describeDiff, diffSnapshots, isNotable, makeSnapshot, type Snapshot } from "@/lib/watch/snapshot";

const spec = { kind: "compare", mode: "demo", request: { artist: DEMO_TARGET, marketId: DEMO_MARKET, candidateDates: DEMO_DATES } } as const;

function service(over: { now?: () => Date; alert?: NonNullable<Parameters<typeof createWatchService>[0]>["alert"] } = {}) {
  const kv = memoryKv();
  return {
    kv,
    svc: createWatchService({
      kv,
      provider: (s: WatchSpec, n: number) => createDemoProvider({ revision: n >= 1 ? 1 : 0 }),
      alert: over.alert ?? (async () => null),
      now: over.now ?? (() => new Date("2026-10-26T10:00:00Z")),
    }),
  };
}

async function snap(revision: number): Promise<Snapshot> {
  const out = await runAnalysis(createDemoProvider({ revision }), spec.request);
  if (out.kind !== "result") throw new Error("expected result");
  return makeSnapshot(out.result, "2026-10-26T10:00:00Z");
}

describe("snapshot diff", () => {
  it("reports nothing when nothing changed", async () => {
    const a = await snap(0);
    const d = diffSnapshots(a, await snap(0), "2026-10-26");
    expect(d.changes).toEqual([]);
    expect(isNotable(d)).toBe(false);
    expect(describeDiff(d, DEMO_TARGET)).toEqual(["No changes since the last check."]);
  });

  it("finds the announced show and the cancellation in the demo calendar's next state", async () => {
    const d = diffSnapshots(await snap(0), await snap(1), "2026-10-26");
    const added = d.changes.filter((c) => c.type === "new-show");
    const gone = d.changes.filter((c) => c.type === "show-gone");
    expect(added).toMatchObject([{ eventId: "demo-e18", performer: "Halcyon Drift", date: "2027-05-07" }]);
    expect(gone).toMatchObject([{ eventId: "demo-e15", performer: "Saint Ember", reason: "canceled" }]);
    expect(isNotable(d)).toBe(true);
    const lines = describeDiff(d, DEMO_TARGET);
    expect(lines.some((l) => l.startsWith("New listing: Halcyon Drift at The Foundry Room on 2027-05-07"))).toBe(true);
    expect(lines).toContain("Cancelled: Saint Ember at Riverside Pavilion on 2027-05-24.");
  });

  it("does not report shows that have already happened as removed", async () => {
    const a = await snap(0);
    const b: Snapshot = { ...a, events: Object.fromEntries(Object.entries(a.events).filter(([, e]) => e.d !== "2027-05-01")) };
    const after = diffSnapshots(a, b, "2027-05-02");
    expect(after.changes.filter((c) => c.type === "show-gone")).toEqual([]);
    const before = diffSnapshots(a, b, "2027-04-01");
    expect(before.changes.some((c) => c.type === "show-gone" && c.date === "2027-05-01")).toBe(true);
  });

  it("explains coverage-only changes without calling them notable", async () => {
    const a = await snap(0);
    const d = diffSnapshots(a, { ...a, matched: a.matched + 5 }, "2026-10-26");
    expect(d.changes).toEqual([{ type: "coverage", from: a.matched, to: a.matched + 5 }]);
    expect(isNotable(d)).toBe(false);
    expect(describeDiff(d, DEMO_TARGET)[0]).toMatch(/^5 more acts matched/);
  });
});

describe("watch service (memory store, fictional demo data)", () => {
  it("creates with a baseline, checks, records changes and pins the Qloo entity", async () => {
    let t = new Date("2026-10-26T10:00:00Z");
    const alert = vi.fn(async () => ({ text: "A new show is close to your audience.", model: "test" }));
    const { svc } = service({ now: () => t, alert });
    const w = await svc.create(spec);
    expect(w.id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(w.spec.request.artistEntityId).toBe("demo-juniper-static");
    expect(w.history).toHaveLength(1);
    expect(w.history[0].kind).toBe("baseline");
    expect(w.current.recommendedDate).toBe("2027-05-08");

    // Too soon for a manual check.
    t = new Date("2026-10-26T10:00:01Z");
    await expect(svc.check(w.id, "manual")).rejects.toMatchObject({ code: "too-soon" });

    t = new Date("2026-10-26T10:05:00Z");
    const c = await svc.check(w.id, "manual");
    expect(c.checks).toBe(1);
    expect(c.history[0]).toMatchObject({ kind: "check", trigger: "manual", notable: true, note: { text: "A new show is close to your audience." } });
    expect(alert).toHaveBeenCalledTimes(1);
    expect(c.history[0].lines.join(" ")).toMatch(/Halcyon Drift/);
    // The stored event list stays on the server.
    expect(JSON.stringify(c)).not.toContain('"events"');

    t = new Date("2026-10-26T10:10:00Z");
    const again = await svc.check(w.id, "manual");
    expect(again.history[0]).toMatchObject({ notable: false, lines: ["No changes since the last check."], note: null });
    expect(alert).toHaveBeenCalledTimes(1);
  });

  it("rejects bad input, unknown ids, and ends after the dates pass", async () => {
    let t = new Date("2026-10-26T10:00:00Z");
    const { svc, kv } = service({ now: () => t });
    await expect(svc.create({ ...spec, request: { ...spec.request, candidateDates: ["2027-02-30"] } })).rejects.toMatchObject({ code: "invalid" });
    await expect(svc.get("not-an-id")).rejects.toMatchObject({ code: "invalid" });
    await expect(svc.get("AAAAAAAAAAAAAAAAAAAAAA")).rejects.toMatchObject({ code: "not-found" });
    const w = await svc.create(spec);
    t = new Date("2027-06-01T10:00:00Z");
    await expect(svc.check(w.id, "manual")).rejects.toMatchObject({ code: "ended" });
    expect((await svc.get(w.id)).status).toBe("ended");
    expect(await kv.smembers("tidate:watches")).toEqual([]);
  });

  it("scheduled pass checks only due watches, oldest first, and remove deletes", async () => {
    let t = new Date("2026-10-26T10:00:00Z");
    const { svc } = service({ now: () => t });
    const a = await svc.create(spec);
    t = new Date("2026-10-26T12:00:00Z");
    const b = await svc.create({ ...spec, kind: "discover", request: { artist: DEMO_TARGET, marketId: DEMO_MARKET, from: "2027-05-01", to: "2027-05-29" } });
    t = new Date("2026-10-27T07:00:00Z"); // a is 21 h old, b is 19 h old
    expect(await svc.runDue(10_000)).toMatchObject({ due: 1, checked: 1, notable: 1 });
    expect((await svc.get(a.id)).checks).toBe(1);
    expect((await svc.get(b.id)).checks).toBe(0);
    await svc.remove(b.id);
    await expect(svc.get(b.id)).rejects.toMatchObject({ code: "not-found" });
  });
});

describe("alert grounding", () => {
  it("accepts notes whose numbers all come from the facts", () => {
    const facts = "- New listing: Halcyon Drift at The Foundry Room on 2027-05-07, closer than 64% of acts nearby.";
    expect(noteIsGrounded("Halcyon Drift now plays Fri, May 7, closer than 64% of acts.", facts)).toBe(true);
    expect(noteIsGrounded("Expect 20% fewer sales on May 7.", facts)).toBe(false);
  });
});

describe("shared match cache", () => {
  it("reads earlier searches in one batch and writes new ones once", async () => {
    const kv = memoryKv();
    const base = createDemoProvider();
    const search = vi.spyOn(base, "searchArtists");
    const first = withMatchCache(base, kv);
    await first.prefetchArtists!(["Paper Lanterns", "Iron Choir"]);
    await first.searchArtists("Paper Lanterns");
    await first.searchArtists("Iron Choir");
    expect(search).toHaveBeenCalledTimes(2);
    expect(await first.flushMatches()).toBe(2);

    const second = withMatchCache(base, kv);
    await second.prefetchArtists!(["paper lanterns", "Iron Choir"]);
    const hit = await second.searchArtists("Paper Lanterns");
    expect(hit[0].name).toBe("Paper Lanterns");
    expect(search).toHaveBeenCalledTimes(2); // served from the store
    expect(await second.flushMatches()).toBe(0);
  });
});

describe("Upstash REST client (mocked fetch)", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("sends commands as JSON arrays with the bearer token and batches writes through /pipeline", async () => {
    const calls: { url: string; body: unknown; auth: string | null }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string);
        calls.push({ url, body, auth: new Headers(init.headers).get("authorization") });
        const result = url.endsWith("/pipeline") ? body.map(() => ({ result: "OK" })) : { result: body[0] === "MGET" ? body.slice(1).map(() => null) : "OK" };
        return new Response(JSON.stringify(result), { status: 200 });
      }),
    );
    const kv = upstashKv("https://example.upstash.io/", "tok");
    await kv.set("k", "v", 60);
    await kv.mget(["a", "b"]);
    await kv.setMany([{ key: "x", value: "1", ttlSeconds: 5 }]);
    expect(calls[0]).toEqual({ url: "https://example.upstash.io", body: ["SET", "k", "v", "EX", 60], auth: "Bearer tok" });
    expect(calls[1].body).toEqual(["MGET", "a", "b"]);
    expect(calls[2]).toMatchObject({ url: "https://example.upstash.io/pipeline", body: [["SET", "x", "1", "EX", 5]] });
  });
});
