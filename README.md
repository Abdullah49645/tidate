# Undertow

**Know which nights your crowd is already spoken for.**

Undertow helps concert promoters, talent buyers and artist teams choose between the
dates they can hold. For each candidate date it finds every music event within two
weeks in the same market (Ticketmaster), asks Qloo how strongly each competing act's
audience overlaps with your artist's, and ranks your dates by that pull, with every
number traceable to a specific show, Qloo signal and timing weight.

A plain calendar says *how many* shows are nearby. Undertow says *which ones matter
to your audience*: a night with three metal and country shows can be safer for an
indie-pop act than a night with one same-genre headliner across town.

Built for the [Qloo Agentic Hackathon 2026](https://qloo.devpost.com/).
Repository: https://github.com/Abdullah49645/undertow

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

- **Score**: `C(d) = Σ affinity × popularity × timing weight` over nearby shows.
  See [docs/METHODOLOGY.md](docs/METHODOLOGY.md).
- **Count baseline**: the same shows and timing weights, each counted alike, shown
  side by side so you can see whether Qloo changes the answer.
- **Evidence**: unmatched performers, missing affinity and imputed popularity are
  flagged per show; evidence quality and worst-case robustness are reported
  separately from the score.
- **What-if**: untick any show to re-rank instantly (the engine runs in the
  browser too).

### Three ways in

1. **Hold sheet (web form)**: runs the pipeline step by step with live progress.
2. **Agent**: ask in plain language ("I can hold May 9, 16 or 23 for Clairo in
   Chicago…"). An AI SDK `ToolLoopAgent` calls `find_artist`,
   `analyze_candidate_dates`, `explain_date`, `compare_dates` and
   `what_if_exclude`. It never produces numbers itself, and its final answer is
   checked against the engine's recommendation.
3. **MCP server** at `/api/mcp` (Streamable HTTP): tools `score_candidate_dates`,
   `find_artist`, `list_markets` for any MCP client.

## Project layout

```
src/lib/scoring/engine.ts   deterministic scoring, baseline, robustness, counterfactuals
src/lib/pipeline.ts         shared orchestration (live and demo providers)
src/lib/qloo/               Qloo client + entity matching policy
src/lib/ticketmaster/       Ticketmaster Discovery client
src/lib/agent/              agent tools, ToolLoopAgent, answer verification
src/lib/mcp/server.ts       MCP tool definitions
src/lib/demo/provider.ts    fictional demo scenario
src/app/api/*               analyze (NDJSON stream), agent, artists, mcp, status
src/components/             workstation UI
scripts/                    live API validation and evaluation
tests/                      unit, pipeline, agent, MCP tests (no network)
docs/                       methodology, evaluation, prior art, submission notes
```

## Setup

Requirements: Node.js 20+ (developed on 22).

```bash
git clone https://github.com/Abdullah49645/undertow.git
cd undertow
npm install
cp .env.example .env.local   # then fill in keys
npm run dev                  # http://localhost:3000
```

### Configuration

| Variable | Needed for | Where to get it |
| --- | --- | --- |
| `QLOO_API_KEY` | live data | Qloo hackathon key request form; works only with `https://hackathon.api.qloo.com` |
| `TICKETMASTER_API_KEY` | live data | developer.ticketmaster.com → My Apps → Consumer Key |
| `GOOGLE_GENERATIVE_AI_API_KEY` (or `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`) | conversational agent only | Google AI Studio (free tier) |
| `UNDERTOW_FORCE_DEMO=1` | optional | forces demo data |

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
4. Deploy. Check `https://<your-app>/api/status`: `liveAvailable: true` means
   both data keys are present.

API routes declare `maxDuration = 60`; a live analysis typically needs several
seconds because every competing performer is matched in Qloo (results are cached
per server instance).

## Using the MCP server

Point any Streamable HTTP MCP client at `https://<your-app>/api/mcp`:

```json
{ "undertow": { "url": "https://<your-app>/api/mcp" } }
```

For stdio-only clients: `npx mcp-remote https://<your-app>/api/mcp`.
`score_candidate_dates` takes `{ artist, marketId, candidateDates[], artistEntityId?, mode? }`
and returns structured evidence plus a text summary. Results are labelled as demo
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

Results are reported in that file once collected.

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
