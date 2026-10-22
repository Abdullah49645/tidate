const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parts(iso: string) {
  const d = new Date(`${iso}T00:00:00Z`);
  return { dow: DAYS[d.getUTCDay()], day: d.getUTCDate(), mon: MONTHS[d.getUTCMonth()], year: d.getUTCFullYear() };
}

/** "Sat 8 May" — calendar dates are formatted in UTC so they never shift with the viewer's time zone. */
export function fmtDay(iso: string) {
  const p = parts(iso);
  return `${p.dow} ${p.day} ${p.mon}`;
}

export function fmtDayYear(iso: string) {
  const p = parts(iso);
  return `${p.dow} ${p.day} ${p.mon} ${p.year}`;
}

export function fmtShort(iso: string) {
  const p = parts(iso);
  return `${p.day} ${p.mon}`;
}

export const fmt2 = (x: number | null | undefined) => (x === null || x === undefined ? "–" : x.toFixed(2));

export function fmtRelative(days: number) {
  if (days === 0) return "same night";
  const n = Math.abs(days);
  return `${n} day${n === 1 ? "" : "s"} ${days > 0 ? "after" : "before"}`;
}

export function fmtTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** Replace ISO dates in engine-generated prose with readable ones ("2027-05-08" -> "Sat 8 May"). */
export function humanizeDates(text: string) {
  return text.replace(/\b(\d{4}-\d{2}-\d{2})\b/g, (m) => fmtDay(m));
}
