# Prior art (focused review, October 2026)

A time-boxed search for products that combine a competing-event calendar,
artist-to-artist audience overlap, and date selection. Sources reviewed are listed;
this is not an exhaustive market survey.

| Product / source | What it does | Overlap with Undertow | Difference |
| --- | --- | --- | --- |
| [Overture Radius Check](https://docs.overturehq.com/knowledge-base/radius-check/) | Flags bookings within a set distance and number of days of a new booking, optionally across all artists in the account | Distance + time window clash checking | Checks the user's own calendar only; no audience-affinity weighting |
| [ArtwinLive Region Check](https://www.artwinlive.com/help/article/using-the-region-check) | Flags same-day, regional and exclusivity conflicts among bookings in the user's planning | Same-day / nearby-date conflicts | Internal bookings; no public market calendar; no audience overlap |
| [Prism.fm](https://prism.fm/blog/insights/venue-scheduling-software-how-to-manage-events/) | Venue and talent-buying operations, holds and scheduling | Promoter scheduling workflow | Calendar and deal management, not market-wide audience competition |
| [Ticket Fairy blog](https://www.ticketfairy.com/blog/fairness-in-festival-scheduling-protecting-fans-from-painful-clashes/) | Articles on using fan-overlap data to avoid festival set clashes and choose dates | The idea that audience overlap should drive scheduling | Guidance, not a tool that scores candidate dates against a live calendar |
| Bandsintown / streaming analytics | Where an artist's fans are; tour routing by demand | Audience geography | Demand for one artist, not competition between acts on specific dates |

**Finding:** in the sources reviewed we found no product that scores a promoter's
candidate dates against the public market calendar weighted by audience affinity
between the target act and each competing act. The closest tools (radius and
region checks) are essentially Undertow's count baseline over a user's own bookings.
