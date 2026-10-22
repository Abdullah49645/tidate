/**
 * Supported markets. Events are searched within a radius of the market centre
 * using Ticketmaster's documented `geoPoint` (geohash) + `radius` parameters.
 * Coordinates are approximate city centres.
 */

export interface Market {
  id: string;
  label: string;
  country: string;
  lat: number;
  lng: number;
  timezone: string;
}

export const MARKETS: Market[] = [
  { id: "chicago", label: "Chicago, IL", country: "US", lat: 41.8781, lng: -87.6298, timezone: "America/Chicago" },
  { id: "new-york", label: "New York, NY", country: "US", lat: 40.7128, lng: -74.006, timezone: "America/New_York" },
  { id: "los-angeles", label: "Los Angeles, CA", country: "US", lat: 34.0522, lng: -118.2437, timezone: "America/Los_Angeles" },
  { id: "austin", label: "Austin, TX", country: "US", lat: 30.2672, lng: -97.7431, timezone: "America/Chicago" },
  { id: "nashville", label: "Nashville, TN", country: "US", lat: 36.1627, lng: -86.7816, timezone: "America/Chicago" },
  { id: "atlanta", label: "Atlanta, GA", country: "US", lat: 33.749, lng: -84.388, timezone: "America/New_York" },
  { id: "seattle", label: "Seattle, WA", country: "US", lat: 47.6062, lng: -122.3321, timezone: "America/Los_Angeles" },
  { id: "denver", label: "Denver, CO", country: "US", lat: 39.7392, lng: -104.9903, timezone: "America/Denver" },
  { id: "boston", label: "Boston, MA", country: "US", lat: 42.3601, lng: -71.0589, timezone: "America/New_York" },
  { id: "philadelphia", label: "Philadelphia, PA", country: "US", lat: 39.9526, lng: -75.1652, timezone: "America/New_York" },
  { id: "san-francisco", label: "San Francisco, CA", country: "US", lat: 37.7749, lng: -122.4194, timezone: "America/Los_Angeles" },
  { id: "minneapolis", label: "Minneapolis, MN", country: "US", lat: 44.9778, lng: -93.265, timezone: "America/Chicago" },
  { id: "toronto", label: "Toronto, ON", country: "CA", lat: 43.6532, lng: -79.3832, timezone: "America/Toronto" },
  { id: "london", label: "London, UK", country: "GB", lat: 51.5074, lng: -0.1278, timezone: "Europe/London" },
];

export function getMarket(id: string): Market | undefined {
  return MARKETS.find((m) => m.id === id);
}

const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

/** Standard geohash encoding. */
export function geohash(lat: number, lng: number, precision = 9): string {
  let latMin = -90,
    latMax = 90,
    lngMin = -180,
    lngMax = 180;
  let hash = "";
  let bit = 0,
    ch = 0,
    even = true;
  while (hash.length < precision) {
    if (even) {
      const mid = (lngMin + lngMax) / 2;
      if (lng >= mid) {
        ch = (ch << 1) | 1;
        lngMin = mid;
      } else {
        ch = ch << 1;
        lngMax = mid;
      }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) {
        ch = (ch << 1) | 1;
        latMin = mid;
      } else {
        ch = ch << 1;
        latMax = mid;
      }
    }
    even = !even;
    if (++bit === 5) {
      hash += BASE32[ch];
      bit = 0;
      ch = 0;
    }
  }
  return hash;
}
