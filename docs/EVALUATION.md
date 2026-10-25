# Evaluation plan and results

This plan was written and committed **before** any evaluation data was collected.
The hypotheses, metrics, thresholds and data budget below are fixed; results are
reported against them whatever they show. Changes after data collection are listed
under "Deviations" with a reason.

## Why not a cancellation backtest as originally proposed

The Ticketmaster Discovery API searches **current** listings. It is not a historical
event database: past events and many cancelled events are not retrievable, and an
event absent from results cannot be assumed cancelled. A historical "did competition
cause cancellations" backtest is therefore not possible with the data available.
We run three experiments the data can actually support.

## Data

- Markets: Chicago, New York, Los Angeles, Austin, Nashville, Atlanta (fixed list).
- Window: the 42 days starting 21 days after the collection date.
- Events: Ticketmaster `classificationName=music`, 30-mile radius, all pages.
- Performers: resolved to Qloo with the production resolution policy (exact or
  dominant namesake only). Unresolved performers are excluded, and counted.
- Affinity: Qloo `/v2/insights` with `filter.type=urn:entity:artist`,
  `signal.interests.entities=<target>`, `filter.results.entities=<competitors>`.
- Targets: up to 25 per market, chosen deterministically (hash of entity id) from
  performers with an exact Qloo match and a Ticketmaster genre.
- Raw data stays in `.eval-data/` (gitignored). Only aggregate statistics are
  published, because Qloo data must not be redistributed.

## E1 — Does Qloo affinity track audience overlap? (primary)

- **Label (independent of Qloo):** a competitor is "same genre" when its
  Ticketmaster genre equals the target's Ticketmaster genre (both present, not
  "Undefined"/"Other").
- **Hypothesis H1:** Qloo affinity ranks same-genre competitors above
  different-genre ones better than chance: pooled AUC > 0.5, with the 95%
  cluster-bootstrap interval (resampling targets, 2,000 draws, seed 42) excluding 0.5.
- **Control:** the same AUC computed with Qloo **popularity** instead of affinity.
  If popularity alone does as well, affinity adds nothing target-specific.
- **Held-out check:** AUC is reported per market. Nothing is tuned, so there is
  no training set; the per-market spread shows whether the effect is consistent.
- **Caveat:** genre is a coarse proxy for overlapping audiences. A positive
  result supports, but does not prove, that affinity reflects overlap.

## E2 — Does Qloo change the decision? (descriptive)

- For each target, take the first three Saturdays in the window as candidate
  dates and rank them with (a) the Tidate clash score and (b) the time-weighted
  count baseline over the identical events.
- **Report:** share of targets where the recommended date differs, and the
  share of rankings that differ at all.
- This measures *whether* Qloo changes decisions, not whether the changed
  decision is better. There is no ground-truth outcome to settle that.

## E3 — Cancellation/postponement association (exploratory)

- Within the collected window, events with status `canceled` or `postponed`
  versus `onsale`/`offsale`, each scored as if it were the target on its own date.
- **Pre-set threshold:** with fewer than 30 cancelled/postponed events with a
  resolved performer, the result is reported as **insufficient evidence** and no
  association is claimed.
- Even with enough data, cancellation has many causes; any association is not
  evidence that competition caused it.

## Results

Collected 2026-10-23 (window 2026-11-13 to 2026-12-24), scoring `tidate-score/1.2.0` (recorded in `eval-results.json` as `tidate-score/1.2.0`, the project's working name at the time; same engine).
Aggregate output: [`eval-results.json`](eval-results.json). Raw data stays private in `.eval-data/`.

### Data coverage

| Market | Events | Performers | Exact Qloo match | Targets with affinity |
| --- | --- | --- | --- | --- |
| chicago | 325 | 415 | 292 (70%) | 26 |
| new-york | 593 | 558 | 349 (63%) | 30 |
| los-angeles | 592 | 805 | 508 (63%) | 30 |
| austin | 116 | 153 | 101 (66%) | 25 |
| nashville | 220 | 251 | 175 (70%) | 25 |
| atlanta | 260 | 393 | 243 (62%) | 29 |

Overall 1,668 of 2,575 performers (65%) matched exactly. No market hit Ticketmaster's paging limit.
Two Los Angeles targets first failed on Qloo rate limits and were re-fetched with a slower repair pass before analysis.

### E1: Qloo affinity tracks audience overlap. **Association observed.**

| | AUC | 95% cluster-bootstrap CI |
| --- | --- | --- |
| Qloo affinity | **0.618** | 0.590 to 0.647 |
| Popularity only (control) | 0.556 | 0.544 to 0.568 |

146 targets, 37,913 target–competitor pairs (7,544 same genre). Qloo returned an
affinity for 94.7% of requested pairs.

| Market | Pairs | AUC affinity | AUC popularity |
| --- | --- | --- | --- |
| chicago | 6,744 | 0.625 | 0.587 |
| new-york | 8,100 | 0.622 | 0.535 |
| los-angeles | 10,764 | 0.648 | 0.567 |
| austin | 2,400 | 0.585 | 0.525 |
| nashville | 4,080 | 0.578 | 0.530 |
| atlanta | 5,825 | 0.591 | 0.552 |

Affinity ranks a same-genre competitor above a different-genre one about 62% of the time, against 50% by chance
and 56% for popularity alone. The interval excludes 0.5, the two intervals do not overlap, and affinity beats the
popularity control in all six markets. The effect is modest, and genre is a coarse proxy for shared audiences, so
this supports, but does not prove, that affinity reflects audience overlap.

### E2: Qloo changes the decision. **Descriptive.**

In 150 scenarios (each target, first three Saturdays of the window), the Qloo-weighted ranking recommends a
different date from the plain count in **27%** of cases, and orders the dates differently
in 56%. This shows Qloo materially changes decisions; it cannot show the changed decisions are
better, because no sales or attendance outcomes are available.

### E3: Cancellation association. **Insufficient evidence.**

17 cancelled or postponed events in the window; 11 had a matched performer, below the
pre-set minimum of 30. No association is claimed.

## Deviations

Recorded on 2026-10-23, **before** any evaluation data was collected. They come
from live API validation on a hand-picked set of artists (Clairo and six others,
Chicago), not from the evaluation markets or targets.

1. **Relative affinity.** Live Qloo affinity proved compressed: with Clairo as the
   signal, Slipknot scored 0.74 and beabadoobee 0.98. Raw values would make
   unrelated acts count three quarters as much as near-identical ones. Scoring
   v1.2.0 weights each act by the percentile of its affinity among acts playing
   nearby, raised to the power 4 (an act in the top tenth counts about ten times
   a median one). The exponent was set from that principle, not fitted to any
   outcome. E1 is unaffected (AUC is rank-based); E2 and E3 use v1.2.0.
2. **Second robustness tier.** In live data roughly half of nearby performers are
   local acts, tributes and special events with no exact Qloo match, so the
   worst-case bound almost never holds. v1.2.0 adds a second check that treats
   unmatched shows as typical matched acts. Reported alongside the worst case.
3. **De-duplication** now keys on (local date, headliner name) instead of
   (venue, date, headliner): live data listed the same show under two venue
   records.
4. **Qloo coverage gaps** found during validation (for example, no solo
   "Ludacris" entity, only collaborations) are left unmatched by design.
