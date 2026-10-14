const two = (n: number) => String(n).padStart(2, "0");

/** Hours, minutes and seconds of a time span, which never goes below zero. */
function parts(ms: number): [number, number, number] {
  const total = Math.max(0, Math.floor(ms / 1000));
  return [Math.floor(total / 3600), Math.floor(total / 60) % 60, total % 60];
}

/** h:mm:ss of a time span. */
export function elapsed(ms: number): string {
  const [hours, minutes, seconds] = parts(ms);
  return `${hours}:${two(minutes)}:${two(seconds)}`;
}

/** hh:mm:ss of a time span, with two digits for the hours: the clock of the header of the module in the live class (SPEC-058). */
export function clock(ms: number): string {
  return parts(ms).map(two).join(":");
}
