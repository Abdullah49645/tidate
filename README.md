# Tidate

**Know which nights your crowd is already spoken for.**

Tidate helps concert promoters, talent buyers and artist teams choose between the
dates they can hold, or find the quietest nights in a range. For each candidate date it finds every music event within two
weeks in the same market (Ticketmaster), asks Qloo how strongly each competing act's
audience overlaps with your artist's, and ranks your dates by that pull, with every
number traceable to a specific show, Qloo signal and timing weight.

A plain calendar says *how many* shows are nearby. Tidate says *which ones matter
to your audience*: a night with three metal and country shows can be safer for an
indie-pop act than a night with one same-genre headliner across town.

Built for the [Qloo Agentic Hackathon 2026](https://qloo.devpost.com/).
Repository: https://github.com/Abdullah49645/tidate

---

## How it works

```
 request (artist, market, 1–4 dates)
        │
        ▼
 ┌──────────────┐   ┌──────────────────────┐   ┌──────────────────────┐
 │ validate     │──▶│ resolve artist (Qloo │──▶│ search events        │
 │ (zod)        │   │ /search)             │   │ (Ticketmaster)       │
 └──────────────┘   └──────────────────────┘   └──────────┬───────────┘
                                                          ▼
 ┌──────────────┐   ┌──────────────────────┐   ┌──────────────────────┐
 │ verify &     │◀──│ deterministic engine │◀──│ match performers +   │
 │ explain      │   │ (clash score, count  │   │ Qloo affinity        │
 └──────┬───────┘   │ baseline, bounds)    │   │ (/v2/insights)       │
        │           └──────────────────────┘   └──────────────────────┘
        ▼
  web UI  ·  agent tools  ·  MCP server   (all share the same pipeline)
```

- **Score**: `C(d) = Σ closeness × popularity × timing weight` over nearby shows,
  where closeness is each act's Qloo affinity ranked against the other acts
  playing nearby. See [docs/METHODOLOGY.md](docs/METHODOLOGY.md) and the live
  findings behind it in [docs/API_VALIDATION.md](docs/API_VALIDATION.md).
- **Count baseline**: the same shows and timing weights, each counted alike, shown
  side by side so you can see whether Qloo changes the answer.
- **Evidence**: unmatched performers, missing affinity and imputed popularity are
  flagged per show; evidence quality and worst-case robustness are reported
  separately from the score.
- **What-if**: untick any show to re-rank instantly (the engine runs in the
  browser too).
- **Find a night**: instead of fixed dates, give a range (up to 70 days) and the
  nights of the week. Every matching night (up to 40) is scored by the same engine
  and shown on a shaded calendar with the best three numbered and the headcount's
  pick marked. Nights you can't use (a holiday, a dark venue) can be skipped and
  the ranking updates.
- **Provisional ranking**: while performers are still being matched, the ranking
  from the lookups finished so far streams into the progress panel.
- **Why the overlap**: each show lists the Qloo genres and influences it shares with
  your artist ("Like Kirk Franklin, tagged Rhythm & Blues and Soul"), or says
  plainly that it shares none, which means the overlap is in listeners, not labels.
- **Fan map**: Qloo's heatmap of where your artist's audience is concentrated in the
  market, with the venues pulling most on the chosen night pinned and placed in it.
  The tags and the map are context only; neither changes a score.
- **Watch**: one click turns a result into a watch. It is re-checked once a day (and
  on demand) with the same engine, and a watch page records what changed: new or
  cancelled shows near your dates, a show that moved, a new best night, a change in
  robustness. Each notable change gets a two-sentence summary written by the model
  from the change list and rejected if it mentions any number not in that list.

### Three ways in

1. **Hold sheet (web form)**: runs the pipeline step by step with live progress.
2. **Agent**: ask in plain language ("I can hold May 9, 16 or 23 for Clairo in
   Chicago…" or "find Clairo a Saturday in March"). An AI SDK `ToolLoopAgent` calls
   `find_artist`, `analyze_candidate_dates`, `find_best_nights`, `explain_date`,
   `compare_dates`, `what_if_exclude` and `watch_latest` ("keep an eye on these").
   It never produces numbers itself, and its final answer is checked against the
   engine's recommendation.
3. **MCP server** at `/api/mcp` (Streamable HTTP): tools `score_candidate_dates`,
   `find_best_nights`, `find_artist`, `list_markets` for any MCP client.

## Project layout

```
src/lib/scoring/engine.ts   deterministic scoring, baseline, robustness, counterfactuals
src/lib/pipeline.ts         shared orchestration (live and demo providers)
src/lib/qloo/               Qloo client + entity matching policy
src/lib/ticketmaster/       Ticketmaster Discovery client
src/lib/agent/              agent tools, ToolLoopAgent, answer verification
src/lib/mcp/server.ts       MCP tool definitions
src/lib/demo/provider.ts    fictional demo scenario
src/lib/watch/              watches: store (Upstash REST or memory), snapshots and diffs, alerts
src/lib/context.ts          shared-taste tags and fan map (display only)
src/app/api/*               analyze (NDJSON stream), agent, artists, mcp, status, taste,
                            fanmap, watch (create / get / check / delete / cron)
src/components/             workstation UI
scripts/                    live API validation and evaluation
tests/                      unit, pipeline, agent, MCP tests (no network)
docs/                       methodology, evaluation, prior art, submission notes
```

## Setup

Requirements: Node.js 20+ (developed on 22).

```bash
git clone https://github.com/Abdullah49645/tidate.git
cd tidate
npm install
cp .env.example .env.local   # then fill in keys
npm run dev                  # http://localhost:3000
```

### Configuration

| Variable | Needed for | Where to get it |
| --- | --- | --- |
| `QLOO_API_KEY` | live data | Qloo hackathon key request form; works only with `https://hackathon.api.qloo.com` |
| `TICKETMASTER_API_KEY` | live data | developer.ticketmaster.com → My Apps → Consumer Key |
| `GOOGLE_GENERATIVE_AI_API_KEYS` (comma-separated; or `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`) | conversational agent only | Google AI Studio. Keys and models rotate automatically on 429/503/403 |
| `TIDATE_LOOKUP_BUDGET_MS` | optional | Time budget for Qloo performer lookups (default 30000) |
| `TIDATE_DISCOVER_BUDGET_MS` | optional | Lookup budget for a night search (default 45000) |
| `TIDATE_FORCE_DEMO=1` | optional | forces demo data |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | watches that persist, shared match cache | Vercel → Storage / Marketplace → Upstash Redis (free tier). `UPSTASH_REDIS_REST_URL` / `_TOKEN` also work |
| `CRON_SECRET` | daily watch checks | any random string of 16+ characters; Vercel sends it to the cron route |

Without keys the app runs in **demo mode**: a fictional scenario that is labelled as
fictional everywhere it appears. Live mode is never silently replaced by demo data.
`GET /api/status` reports which integrations are configured (never their values).

## Scripts

```bash
npm test               # unit, pipeline, agent (mock model) and MCP tests; no network
npm run typecheck
npm run lint
npm run build
npm run check          # all of the above
npm run validate:live  # exercises the real Qloo and Ticketmaster operations
npm run eval:collect   # collects evaluation data (live keys required)
npm run eval:run       # runs the pre-registered experiments
```

`validate:live` and `eval:collect` write raw API responses to `.validation/` and
`.eval-data/`, which are gitignored. Qloo data must not be committed.

## Deployment (Vercel)

1. Push this repository to GitHub.
2. In Vercel: **Add New → Project → Import** the repository (framework: Next.js,
   defaults are fine).
3. Add the environment variables above under **Settings → Environment Variables**.
4. For watches: in the project, open **Storage** (or the Marketplace), add
   **Upstash Redis** on the free plan and connect it to the project; it sets
   `KV_REST_API_URL` and `KV_REST_API_TOKEN`. Add `CRON_SECRET`.
5. Deploy. Check `https://<your-app>/api/status`: `liveAvailable: true` means
   both data keys are present, and `watchStorage: "upstash"` means watches persist.

`vercel.json` schedules `/api/watch/cron` once a day (the Hobby plan allows daily
crons and may run them any time within the scheduled hour). Each run checks the
watches not checked in the last 20 hours, oldest first, within the function's time
limit; any not reached are picked up the next day. A repeated delivery is harmless.

API routes declare `maxDuration = 60`; a live analysis typically needs several
seconds because every competing performer is matched in Qloo (results are cached
per server instance).

## Using the MCP server

Point any Streamable HTTP MCP client at `https://<your-app>/api/mcp`:

```json
{ "tidate": { "url": "https://<your-app>/api/mcp" } }
```

For stdio-only clients: `npx mcp-remote https://<your-app>/api/mcp`.
`score_candidate_dates` takes `{ artist, marketId, candidateDates[], artistEntityId?, mode? }`;
`find_best_nights` takes `{ artist, marketId, from, to, nights?, artistEntityId?, mode? }`
with `nights` one of `fri-sat` (default), `thu-sat`, `all`. Both return structured
evidence plus a text summary. Results are labelled as demo
data when the server has no live keys.

## Data provenance

Every result records where each value came from: Ticketmaster event ids and
retrieval time, the Qloo requests made (no keys), the matching status of each
performer, and the scoring version. Demo results are marked as such in the data,
the UI, agent answers and MCP output.

## Evaluation

The experiments are pre-registered in [docs/EVALUATION.md](docs/EVALUATION.md).
Ticketmaster has no historical archive, so the originally proposed cancellation
backtest is replaced with tests the data can support: whether Qloo affinity tracks
audience overlap (against Ticketmaster's independent genre labels, with a popularity
control), how often Qloo changes the recommended date versus a plain count, and an
exploratory cancellation check with a pre-set minimum sample.

**Results (October 2026, 6 US markets, 146 target artists):** Qloo affinity ranks
same-genre competitors above different-genre ones with AUC 0.618 (95% CI
0.590–0.647), against 0.556 for popularity alone, and beats popularity in every
market. Qloo weighting changes the recommended date in 27% of 150 real
scenarios. The cancellation check had too few cases (11 < 30) to conclude
anything. Full results: [docs/EVALUATION.md](docs/EVALUATION.md).

## Limitations

- Qloo affinity is a proxy for potential audience overlap, not shared ticket
  buyers or purchase intent. Popularity is global, not local.
- Ticketmaster does not list every show (independent venues, other ticketing).
- Performers without a confident Qloo match are not scored; the UI shows them and
  bounds their possible effect, but cannot measure it.
- Timing weights are a stated hypothesis, not fitted to outcomes.
- A lower clash score is not a sales forecast.

## License

[MIT](LICENSE). Third-party data is governed by its providers' terms; see
[NOTICE.md](NOTICE.md).
