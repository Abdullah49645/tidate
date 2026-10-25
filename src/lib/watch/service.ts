import { randomBytes } from "node:crypto";
import { z } from "zod";
import { createDemoProvider } from "../demo/provider";
import { getMarket } from "../markets";
import { hydrateResult, runAnalysis, runDiscovery, type DataProvider, type PipelineOutcome } from "../pipeline";
import { createLiveProvider } from "../providers";
import { IsoDate } from "../types";
import { writeAlert, type AlertNote } from "./alert";
import { getKv, type Kv } from "./kv";
import { withMatchCache } from "./match-cache";
import { describeDiff, diffSnapshots, isNotable, makeSnapshot, type Change, type Robustness, type Snapshot } from "./snapshot";

/**
 * Watches: a saved request that is re-checked on a schedule (and on demand).
 * Each check runs the same pipeline and engine as the web app, compares a
 * compact snapshot with the previous one, and records what changed.
 */

const WATCH_TTL_SECONDS = 120 * 24 * 3600;
const MIN_MANUAL_GAP_MS = 60_000;
const SCHEDULE_GAP_MS = 20 * 3600 * 1000;
const HISTORY_LIMIT = 40;
const MAX_WATCHES = 500;

const idx = "tidate:watches";
const keyOf = (id: string) => `tidate:watch:${id}`;
export const WATCH_ID = /^[A-Za-z0-9_-]{22}$/;

export const WatchSpecSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("compare"),
    mode: z.enum(["live", "demo"]),
    request: z.object({
      artist: z.string().trim().min(1).max(120),
      artistEntityId: z.string().trim().min(1).max(80).optional(),
      marketId: z.string(),
      candidateDates: z.array(IsoDate).min(1).max(4),
      radiusMiles: z.number().int().min(5).max(100).default(30),
    }),
  }),
  z.object({
    kind: z.literal("discover"),
    mode: z.enum(["live", "demo"]),
    request: z.object({
      artist: z.string().trim().min(1).max(120),
      artistEntityId: z.string().trim().min(1).max(80).optional(),
      marketId: z.string(),
      from: IsoDate,
      to: IsoDate,
      nights: z.enum(["fri-sat", "thu-sat", "all"]).default("fri-sat"),
      radiusMiles: z.number().int().min(5).max(100).default(30),
    }),
  }),
]);
export type WatchSpec = z.infer<typeof WatchSpecSchema>;

export interface HistoryEntry {
  at: string;
  kind: "baseline" | "check";
  trigger: "created" | "manual" | "schedule";
  recommendedDate: string | null;
  lines: string[];
  changes: Change[];
  notable: boolean;
  note: AlertNote | null;
}

export interface Watch {
  id: string;
  createdAt: string;
  spec: WatchSpec;
  artist: string;
  market: { id: string; label: string };
  status: "active" | "ended";
  lastCheckedAt: string;
  checks: number;
  snapshot: Snapshot;
  history: HistoryEntry[];
}

/** What the browser sees: everything except the stored event list. */
export interface WatchView {
  id: string;
  createdAt: string;
  spec: WatchSpec;
  artist: string;
  market: { id: string; label: string };
  status: "active" | "ended";
  lastCheckedAt: string;
  checks: number;
  current: {
    recommendedDate: string | null;
    robustness: Robustness;
    headcountBest: string | null;
    matched: number;
    performers: number;
    dates: Snapshot["dates"];
  };
  history: HistoryEntry[];
  storage: Kv["kind"];
  nextScheduledAfter: string;
}

export class WatchError extends Error {
  constructor(
    message: string,
    public readonly code: "not-found" | "invalid" | "too-soon" | "failed" | "limit" | "ended",
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

export interface WatchDeps {
  kv?: Kv;
  /** Provider override (tests). */
  provider?: (spec: WatchSpec, checksSoFar: number) => WatchProvider;
  /** Alert writer override (tests); defaults to the configured model, if any. */
  alert?: typeof writeAlert;
  now?: () => Date;
}

type WatchProvider = DataProvider & { flushMatches?(): Promise<number> };

function defaultProvider(kv: Kv) {
  return (spec: WatchSpec, checksSoFar: number): WatchProvider => {
    // Demo: the fictional calendar moves on after the baseline so an alert can be shown.
    if (spec.mode === "demo") return createDemoProvider({ revision: checksSoFar >= 1 ? 1 : 0 });
    const live = createLiveProvider();
    return withMatchCache({ ...live, resolveBudgetMs: 22_000, discoverBudgetMs: 30_000 }, kv);
  };
}

async function run(spec: WatchSpec, provider: DataProvider): Promise<PipelineOutcome> {
  return spec.kind === "discover" ? runDiscovery(provider, spec.request) : runAnalysis(provider, spec.request);
}

function todayIn(marketId: string, now: Date) {
  const tz = getMarket(marketId)?.timezone ?? "UTC";
  return now.toLocaleDateString("en-CA", { timeZone: tz });
}

function lastDate(spec: WatchSpec) {
  return spec.kind === "discover" ? spec.request.to : [...spec.request.candidateDates].sort().at(-1)!;
}

export function toView(w: Watch, storage: Kv["kind"]): WatchView {
  const { snapshot, ...rest } = w;
  return {
    ...rest,
    current: {
      recommendedDate: snapshot.recommendedDate,
      robustness: snapshot.robustness,
      headcountBest: snapshot.headcountBest,
      matched: snapshot.matched,
      performers: snapshot.performers,
      dates: snapshot.dates,
    },
    storage,
    nextScheduledAfter: new Date(Date.parse(w.lastCheckedAt) + SCHEDULE_GAP_MS).toISOString(),
  };
}

export function createWatchService(deps: WatchDeps = {}) {
  const kv = deps.kv ?? getKv();
  const providerFor = deps.provider ?? defaultProvider(kv);
  const alert = deps.alert ?? writeAlert;
  const now = deps.now ?? (() => new Date());

  async function load(id: string): Promise<Watch> {
    if (!WATCH_ID.test(id)) throw new WatchError("Not a watch id.", "invalid");
    const raw = await kv.get(keyOf(id));
    if (!raw) throw new WatchError("This watch doesn't exist or has been removed.", "not-found");
    return JSON.parse(raw) as Watch;
  }

  async function save(w: Watch) {
    await kv.set(keyOf(w.id), JSON.stringify(w), WATCH_TTL_SECONDS);
  }

  async function analyse(spec: WatchSpec, checksSoFar: number) {
    const provider = providerFor(spec, checksSoFar);
    const out = await run(spec, provider);
    await provider.flushMatches?.();
    if (out.kind === "result") return hydrateResult(out.result);
    throw new WatchError(out.kind === "clarify" ? out.message : out.kind === "invalid" ? out.issues.join("; ") : out.message, out.kind === "invalid" ? "invalid" : "failed");
  }

  return {
    storage: kv.kind,

    async create(input: unknown): Promise<WatchView> {
      const parsed = WatchSpecSchema.safeParse(input);
      if (!parsed.success) throw new WatchError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "), "invalid");
      const ids = await kv.smembers(idx);
      if (ids.length >= MAX_WATCHES) throw new WatchError("This deployment is watching as many dates as it can. Try again later.", "limit");
      const result = await analyse(parsed.data, 0);
      // Pin the artist to the Qloo entity the baseline resolved, so later checks can't drift to a namesake.
      const spec: WatchSpec = { ...parsed.data, request: { ...parsed.data.request, artistEntityId: result.target.entity!.entityId, artist: result.target.entity!.name } } as WatchSpec;
      const at = now().toISOString();
      const snapshot = makeSnapshot(result, at);
      const w: Watch = {
        id: randomBytes(16).toString("base64url"),
        createdAt: at,
        spec,
        artist: result.target.entity!.name,
        market: result.market,
        status: "active",
        lastCheckedAt: at,
        checks: 0,
        snapshot,
        history: [
          {
            at,
            kind: "baseline",
            trigger: "created",
            recommendedDate: snapshot.recommendedDate,
            lines: [
              `Started watching ${snapshot.dates.length} ${snapshot.dates.length === 1 ? "date" : "dates"}${snapshot.recommendedDate && snapshot.dates.length > 1 ? `; best night ${snapshot.recommendedDate}` : ""}.`,
              `${Object.keys(snapshot.events).length} shows nearby, ${snapshot.matched} of ${snapshot.performers} acts matched in Qloo.`,
            ],
            changes: [],
            notable: false,
            note: null,
          },
        ],
      };
      await save(w);
      await kv.sadd(idx, w.id);
      return toView(w, kv.kind);
    },

    async get(id: string): Promise<WatchView> {
      return toView(await load(id), kv.kind);
    },

    async check(id: string, trigger: "manual" | "schedule"): Promise<WatchView> {
      const w = await load(id);
      const t = now();
      if (w.status === "ended") throw new WatchError("These dates have passed, so the watch has ended.", "ended");
      if (todayIn(w.market.id, t) > lastDate(w.spec)) {
        w.status = "ended";
        await save(w);
        await kv.srem(idx, w.id);
        throw new WatchError("These dates have passed, so the watch has ended.", "ended");
      }
      const since = t.getTime() - Date.parse(w.lastCheckedAt);
      // Vercel may deliver a scheduled run twice; a watch checked recently is skipped.
      if (trigger === "schedule" && since < SCHEDULE_GAP_MS) throw new WatchError("Checked recently.", "too-soon");
      // Live checks call Qloo and Ticketmaster, so they are spaced out; demo checks cost nothing.
      const gap = w.spec.mode === "demo" ? 3_000 : MIN_MANUAL_GAP_MS;
      if (trigger === "manual" && since < gap) {
        throw new WatchError("Checked a moment ago. Try again shortly.", "too-soon", Math.ceil((gap - since) / 1000));
      }
      const result = await analyse(w.spec, w.checks + 1);
      const at = t.toISOString();
      const next = makeSnapshot(result, at);
      const diff = diffSnapshots(w.snapshot, next, todayIn(w.market.id, t));
      const lines = describeDiff(diff, w.artist);
      const notable = isNotable(diff);
      const note = notable ? await alert({ artist: w.artist, market: w.market.label, lines }).catch(() => null) : null;
      w.history = [{ at, kind: "check" as const, trigger, recommendedDate: next.recommendedDate, lines, changes: diff.changes, notable, note }, ...w.history].slice(0, HISTORY_LIMIT);
      w.snapshot = next;
      w.lastCheckedAt = at;
      w.checks += 1;
      await save(w);
      return toView(w, kv.kind);
    },

    async remove(id: string): Promise<void> {
      await load(id);
      await kv.del(keyOf(id));
      await kv.srem(idx, id);
    },

    /**
     * Scheduled pass: check the watches that are due, oldest first, until the
     * time budget runs low. Watches not reached are picked up next time.
     */
    async runDue(budgetMs: number) {
      const started = Date.now();
      const ids = await kv.smembers(idx);
      const raw = ids.length ? await kv.mget(ids.map(keyOf)) : [];
      const t = now().getTime();
      const due = raw
        .map((r, i) => (r ? (JSON.parse(r) as Watch) : (void kv.srem(idx, ids[i]), null)))
        .filter((w): w is Watch => !!w && w.status === "active" && t - Date.parse(w.lastCheckedAt) >= SCHEDULE_GAP_MS)
        .sort((a, b) => a.lastCheckedAt.localeCompare(b.lastCheckedAt));
      const report = { due: due.length, checked: 0, notable: 0, ended: 0, failed: 0 };
      for (const w of due) {
        if (Date.now() - started > budgetMs) break;
        try {
          const v = await this.check(w.id, "schedule");
          report.checked += 1;
          if (v.history[0]?.notable) report.notable += 1;
        } catch (err) {
          if (err instanceof WatchError && err.code === "ended") report.ended += 1;
          else if (!(err instanceof WatchError && err.code === "too-soon")) report.failed += 1;
        }
      }
      return report;
    },
  };
}
