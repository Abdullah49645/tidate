# Submission materials

## One-line pitch

Tidate tells a promoter which of the dates they can hold is already spoken for,
by weighting every nearby show by how much its audience overlaps with theirs.

## Description (Devpost)

**The problem.** Promoters and talent buyers pick between a handful of holdable
dates for a show. Other concerts in the same market around those dates may compete
for the same fans, but a calendar treats every show alike. Three metal and country
shows on a Saturday may matter less to an indie-pop act than one same-genre
headliner across town. Today that judgement lives in spreadsheets, calls and memory.

**What Tidate does.** Enter an artist, a market and up to four candidate dates.
Tidate pulls every music event within two weeks of each date from Ticketmaster,
matches each competing performer to Qloo, and asks Qloo's taste graph how strongly
each act's audience aligns with your artist's. A deterministic engine combines
affinity, popularity and timing into a clash score per date, ranks the dates, and
shows exactly which shows drive each score.

**Why Qloo is essential.** Without Qloo, the best a tool can do is count nearby
shows. Qloo's affinity between your artist and each competing act is what
distinguishes a direct competitor from an unrelated event. Tidate shows both
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

## Demo script (about 3 minutes, live data)

The example is a real live query, checked on 2026-10-24. Live data changes, so
re-run it before recording and quote what the screen shows. It is framed as a
hypothetical: Kirk Franklin already has a Nashville show in this window, which
Tidate excludes from the competition.

**Beat 1: the question (30 s).** "Suppose Kirk Franklin's team can hold Friday
Nov 27, Friday Dec 4 or Thursday Dec 10 in Nashville. Which night is least
crowded for his audience?" Tap "Try Kirk Franklin in Nashville", then Analyze.

**Beat 2: the analysis (60 s).** The steps tick through: Ticketmaster calendar,
performer matching, Qloo affinity, scoring, evidence check. The calendar leaf
lands on **Friday, November 27**, the busiest of the three dates (231 nearby shows).
Point at the timeline: lots of shows, but short bars, because few of them share
his audience.

**Beat 3: the decision (90 s).** Open "Does Qloo change the answer?". A headcount
sends you to **Dec 10**, the quietest date (149 shows). Qloo ranks it last: **Jodeci,
Dave Barnes and Little Big Town all play that same night**, each closer to the
audience than 89–98% of acts nearby. Select Dec 10 and expand Jodeci to show the
raw Qloo affinity, its rank, popularity and timing, multiplied out. Switch Jodeci
off to show the what-if. Close on "Holds unless unmatched acts are unusually
close" and the data-coverage details: what Tidate can't see, stated plainly.

**Beat 4, optional if time allows (40 s).** Expand Jodeci: "Like Kirk Franklin,
tagged Rhythm & Blues and Soul in Qloo." Then Little Big Town: no shared genre,
yet Qloo still ranks its audience close, which is exactly what a genre filter
would miss. Scroll to the fan map: Ryman Auditorium sits in the top few percent
of mapped areas for his audience. Then switch the date field to "Find a night"
and run Nov 13 to Dec 31: the provisional ranking fills in while acts are looked
up, the calendar shades every Friday and Saturday, and Tidate flags Christmas
weekend as quiet for everyone. Skip those two nights and the pick moves. (Re-run
before recording; quote the screen.)

**Watch beat (needs the deployed app; start the watch days before recording).**
Choose "Watch these dates for changes", then open the watch page. Show the
history: real Ticketmaster changes found by the daily checks since the watch
started, each with its plain change lines. Only show changes the page actually
recorded; if nothing changed, say so and show the demo-mode watch, which is
labelled fictional.

## Narration (about 90 seconds)

> Promoters choose between the dates they can hold. The question isn't how many
> shows are nearby; it's which of them are chasing the same fans. Tidate pulls
> every music event within two weeks of each date from Ticketmaster, asks Qloo how
> closely each competing act's audience aligns with yours, and ranks your dates.
>
> Here a calendar count points to December 10, the quietest night. But Jodeci,
> Dave Barnes and Little Big Town all play that same night, and Qloo places their
> audiences among the closest to Kirk Franklin's. November 27 is busier, but its
> shows mostly draw other crowds. That's the call a count would get wrong.
>
> Every number is traceable: the show, Qloo's affinity, its rank among acts
> nearby, the timing weight. Acts Qloo can't match are listed, and Tidate tells
> you whether they could change the answer. Across six cities, Qloo's affinity
> tracked shared genres better than popularity alone, and changed the
> recommended date in about a quarter of real cases.

## Verified vs not yet verified

Keep this list current; do not claim anything from the right column.

| Verified (ran and observed) | Not yet verified |
| --- | --- |
| Live Qloo search and affinity (fields, scale, rate limits): docs/API_VALIDATION.md | Deployed URL |
| Live Ticketmaster event search across 7 markets | MCP endpoint called by an external client over the internet |
| End-to-end live analysis in the browser and via the API | Any effect on ticket sales (no outcome data exists) |
| Agent with real Gemini, tool calling, key and model rotation | |
| Evaluation E1–E3 run on live data; results in docs/EVALUATION.md | |
| 85 automated tests, typecheck, lint, production build | |
| Night search, provisional ranking, shared-taste tags and fan map against live Qloo and Ticketmaster (Nashville, Oct 26) | |
| Watches: create, check, diff and model-written summary locally (demo and live, memory store); Upstash client against a mocked REST API | Watches on Upstash and the daily cron on a real deployment |
| MCP JSON-RPC calls against the handler (tests) | |
