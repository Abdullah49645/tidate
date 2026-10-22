# Implementation log

Concise record so work can resume without context. Newest first.

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
