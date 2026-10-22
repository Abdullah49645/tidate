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
  dates and rank them with (a) the Undertow clash score and (b) the time-weighted
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

_Pending: requires live API keys. Run `npm run eval:collect` then `npm run eval:run`._

## Deviations

_None yet._
