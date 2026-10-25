# Implementation log

Concise record so work can resume without context. Newest first.

## 2026-10-26

**State:** app features added on top of the 2026-10-23 build; still local only.

Done
- Find a night: range + nights of the week (fri-sat / thu-sat / all, 2–40 nights,
  ≤70 days). `runDiscovery` in the pipeline, `kind: "discover"` on /api/analyze,
  agent tool `find_best_nights`, MCP tool `find_best_nights`. Calendar heatmap with
  best three, headcount's pick, skip-a-night re-ranking, quiet-night caution.
- Provisional ranking streamed during performer lookups (affinities reused).
- Lookup order by summed timing weight; Qloo pacing 5 concurrent / 110 ms; night
  search budget 45 s (UNDERTOW_DISCOVER_BUDGET_MS).
- Ticketmaster windows over 1,000 results split recursively (New York 10 weeks: 2,495).
- Shared taste via Qloo /entities tags (genre/lineage/influences only) and fan map
  via Qloo heatmap (POINT + radius); both display-only. /api/taste, /api/fanmap.
- Compact transport for night searches (contributions rebuilt in the browser).
- Tests: 74 passing (discovery, compaction round trip, provisional, taste, fan map,
  TM split, agent + MCP night search).

Live checks (Nashville, Kirk Franklin, Nov 13 – Dec 31, Fridays and Saturdays)
- Cold run 48 s, about 310 of 473 performers looked up; provisional rankings
  every ~3 s. Dec 25/26 come out quietest for every method and get the
  quiet-night caution; skipping them makes Nov 13 the pick, where headcount picks Dec 19.

On hold (user's call): watchlist / alerts agent.

## 2026-10-23

**State:** live integrations verified; evaluation run; UI redesigned (Apple-style);
not pushed to GitHub (name is a placeholder; user asked to hold).

Done
- Live validation (docs/API_VALIDATION.md). Key finding: Qloo artist affinity is
  compressed (unrelated ~0.74, near-identical ~0.98) -> scoring v1.2.0 uses
  rank among nearby acts ^4 for weighting; raw value still shown.
- Two-tier robustness (worst case + typical act), closest-first lookups with a
  25 s budget, shared `use cache: remote` cache for Qloo search (second run ~10 s),
  title fallback and bill splitting for Ticketmaster listings, (date, headliner) de-dup.
- Qloo throttling: 8 req/s, 4 retries honouring x-second-ratelimit-reset.
- Gemini: key #1 blocked (403); keys #2/#3 work on gemini-3.5-flash. Agent rotates
  keys x models on 401/403/404/429/5xx; answers in plain text.
- Evaluation (docs/EVALUATION.md): E1 AUC 0.618 [0.590, 0.647] vs popularity 0.556;
  E2 Qloo changes the recommendation in 27% of 150 scenarios; E3 insufficient (11 < 30).

Next
1. Pick the final name; then push and deploy on Vercel (env vars from .env.example).
2. Verify `/api/status`, a live analysis and `/api/mcp` on the deployed URL.
3. Devpost write-up from docs/SUBMISSION.md, with the evaluation numbers.

## 2026-10-22

**State:** core product complete in demo mode; live validation, evaluation and
deployment blocked on keys.

Done
- Verified official rules (Devpost page): deadline Oct 30 2026 11:45pm EDT; public
  hosted demo; public repo with OSS license in About; no video required; agentic
  requirement met by agent framework or agentic tool. Judging criteria listed
  without weights.
- Verified Qloo hackathon guide: base `https://hackathon.api.qloo.com`, header
  `X-Api-Key`, GET `/v2/insights`, `/search`; artist params include
  `signal.interests.entities`, `filter.results.entities` (documented for affinity),
  `take` ≤ 50; no `signal.location` for artists; heatmaps via `urn:heatmap`.
  Private caching allowed; no Qloo data in public repo. Entity response schema is
  untyped in the OpenAPI spec, so field names are confirmed only by live calls.
- Verified Ticketmaster: `apikey` param, 5 req/s and 5000/day, `size*page < 1000`,
  status codes onsale/offsale/canceled/postponed/rescheduled, cache only for a
  reasonable period, may throttle non-user-triggered traffic.
- Built engine (+ property tests), clients, resolution policy, pipeline with NDJSON
  progress, demo provider (fictional), agent (AI SDK v7 ToolLoopAgent), MCP
  (mcp-handler 2.x), UI, docs, pre-registered evaluation and scripts.
- Fixed: counterfactual "would rank first" claims now remove a show from every
  date (previously only one), verified by re-scoring tests.

Next
1. Add keys to `.env.local`; run `npm run validate:live`; confirm Qloo field names
   (`entity_id`, `popularity`, `query.affinity`) and affinity scale; update
   parsers and docs/API_VALIDATION.md if they differ.
2. Live end-to-end run in the UI; tune nothing on outcomes.
3. `npm run eval:collect` then `npm run eval:run`; write results into
   docs/EVALUATION.md exactly as observed.
4. Agent with a real LLM; check tool use and answer verification.
5. Push to GitHub, deploy on Vercel, verify `/api/status` and `/api/mcp` live.
