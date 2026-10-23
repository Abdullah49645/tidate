const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** The recommended date as a desk-calendar leaf. Formatted in UTC so the date never shifts. */
export function CalendarTile({ iso, year }: { iso: string; year?: boolean }) {
  const d = new Date(`${iso}T00:00:00Z`);
  return (
    <div className="cal-tile" aria-hidden>
      <div className="cal-month">
        {MONTHS[d.getUTCMonth()]}
        {year ? ` ${d.getUTCFullYear()}` : ""}
      </div>
      <div className="cal-day">{d.getUTCDate()}</div>
      <div className="cal-dow">{DAYS[d.getUTCDay()]}</div>
    </div>
  );
}
