import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Request                                                             */
/* ------------------------------------------------------------------ */

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const IsoDate = z
  .string()
  .regex(ISO_DATE, "Use YYYY-MM-DD")
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "Not a real calendar date");

export const AnalysisRequestSchema = z.object({
  artist: z.string().trim().min(1, "Artist is required").max(120),
  /** Confirmed Qloo entity id for the target act (skips name resolution). */
  artistEntityId: z.string().trim().min(1).max(80).optional(),
  marketId: z.string().trim().min(1),
  candidateDates: z
    .array(IsoDate)
    .min(1, "Add at least one candidate date")
    .max(4, "Compare at most four dates")
    .refine((a) => new Set(a).size === a.length, "Candidate dates must be distinct"),
  /** Search radius around the market centre, in miles. */
  radiusMiles: z.number().int().min(5).max(100).default(30),
});
export type AnalysisRequest = z.infer<typeof AnalysisRequestSchema>;
export type AnalysisRequestInput = z.input<typeof AnalysisRequestSchema>;

/** Which nights of the week a date search considers. */
export const NIGHTS = {
  "fri-sat": { label: "Fridays and Saturdays", plural: "Fridays and Saturdays", days: [5, 6] },
  "thu-sat": { label: "Thursdays to Saturdays", plural: "Thursday to Saturday nights", days: [4, 5, 6] },
  all: { label: "Every night", plural: "nights", days: [0, 1, 2, 3, 4, 5, 6] },
} as const;
export type NightsId = keyof typeof NIGHTS;

export const MAX_DISCOVER_NIGHTS = 40;
export const MAX_DISCOVER_SPAN_DAYS = 70;

/** The nights between two dates (inclusive) that fall on the chosen weekdays. */
export function candidateNights(from: string, to: string, nights: NightsId): string[] {
  const days: readonly number[] = NIGHTS[nights].days;
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d <= end && out.length <= MAX_DISCOVER_NIGHTS) {
    if (days.includes(d.getUTCDay())) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export const DiscoverRequestSchema = z
  .object({
    artist: z.string().trim().min(1, "Artist is required").max(120),
    artistEntityId: z.string().trim().min(1).max(80).optional(),
    marketId: z.string().trim().min(1),
    from: IsoDate,
    to: IsoDate,
    nights: z.enum(["fri-sat", "thu-sat", "all"]).default("fri-sat"),
    radiusMiles: z.number().int().min(5).max(100).default(30),
  })
  .refine((r) => r.from <= r.to, { message: "The range must end after it starts", path: ["to"] })
  .refine((r) => (Date.parse(r.to) - Date.parse(r.from)) / 86_400_000 <= MAX_DISCOVER_SPAN_DAYS, {
    message: `Search at most ${MAX_DISCOVER_SPAN_DAYS} days at a time`,
    path: ["to"],
  })
  .refine((r) => candidateNights(r.from, r.to, r.nights).length >= 2, { message: "The range needs at least two matching nights", path: ["nights"] })
  .refine((r) => candidateNights(r.from, r.to, r.nights).length <= MAX_DISCOVER_NIGHTS, {
    message: `That's more than ${MAX_DISCOVER_NIGHTS} nights. Narrow the range or the nights of the week`,
    path: ["nights"],
  });
export type DiscoverRequest = z.infer<typeof DiscoverRequestSchema>;
export type DiscoverRequestInput = z.input<typeof DiscoverRequestSchema>;

/* ------------------------------------------------------------------ */
/* Provenance                                                          */
/* ------------------------------------------------------------------ */

export type DataSource = "ticketmaster" | "qloo" | "demo-fixture";

export interface Provenance {
  source: DataSource;
  retrievedAt: string; // ISO timestamp
  /** Human-readable description of the call made (no secrets). */
  request: string;
}

/* ------------------------------------------------------------------ */
/* Entities                                                            */
/* ------------------------------------------------------------------ */

export type MatchStatus =
  | "not-checked" // skipped: lookup time budget reached
  | "exact" // normalised names identical, single top candidate
  | "confirmed" // user explicitly confirmed this entity
  | "ambiguous" // several plausible candidates
  | "weak" // best candidate's name differs materially
  | "not-found"
  | "error";

export interface ArtistCandidate {
  entityId: string;
  name: string;
  popularity: number | null;
  disambiguation: string | null;
}

export interface ArtistResolution {
  inputName: string;
  status: MatchStatus;
  entity: ArtistCandidate | null;
  candidates: ArtistCandidate[];
  provenance: Provenance;
  note?: string;
}

export type EventStatus =
  | "onsale"
  | "offsale"
  | "canceled"
  | "postponed"
  | "rescheduled"
  | "unknown";

export interface Performer {
  /** Ticketmaster attraction id when available. */
  attractionId: string | null;
  name: string;
  /** Ticketmaster genre label, if present (used only for evaluation/display). */
  genre: string | null;
  /** True when Ticketmaster listed no performer and the name was taken from the event title. */
  fromTitle?: boolean;
  /** True when this act was split out of a multi-act bill listed as one name. */
  fromSplit?: boolean;
}

export interface CompetingEvent {
  eventId: string;
  name: string;
  url: string | null;
  localDate: string | null; // YYYY-MM-DD in venue local time; null when TBA/TBD
  localTime: string | null;
  status: EventStatus;
  venue: {
    id: string | null;
    name: string;
    city: string | null;
    lat: number | null;
    lng: number | null;
  };
  performers: Performer[];
  genre: string | null;
  provenance: Provenance;
}

export interface AffinitySignal {
  entityId: string;
  /** Qloo query.affinity for this entity given the target-artist signal. */
  affinity: number | null;
  /** Qloo global popularity percentile (0..1). */
  popularity: number | null;
  provenance: Provenance;
}

/* ------------------------------------------------------------------ */
/* Scoring                                                             */
/* ------------------------------------------------------------------ */

export type ExclusionReason =
  | "target-act" // the target artist's own show
  | "canceled"
  | "postponed" // no reliable date
  | "date-tba"
  | "duplicate"
  | "outside-window";

export type UncertaintyFlag =
  | "unresolved-performer" // no confident Qloo match
  | "affinity-missing" // Qloo returned no affinity for the matched entity
  | "popularity-imputed" // popularity missing -> neutral value used
  | "rescheduled"; // event carries a rescheduled status

export interface Contribution {
  candidateDate: string;
  eventId: string;
  eventName: string;
  eventDate: string;
  venueName: string;
  /** Performer used for scoring (highest affinity x popularity), if any. */
  performer: string | null;
  qlooEntityId: string | null;
  daysApart: number;
  temporalWeight: number;
  /** Raw Qloo affinity. */
  affinity: number | null;
  /** Percentile of the raw affinity among matched acts in the market window. */
  relativeAffinity: number | null;
  /** Affinity value actually used in the product (relative when available, else raw). */
  affinityWeight: number | null;
  popularity: number | null;
  /** Popularity value actually used (imputed if missing). */
  sizeWeight: number | null;
  /** affinity * sizeWeight * temporalWeight; null when not scoreable. */
  contribution: number | null;
  /** Worst-case contribution used for the robustness bound when not scoreable. */
  upperBound: number;
  /** Contribution if an unscored show were as close as a typical matched act. */
  typicalEstimate: number;
  scored: boolean;
  flags: UncertaintyFlag[];
}

export type EvidenceQuality = "strong" | "partial" | "weak" | "no-competition-found";

export interface DateScore {
  date: string;
  score: number; // sum of scored contributions
  upperBound: number; // score + worst case for unscored in-window events
  typicalScore: number; // score + typical-act estimate for unscored in-window events
  rank: number; // 1 = lowest clash risk
  baselineCount: number; // events with temporalWeight > 0 (unweighted)
  baselineWeighted: number; // sum of temporal weights (count baseline, same window)
  baselineRank: number;
  inWindowEvents: number;
  scoredEvents: number;
  evidence: EvidenceQuality;
  contributions: Contribution[]; // sorted by contribution desc
  explanation: string;
}

export interface RankingVerdict {
  recommendedDate: string | null;
  /** True when the recommendation holds even if every unscored event were worst-case. */
  robust: boolean;
  /** True when it holds if unscored events were as close as a typical matched act. */
  holdsIfTypical: boolean;
  /** Score margin between the recommended date and the runner-up. */
  margin: number | null;
  baselineAgrees: boolean;
  summary: string;
  whatWouldChange: string[];
}

export interface ExcludedEvent {
  eventId: string;
  name: string;
  localDate: string | null;
  reason: ExclusionReason;
}

export interface AnalysisResult {
  version: string;
  mode: "live" | "demo";
  request: AnalysisRequest;
  /** Present when the dates were found by searching a range rather than given. */
  discover?: { from: string; to: string; nights: NightsId };
  /**
   * True when per-show contributions were left out of the payload (date searches
   * score many nights). The client re-scores from events, resolutions and affinities.
   */
  compact?: boolean;
  market: { id: string; label: string };
  target: ArtistResolution;
  window: { start: string; end: string };
  events: CompetingEvent[];
  resolutions: Record<string, ArtistResolution>; // keyed by normalised performer name
  affinities: Record<string, AffinitySignal>; // keyed by Qloo entity id
  excluded: ExcludedEvent[];
  dates: DateScore[];
  verdict: RankingVerdict;
  diagnostics: Diagnostic[];
  generatedAt: string;
}

export interface Diagnostic {
  level: "info" | "warning" | "error";
  code: string;
  message: string;
}

/* ------------------------------------------------------------------ */
/* Context (display only; never part of the score)                     */
/* ------------------------------------------------------------------ */

/** A Qloo tag attached to an artist entity. */
export interface TasteTag {
  id: string;
  name: string;
  /** Qloo tag type, e.g. urn:tag:genre:qloo. */
  type: string;
}

/** Tags two artists share in Qloo, limited to genre, style lineage and influences. */
export interface SharedTaste {
  entityId: string;
  shared: { name: string; kind: "genre" | "influence" }[];
  /** True when Qloo returned tags for both artists (so "none shared" is a real finding). */
  checked: boolean;
}

/** One Qloo heatmap cell: where the target artist's audience is relatively concentrated. */
export interface HeatCell {
  lat: number;
  lng: number;
  geohash: string;
  /** Qloo heatmap affinity for the target artist (0..1, rank-normalised within the area). */
  affinity: number;
}

/** A ranking computed from the lookups finished so far, streamed while the rest run. */
export interface ProvisionalRanking {
  checked: number;
  total: number;
  dates: { date: string; score: number; rank: number; scoredEvents: number }[];
}
