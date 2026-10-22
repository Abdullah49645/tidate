# Scoring methodology

Undertow ranks candidate concert dates by estimated **audience-competition risk**:
how strongly other music events near each date might draw on the same audience as
your artist. Version: `undertow-score/1.0.0` (`src/lib/scoring/engine.ts`).

## Pipeline

1. **Validate** the request: 1–4 distinct real calendar dates, a supported market.
2. **Resolve the target artist** in Qloo (`/search`, `types=urn:entity:artist`).
   Anything other than a confident match stops and asks the user to pick.
3. **Retrieve events** from Ticketmaster (`classificationName=music`, `geoPoint` +
   `radius` around the market centre) for 14 days either side of the dates.
4. **Exclude** with a recorded reason: the target's own shows, cancelled,
   postponed, TBA/TBD dates, duplicate listings (same venue, date and headliner).
   Rescheduled shows are kept at their current date and flagged.
5. **Match competing performers** to Qloo with the same policy (below).
6. **Fetch affinity**: Qloo `/v2/insights` with `filter.type=urn:entity:artist`,
   `signal.interests.entities=<target>`, `filter.results.entities=<competitors>`.
   Qloo documents `filter.results.entities` as the way to assess an entity's
   affinity toward the input.
7. **Score** deterministically, then **verify** that every breakdown sums to its
   total and that evidence quality and robustness are reported.

## Score

```
C(d) = Σ  A_i × S_i × W(|d − d_i|)
```

| Term | Meaning | Source |
| --- | --- | --- |
| `A_i` | Qloo affinity of competing act *i* given your artist as signal, clamped to [0, 1] | Qloo Insights `query.affinity` |
| `S_i` | Size weight: Qloo **global** popularity percentile of act *i*; 0.50 when missing (flagged) | Qloo `popularity` |
| `W` | Timing weight: same day 1.0, 1–2 days 0.7, 3–7 days 0.4, 8–14 days 0.15, otherwise 0 | Fixed hypothesis |

Dates are compared as **local calendar dates** (Ticketmaster `localDate`), so
time zones and DST cannot shift a show by a day. On a multi-act bill the
performer with the largest `A × S` represents the show.

These weights are modelling choices, not fitted values. They have not been tuned
on any outcome data.

## Entity matching policy

Names are normalised (case, accents, leading "the", "&" → "and", punctuation).

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
- **Robustness**: each unscored show is assigned a worst case (affinity 1,
  popularity 1). The recommendation is **robust** when the recommended date's
  worst-case total is still below every other date's observed score. This is an
  interval bound, not a probability. No confidence percentage is produced.
- **What would change it**: for each other date, the largest single show whose
  removal (from every date's window, as a cancellation would) makes that date
  the strict lowest. Each claim is verified by re-scoring in the test suite.

## Baseline

The **plain count** baseline uses the identical eligible events and timing
weights, counting every show alike (`Σ W`). Showing both rankings side by side is
how the UI makes Qloo's contribution visible; the evaluation tests it.

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
