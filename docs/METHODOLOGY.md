# Scoring methodology

Tidate ranks candidate concert dates by estimated **audience-competition risk**:
how strongly other music events near each date might draw on the same audience as
your artist. Version: `tidate-score/1.2.0` (`src/lib/scoring/engine.ts`).

## Pipeline

1. **Validate** the request: 1–4 distinct real calendar dates, a supported market.
   A night search instead gives a range of at most 70 days and the nights of the
   week; every matching night (2 to 40) becomes a candidate date and is scored
   exactly like a given date.
2. **Resolve the target artist** in Qloo (`/search`, `types=urn:entity:artist`).
   Anything other than a confident match stops and asks the user to pick.
3. **Retrieve events** from Ticketmaster (`classificationName=music`, `geoPoint` +
   `radius` around the market centre) for 14 days either side of the dates.
   Ticketmaster stops paging at 1,000 results, so a window that reports more is
   split in half (down to single days) and the pieces are merged by event id.
4. **Exclude** with a recorded reason: the target's own shows, cancelled,
   postponed, TBA/TBD dates, duplicate listings (same venue, date and headliner).
   Rescheduled shows are kept at their current date and flagged.
5. **Match competing performers** to Qloo with the same policy (below), under a
   time budget (30 s for given dates, 45 s for a night search). Performers are
   looked up in order of their summed timing weight across the candidate dates,
   ties going to the closest show: with a few dates this is closest first, across
   a month of nights it favours acts near many of them. Acts not reached are
   marked "not checked" and bounded like any unmatched act; a second run reuses
   cached lookups and reaches further. Every few seconds during this step the
   engine scores what is known so far and streams it as a **provisional ranking**
   (labelled as such: the pool behind each act's rank is still growing). Those
   affinities are reused in step 6, so nothing is fetched twice.
6. **Fetch affinity**: Qloo `/v2/insights` with `filter.type=urn:entity:artist`,
   `signal.interests.entities=<target>`, `filter.results.entities=<competitors>`.
   Qloo documents `filter.results.entities` as the way to assess an entity's
   affinity toward the input.
7. **Score** deterministically, then **verify** that every breakdown sums to its
   total and that evidence quality and robustness are reported.

## Score

```
C(d) = Σ  K_i × S_i × W(|d − d_i|)        K_i = (rank of A_i among nearby acts) ^ 4
```

| Term | Meaning | Source |
| --- | --- | --- |
| `A_i` | Qloo affinity of competing act *i* with your artist as the signal | Qloo Insights `query.affinity` |
| `K_i` | Closeness weight: mid-rank percentile of `A_i` among all matched acts in the window, raised to the power 4 | Derived from `A_i` |
| `S_i` | Size weight: Qloo **global** popularity percentile; 0.50 when missing (flagged) | Qloo `popularity` |
| `W` | Timing weight: same day 1.0, 1–2 days 0.7, 3–7 days 0.4, 8–14 days 0.15, otherwise 0 | Fixed hypothesis |

**Why a rank, not the raw value.** Live validation showed Qloo affinity between
artists is compressed: with Clairo as the signal, Slipknot scores 0.74 and
beabadoobee 0.98 (see [API_VALIDATION.md](API_VALIDATION.md)). Used raw, every act
would count at least three quarters as much as the closest one, and the score
would mostly count shows. Ranking each act against the others playing nearby
keeps Qloo's ordering and discards its compressed scale. The power of 4 sets how
sharply the score favours close acts: an act in the top tenth (rank 0.9) counts
about ten times a median act (0.9⁴ / 0.5⁴ ≈ 10.5). It was chosen from that
principle, before any evaluation data was collected, and is not fitted.

The raw affinity is always shown next to the rank ("closer than 92% of acts
nearby"), so nothing about Qloo's value is hidden.

Dates are compared as **local calendar dates** (Ticketmaster `localDate`), so
time zones and DST cannot shift a show by a day. On a multi-act bill the
performer with the largest `K × S` represents the show.

## Entity matching policy

Names are normalised (case, accents, leading "the", "&" → "and", punctuation).
When Ticketmaster lists no performer, the part of the event title before a
separator is tried ("Clairo – Charm Tour" → "Clairo"). When a whole bill is
listed as one name and that name doesn't match, each comma- or slash-separated
part is tried. Either way, a part must still match exactly.

Lookups run closest-show-first under a time budget (30 s by default); any not
reached are marked "not looked up in time" and left unscored. Lookups are cached
server-side, so a second run checks more.

- **exact**: one Qloo artist with the same normalised name, or several where the
  most popular leads the next by ≥ 0.25 popularity (clear namesake).
- **ambiguous**: several same-name artists without a clear leader.
- **weak**: Qloo returns artists, none with the same name (e.g. tribute acts).
- **not found / error**.

Only exact (or user-confirmed) matches are scored. Everything else is shown as
"not scored", with its reason.

## Evidence quality and robustness

Score size and evidence quality are reported separately.

- **Evidence quality**: the time-weighted share of nearby shows that could be
  scored: ≥ 0.8 strong, ≥ 0.5 partial, otherwise weak. No competing shows found
  is reported as such ("Ticketmaster coverage only"), never as "safe".
- **Robustness**, checked twice against shows that couldn't be scored:
  1. **Worst case**: each unscored show counts as a perfect match (weight 1 ×
     timing). The recommendation holds if the recommended date's worst-case total
     is still below every other date's observed score.
  2. **Typical case**: each unscored show counts as a typical matched act (the
     median `K × S` among matched acts) on every date. The recommendation holds
     if it still ranks first.
  In live data around half of nearby performers are local acts, tributes and
  special events with no exact Qloo match, so the worst case rarely holds and
  the typical case is the informative one. Both are bounds and scenarios, not
  probabilities. No confidence percentage is produced.
- **What would change it**: for each other date, the largest single show whose
  removal (from every date's window, as a cancellation would) makes that date
  the strict lowest. Each claim is verified by re-scoring in the test suite.

## Baseline

The **plain count** baseline uses the identical eligible events and timing
weights, counting every show alike (`Σ W`). Showing both rankings side by side is
how the UI makes Qloo's contribution visible; the evaluation tests it.

## Night search specifics

- The verdict compares the best night with the runner-up, as for given dates.
- A night that is quiet for every act (fewer than 40% of the median night's
  time-weighted shows) wins under both methods. Tidate flags it ("check it isn't
  a holiday or a night the whole market avoids") rather than guessing why.
- Skipping a night in the UI re-runs the engine on the remaining nights; the
  stored evidence is unchanged.
- Per-show rows are dropped from the streamed payload and rebuilt in the browser
  from the stored events, matches and affinities with the same engine (tested to
  reproduce the server's scores exactly).

## Context shown beside the score (never scored)

- **Shared taste.** Qloo `/entities?entity_ids=…` returns each artist's tags. The
  UI compares only genre, subgenre, lineage (`urn:tag:influence:qloo`) and named
  influences (`urn:tag:influenced_by:qloo`), because Qloo also tags almost every
  artist with adjectives such as "Passionate" or "Loyal", which explain nothing.
  Spelling variants (R&B / Rhythm & Blues) are merged. When both artists are
  tagged and nothing is shared, the UI says so: the overlap Qloo measures is in
  listeners, not labels. Qloo's `/v2/insights/compare` endpoint was tried first;
  it returns region and instrument tags ("United States", "Drums") at the top for
  unrelated pairs, so it was not used.
- **Fan map.** Qloo heatmap (`filter.type=urn:heatmap`, the target as signal,
  `filter.location=POINT(lng lat)` with the search radius). Cell affinity is
  rank-normalised within the area (uniform 0–1 for every artist), so it shows
  where an artist's audience is *relatively* concentrated, not how many fans live
  there. Maps of different artists in the same city differ (Nashville: Kirk
  Franklin vs Jodeci r = 0.24, vs Little Big Town r = 0.27), so the map is
  artist-specific. Venues are placed by the nearest cell within 1.5 km.
- Neither feeds the score: the evaluation was run on the affinity-based score only,
  and neither signal has been tested against outcomes.

## Run planning (display of the same scores)

Each city's nights are scored independently. Scores are not comparable across
cities (each city's acts are ranked against its own pool), so a night's cost is its
rank position within its city: 0 for the best night, 1 for the worst. The planner
chooses one night per city, every pair at least the chosen number of days apart,
minimising total cost, by exact branch-and-bound search (tested against brute force).
Ties have no special handling beyond date order. Travel, routing and costs are not
modelled. The same search over the headcount ranks gives the comparison route.

## Support acts and venues (display only)

- **Support acts**: Qloo `/v2/insights` with `filter.type=urn:entity:artist`, the
  target as signal and `signal.location.query=<city>`, which re-weights the
  recommendations towards the market (Nashville, Kirk Franklin: CeCe Winans, Israel
  Houghton, Fred Hammond…). Acts already playing within the chosen date's window
  are left out and named; acts more popular than the headliner are listed last.
  Qloo can't tell who is touring or available.
- **Venues**: every venue Ticketmaster lists music at in the window, ranked by the
  heatmap affinity of its nearest cell (in 5-point bands), then by the clash-score
  contributions on the chosen date from shows within 1 km; venues already booked
  that night go last. Records with the same venue name are merged.

## Watches

A watch stores the request (with the artist pinned to the Qloo entity the first
run resolved) and a compact snapshot: the ranking, the robustness tier, and each
nearby listing with its largest scored contribution and closeness. Each check
re-runs the pipeline and compares snapshots deterministically:

- **New listing**: an event id not seen before that now adds to a date's score.
  New listings with no pull (unmatched in Qloo, or far from the dates) are counted,
  not itemised.
- **Removed**: an event id that was listed before and is not now, reported as
  cancelled, postponed or date-TBA when Ticketmaster says so, otherwise "no longer
  listed". Shows dated before today are not reported (they happened).
- **Moved**: the same event id with a different date.
- **Best night**, **robustness tier** and, for up to four dates, **rank** changes.
- **Coverage**: more acts matched than last time. Lookups have a time limit and a
  shared cache, so later checks reach further; the line says so, because a score
  can rise from better coverage alone. Coverage-only changes are not "notable".

Notable changes get a summary from the configured model, written only from the
change lines; it is discarded if it contains any number that isn't in them. The
change lines are always shown.

## What the score is not

- Affinity is a proxy for potential audience overlap from Qloo's taste graph. It
  is not a count of shared local ticket buyers or purchase intent.
- Popularity is global, not local to the market.
- Shows not listed on Ticketmaster are invisible.
- A lower clash score is not a forecast of ticket sales or revenue.

## Considered and not used

- **Location-aware popularity**: Qloo's documented parameters for
  `filter.type=urn:entity:artist` do not include `signal.location`, so a
  per-market artist affinity is not available through that route.
- **Heatmap overlap**: `filter.type=urn:heatmap` returns per-geohash affinity
  for a signal inside a location. Comparing two artists' heatmaps within a city
  is plausible but not yet validated against live data; it is not in the score.
