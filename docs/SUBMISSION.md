# Submission materials

## One-line pitch

Undertow tells a promoter which of the dates they can hold is already spoken for,
by weighting every nearby show by how much its audience overlaps with theirs.

## Description (Devpost)

**The problem.** Promoters and talent buyers pick between a handful of holdable
dates for a show. Other concerts in the same market around those dates may compete
for the same fans, but a calendar treats every show alike. Three metal and country
shows on a Saturday may matter less to an indie-pop act than one same-genre
headliner across town. Today that judgement lives in spreadsheets, calls and memory.

**What Undertow does.** Enter an artist, a market and up to four candidate dates.
Undertow pulls every music event within two weeks of each date from Ticketmaster,
matches each competing performer to Qloo, and asks Qloo's taste graph how strongly
each act's audience aligns with your artist's. A deterministic engine combines
affinity, popularity and timing into a clash score per date, ranks the dates, and
shows exactly which shows drive each score.

**Why Qloo is essential.** Without Qloo, the best a tool can do is count nearby
shows. Qloo's affinity between your artist and each competing act is what
distinguishes a direct competitor from an unrelated event. Undertow shows both
rankings side by side, so you can see when Qloo changes the decision and why.

**Agentic.** An AI SDK `ToolLoopAgent` answers plain-language questions by calling
real tools (find artist, analyse dates, explain a date, compare two dates, what-if
a show moves). The same pipeline is exposed as an MCP server for any MCP client.
The LLM never computes a number: scores come only from the engine, and the agent's
answer is checked against the engine's recommendation.

**Honest by construction.** Unmatched performers, missing affinity and imputed
values are flagged per show. Evidence quality is reported separately from the
score, and a worst-case bound says whether missing data could flip the ranking.
Demo mode uses clearly labelled fictional data and never mixes with live results.

## How it's built

Next.js 16 + TypeScript on Vercel; zod runtime validation of every request and
API response; Qloo `/search` and `/v2/insights` (`signal.interests.entities` +
`filter.results.entities`); Ticketmaster Discovery v2; Vercel AI SDK v7
`ToolLoopAgent`; `mcp-handler` MCP server; Vitest suite covering the engine
(property-style checks), pipeline failure modes, agent orchestration with a
scripted model, and MCP over JSON-RPC.

## Demo script (about 3 minutes)

**Beat 1: the question (30 s).** "I'm booking an indie-pop act in Chicago and can
hold three Saturdays. Which night is least crowded *for her fans*?" Enter the
artist, market and dates. Point out that Undertow only ranks dates you can hold.

**Beat 2: the analysis (60 s).** Run it. The steps tick through in real time:
calendar search, performer matching, Qloo affinity, scoring, evidence check. Show
the recommendation and the undertow strips: ticks above the line are every nearby
show; depth below the line is Qloo-weighted pull. The busiest night can be shallow;
a quiet night can hide one deep competitor.

**Beat 3: the decision (90 s).** Open the riskiest date: the top row is a same-genre
act two days away with high affinity. Show "Does Qloo change the answer?": a plain
count would pick a different night, and the note explains why. Untick a show to
run a what-if. Close on evidence and limits: what is measured, what is not, which
performers could not be matched, and whether that could change the answer.

## Narration (about 90 seconds)

The middle paragraph describes the **fictional demo scenario**. If the recording
shows demo data, keep the on-screen demo label visible. For a live recording,
rewrite that paragraph from the actual live result rather than reusing it.

> Promoters choose between the dates they can hold. The question isn't how many
> shows are nearby; it's which of them are chasing the same fans. Undertow pulls
> every music event within two weeks of each date from Ticketmaster, asks Qloo how
> closely each competing act's audience aligns with yours, and ranks your dates.
>
> Here, the busiest Saturday turns out to be the safest: its shows are metal,
> country and electronic, with low affinity to our artist. The quiet Saturday
> hides one same-genre headliner on the same night. A calendar count would have
> sent us straight into it.
>
> Every number is traceable: the show, the venue, the Qloo affinity, the timing
> weight. Performers Qloo can't match are flagged, and Undertow tells you whether
> they could change the answer. You can ask the agent in plain language, or call
> the same engine from any MCP client.

## Verified vs not yet verified

Keep this list current; do not claim anything from the right column.

| Verified (ran and observed) | Not yet verified |
| --- | --- |
| Live Qloo search and affinity (fields, scale, rate limits): docs/API_VALIDATION.md | Deployed URL |
| Live Ticketmaster event search across 7 markets | MCP endpoint called by an external client over the internet |
| End-to-end live analysis in the browser and via the API | Any effect on ticket sales (no outcome data exists) |
| Agent with real Gemini, tool calling, key and model rotation | |
| Evaluation E1–E3 run on live data; results in docs/EVALUATION.md | |
| 60 automated tests, typecheck, lint, production build | |
| MCP JSON-RPC calls against the handler (tests) | |
