/**
 * Parser tests use small hand-written payloads shaped after the documented
 * response formats. They are synthetic fixtures, not recorded API responses,
 * and do not constitute live validation (see scripts/validate-live.ts).
 */
import { describe, expect, it } from "vitest";
import { geohash } from "@/lib/markets";
import { parseEntity } from "@/lib/qloo/client";
import { normaliseTmEvent } from "@/lib/ticketmaster/client";

describe("Ticketmaster event normalisation (synthetic payloads)", () => {
  const base = {
    id: "TEST1",
    name: "Synthetic Show",
    url: "https://example.test/e",
    dates: { start: { localDate: "2027-05-15", localTime: "19:30:00" }, status: { code: "onsale" } },
    classifications: [{ segment: { name: "Music" }, genre: { name: "Rock" } }],
    _embedded: {
      venues: [{ id: "V1", name: "Test Hall", city: { name: "Chicago" }, location: { latitude: "41.88", longitude: "-87.63" } }],
      attractions: [{ id: "K1", name: "Band One", classifications: [{ genre: { name: "Rock" } }] }, { id: "K2", name: "Band Two" }],
    },
  };

  it("maps documented fields", () => {
    const e = normaliseTmEvent(base, "2026-10-22T00:00:00Z", "test")!;
    expect(e.localDate).toBe("2027-05-15");
    expect(e.status).toBe("onsale");
    expect(e.venue).toMatchObject({ id: "V1", name: "Test Hall", lat: 41.88, lng: -87.63 });
    expect(e.performers.map((p) => p.name)).toEqual(["Band One", "Band Two"]);
    expect(e.genre).toBe("Rock");
  });

  it("treats TBA/TBD dates as unknown and maps status codes", () => {
    const tba = normaliseTmEvent({ ...base, dates: { start: { localDate: "2027-05-15", dateTBA: true }, status: { code: "postponed" } } }, "t", "t")!;
    expect(tba.localDate).toBeNull();
    expect(tba.status).toBe("postponed");
    const weird = normaliseTmEvent({ ...base, dates: { status: { code: "mystery" } } }, "t", "t")!;
    expect(weird.status).toBe("unknown");
    expect(weird.localDate).toBeNull();
  });

  it("rejects records without an id or name", () => {
    expect(normaliseTmEvent({ name: "x" }, "t", "t")).toBeNull();
    expect(normaliseTmEvent(null, "t", "t")).toBeNull();
  });

  it("drops the 'Undefined' genre placeholder", () => {
    const e = normaliseTmEvent({ ...base, classifications: [{ genre: { name: "Undefined" } }] }, "t", "t")!;
    expect(e.genre).toBeNull();
  });
});

describe("Qloo entity parsing (synthetic payloads)", () => {
  it("reads entity_id, popularity and query.affinity", () => {
    const e = parseEntity({ entity_id: "ABC", name: "Someone", popularity: 0.91, query: { affinity: 0.77 }, types: ["urn:entity:artist"] });
    expect(e).toMatchObject({ entityId: "ABC", popularity: 0.91, affinity: 0.77 });
  });

  it("returns null affinity rather than guessing when the field is absent or malformed", () => {
    expect(parseEntity({ entity_id: "A", name: "N" })!.affinity).toBeNull();
    expect(parseEntity({ entity_id: "A", name: "N", query: { affinity: "n/a" } })!.affinity).toBeNull();
    expect(parseEntity({ name: "No id" })).toBeNull();
  });
});

describe("geohash", () => {
  it("matches known reference values", () => {
    // Reference: geohash of (57.64911, 10.40744) is u4pruydqqvj
    expect(geohash(57.64911, 10.40744, 11)).toBe("u4pruydqqvj");
    expect(geohash(41.8781, -87.6298, 5)).toBe("dp3wj");
  });
});
