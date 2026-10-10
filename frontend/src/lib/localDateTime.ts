// Conversion between the instants the API speaks (RFC 3339, in UTC) and the value of an
// <input type="datetime-local"> (the wall clock of the browser, with no zone).
//
// The form used to cut the first 16 characters of the UTC string straight into the field, so a
// date saved as 10:00 in Brasília came back as 13:00 and moved three more hours at every save.

const pad = (n: number) => String(n).padStart(2, "0");

/** The wall-clock value of an instant, as a datetime-local field wants it ("" for none). */
export function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** The instant (RFC 3339, UTC) of a datetime-local value, or null for an empty or invalid one. */
export function localInputToIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** True when both dates are filled and the end comes before the start. */
export function endsBeforeStart(start: string, end: string): boolean {
  if (!start || !end) return false;
  const a = new Date(start).getTime();
  const b = new Date(end).getTime();
  return !Number.isNaN(a) && !Number.isNaN(b) && b < a;
}
