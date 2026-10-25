# Notices

## Third-party data

Tidate's source code is MIT-licensed. The data it retrieves at runtime is not
part of this repository and is not covered by that license.

- **Qloo.** Taste, affinity and entity data come from the Qloo API and are subject
  to Qloo's terms and the terms of the hackathon API key. Responses may be cached
  privately on the server; they are never stored in this repository. Artist
  search results (id, name, popularity) are kept for up to 30 days in the
  deployment's private store to speed up later runs. Raw
  responses gathered for validation and evaluation live in the gitignored
  `.validation/` and `.eval-data/` folders.
- **Ticketmaster.** Event data comes from the Ticketmaster Discovery API and is
  subject to the Ticketmaster Developer Terms of Use. Event data is cached only
  briefly (15 minutes) to serve requests, and each event links back to its
  Ticketmaster listing where one is provided. A watch, which a user creates
  explicitly, keeps a compact record of the events near its dates (event id, name,
  venue, date and link) so the next check can tell what changed; it is deleted when
  the user stops watching, and expires 120 days after the last check. Review the
  Ticketmaster terms before running watches at scale.

## Demo data

Everything under `src/lib/demo/` is fictional: artists, venues, events and values
were invented for demonstration and do not describe real people, places or
audiences.

## Fonts

Public Sans (SIL Open Font License 1.1) and Big Shoulders Display (SIL Open Font
License 1.1), self-hosted via Fontsource.

## Dependencies

npm dependencies are distributed under their own licenses (predominantly MIT and
Apache-2.0); see each package in `node_modules` or `package-lock.json`.
