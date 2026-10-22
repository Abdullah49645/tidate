import type { CompetingEvent, EventStatus } from "@/lib/types";

let n = 0;

/** Synthetic event builder for unit tests. Not real data. */
type EvOverrides = Partial<Omit<CompetingEvent, "venue" | "status">> & {
  date?: string | null;
  performer?: string;
  status?: EventStatus;
  venue?: string;
};

export function ev(over: EvOverrides = {}): CompetingEvent {
  n += 1;
  const id = over.eventId ?? `EV${String(n).padStart(4, "0")}`;
  const performer = over.performer ?? `Act ${id}`;
  return {
    eventId: id,
    name: over.name ?? performer,
    url: null,
    localDate: over.date === undefined ? "2027-05-16" : over.date,
    localTime: null,
    status: over.status ?? "onsale",
    venue: { id: over.venue ?? `V-${id}`, name: over.venue ?? `Venue ${id}`, city: "Testville", lat: null, lng: null },
    performers: over.performers ?? [{ attractionId: `A-${performer}`, name: performer, genre: null }],
    genre: null,
    provenance: { source: "demo-fixture", retrievedAt: "2027-01-01T00:00:00Z", request: "test" },
  };
}
