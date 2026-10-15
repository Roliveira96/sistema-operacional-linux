const two = (n: number) => String(n).padStart(2, "0");

/** mm:ss of a number of seconds, which never goes below zero; the minutes go past 59 instead of turning into hours (the round lasts up to 60 minutes). */
export function mmss(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${two(Math.floor(total / 60))}:${two(total % 60)}`;
}
