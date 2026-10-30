# Live API validation

Run on 2026-10-23 with `npm run validate:live` and live end-to-end analyses.
Raw responses are kept privately in `.validation/` (gitignored) and are not
published, per Qloo's terms.

## Qloo (hackathon API)

| Item | Documented | Observed live |
| --- | --- | --- |
| Base URL / auth | `https://hackathon.api.qloo.com`, header `X-Api-Key` | Confirmed |
| `/search?query=&types=urn:entity:artist` | Search entities by name | 200 in 50–300 ms. Result keys: `entity_id`, `name`, `popularity` (number 0–1), `disambiguation`, `types`, `tags`, `properties` |
| `/v2/insights` with `signal.interests.entities` + `filter.results.entities` | "Often used to assess the affinity of an entity towards input" | 200, every requested id returned. Entity keys include `query.affinity` and `query.measurements.audience_growth` |
| Affinity scale | Not specified | 0–1. Compressed for artist pairs: with Clairo as signal, beabadoobee 0.977, Phoebe Bridgers 0.950, Laufey 0.906, Morgan Wallen 0.837, The National 0.793, Slipknot 0.741 |
| Popularity | Percentile | Mostly above 0.9 for artists that Ticketmaster lists |
| Rate limits | "High enough", raised on request | Headers: `x-second-ratelimit-limit: 10`, `x-month-ratelimit-limit: 50000` |
| `filter.results.entities.query` (POST, by name) | Search entities by name to use as filters | Resolves names to **places** for artists (e.g. "Phoebe Bridgers" matched a diner); not usable for artist matching |
| Heatmap (`filter.type=urn:heatmap`, `filter.location.query=Chicago`) | Grid of affinity, rank, popularity | 1,117 geohash cells with `affinity`, `affinity_rank`, `entity_artist_affinity`, `popularity`. Not used in scoring (see Methodology) |
| Heatmap with an artist signal and `filter.location=POINT(lng lat)` + `filter.location.radius` (m) | Location by WKT geometry | Nashville, 30 miles, Kirk Franklin as signal: 530 geohash-6 cells inside the radius (`filter.location.query=Nashville` gave 328 over a smaller area). Affinity is uniform 0–1 per artist (rank-normalised). Correlation of cell affinity between artists: Kirk Franklin/Jodeci 0.24, Kirk Franklin/Little Big Town 0.27, Jodeci/Little Big Town −0.21. Used for the fan map (display only) |
| `/entities?entity_ids=<up to 25 ids>` | Entity details | 200; each entity carries about 45–50 tags typed `urn:tag:genre`, `…:genre:qloo`, `…:subgenre:qloo`, `…:style:qloo`, `…:influence:qloo`, `…:influenced_by:qloo`, `…:audience:qloo`, `…:theme:qloo` and others. Kirk Franklin and Jodeci share Rhythm & Blues and Soul; Kirk Franklin and Little Big Town share no genre or influence (both share adjectives like "Loyal", "Passionate"). 25 Nashville acts in one call: all tagged, 3 shared a genre with Kirk Franklin. Used for the shared-taste line (display only) |
| `/v2/insights/compare` (`a.signal.interests.entities`, `b.signal.interests.entities`) | Compare two signals | 200 (the `/v2/analysis/compare` path answers too). Top results for Kirk Franklin vs Jodeci: United States, Spirituals, Guitar, Piano, Drums; for Kirk Franklin vs Little Big Town: Drums, United States, Piano. Too generic to explain an overlap, so not used |
| `/v2/insights` `filter.type=urn:entity:artist` with an artist signal (no filter) | Recommendations | 200; Kirk Franklin: Fred Hammond & Radical For Christ, Deitrick Haddon, Tonéx, Israel Houghton… (affinity 0.97–0.98). Adding `signal.location.query=Nashville` re-orders them (CeCe Winans, Israel Houghton, Fred Hammond, Jonathan McReynolds…) and adds `query.measurements.audience_growth`. `filter.popularity.max=0.98` had no effect. Used for support-act ideas (display only) |
| `filter.type=urn:tag` with an artist signal | Taste analysis | 200; Kirk Franklin: Overcoming Struggles, gospel, Christian Music, Uplifted, worship… Not needed once entity tags were available |
| Coverage | Not specified | Some well-known artists exist only as collaborations (no solo "Ludacris") |

**Consequence for scoring:** raw affinity treats an unrelated metal band as 76% as
relevant as a near-identical indie artist, so v1.2.0 weights by each act's rank
among acts playing nearby (see [METHODOLOGY.md](METHODOLOGY.md)).

## Ticketmaster Discovery API

| Item | Observed live (Chicago, 30 miles, 30-day window) |
| --- | --- |
| Volume | 420–432 music events, 3 pages of 200, not truncated. Over 10 weeks (Oct 27 – Jan 5): Nashville 516, Chicago 741, New York 2,495, so long windows in big markets exceed the 1,000-result paging cap and are split |
| Status codes | `onsale` 424, `canceled` 5, `rescheduled` 2, `offsale` 1 |
| Events without an attraction | 138 (titles like "Clairo – Charm Tour" or venue series). Tidate tries the title before a separator as the performer |
| Multi-act bills | 111 events list several attractions; some list a whole bill as one attraction ("Ok Goodnight, Snooze, Eve"), which Tidate splits only when the full name doesn't match |
| Duplicates | Same show under two venue records; de-duplicated on (date, headliner) |
| Genres | Rock, Other, Jazz, Country, Blues, Pop, Alternative, Dance/Electronic… |

## Matching in practice (Clairo, Chicago, three December Saturdays)

347 distinct performers within the window. With all lookups completed:
188 exact matches, 140 with no exact Qloo name match, 17 not found, 2 errors.
The unmatched set is dominated by local acts, tributes ("THE DECEMBERISTS Tribute
By The Dozen Buzzin' Cousins"), venue series ("Jazz in the Sidebar") and holiday
specials. Leaving them unscored is deliberate; the UI reports them and checks
whether they could change the ranking.

First run: 27.9 s with a 25 s lookup budget (109 far-off performers deferred).
Second run with the shared search cache: 11.8 s, all performers checked.

## Gemini (agent)

| Finding | Detail |
| --- | --- |
| Model availability | `gemini-3.5-flash` works, including tool calling. `gemini-2.5-flash` is not available to newly created keys; `gemini-3.8-flash` and `gemini-flash-latest` returned 503 (overloaded) during testing |
| Refused keys | A key whose project has the Generative Language API disabled returns 403 PERMISSION_DENIED |

The agent tries every configured key for each model in order (`gemini-3.5-flash`,
`gemini-3.8-flash`, `gemini-flash-latest`) and moves on after 401/403/404/429/5xx.
With one refused key and one working key, a full demo question with five tool
calls completed in 15.6 s.
