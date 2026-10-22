const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// Calendar dates are formatted in UTC so they never shift with the viewer's time zone.
function parts(iso: string) {
  const d = new Date(`${iso}T00:00:00Z`);
  return { dow: d.getUTCDay(), day: d.getUTCDate(), mon: d.getUTCMonth(), year: d.getUTCFullYear() };
}

/** "Sat, May 8" */
export function fmtDay(iso: string) {
  const p = parts(iso);
  return `${DAYS[p.dow]}, ${MONTHS[p.mon]} ${p.day}`;
}

/** "Saturday, May 8" */
export function fmtLong(iso: string) {
  const p = parts(iso);
  return `${DAYS_LONG[p.dow]}, ${MONTHS_LONG[p.mon]} ${p.day}`;
}

/** "May 8" */
export function fmtShort(iso: string) {
  const p = parts(iso);
  return `${MONTHS[p.mon]} ${p.day}`;
}

export function fmtYear(iso: string) {
  return String(parts(iso).year);
}

export const fmt2 = (x: number | null | undefined) => (x === null || x === undefined ? "–" : x.toFixed(2));

export function fmtRelative(days: number) {
  if (days === 0) return "Same night";
  const n = Math.abs(days);
  return `${n} day${n === 1 ? "" : "s"} ${days > 0 ? "after" : "before"}`;
}

export function fmtTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** Replace ISO dates in engine-generated prose with readable ones ("2027-05-08" -> "Sat, May 8"). */
export function humanizeDates(text: string) {
  return text.replace(/\b(\d{4}-\d{2}-\d{2})\b/g, (m) => fmtDay(m));
}
