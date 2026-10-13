// Calendar days of the schedule (SPEC-042). Every day is a local date, never shifted by the time zone.

/** "YYYY-MM-DD" of the local calendar day of d. */
export function isoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The local day of a "YYYY-MM-DD" string. */
export function parseIsoDate(s: string): Date {
  const [y = 1970, m = 1, d = 1] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function sameDay(a: Date, b: Date): boolean {
  return isoDate(a) === isoDate(b);
}

/** Day of the week of a "YYYY-MM-DD" string, 0 = Sunday. */
export function weekdayIndex(s: string): number {
  return parseIsoDate(s).getDay();
}

/** The first day of the month `delta` months after the one of d. */
export function addMonths(d: Date, delta: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + delta, 1);
}

/** The days shown for a month: from the Sunday before the 1st, in whole weeks, at least 5 of them. */
export function monthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay());
  const days = new Date(year, month + 1, 0).getDate();
  const cells = Math.max(35, Math.ceil((first.getDay() + days) / 7) * 7);
  return Array.from({ length: cells }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
}

/** Minutes since midnight of "HH:MM". */
export function minutesOf(time: string): number {
  const [h = 0, m = 0] = time.split(":").map(Number);
  return h * 60 + m;
}

/** Lessons of 50 minutes in a time range, from 1 to 8 (SPEC-042, section 3.1.1). */
export function suggestLessons(start: string, end: string): number {
  const minutes = minutesOf(end) - minutesOf(start);
  return Math.min(8, Math.max(1, Math.floor(minutes / 50)));
}

/** Whether s is an https address. */
export function isHttpsUrl(s: string | undefined): boolean {
  if (!s) return false;
  try {
    const u = new URL(s.trim());
    return u.protocol === "https:" && u.host !== "";
  } catch {
    return false;
  }
}
