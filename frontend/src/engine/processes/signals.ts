// The signals of Linux (x86), the way bash lists them with `kill -l` (SPEC-029 CA-06).

const STANDARD = [
  "HUP", "INT", "QUIT", "ILL", "TRAP", "ABRT", "BUS", "FPE", "KILL", "USR1", "SEGV", "USR2", "PIPE", "ALRM", "TERM", "STKFLT",
  "CHLD", "CONT", "STOP", "TSTP", "TTIN", "TTOU", "URG", "XCPU", "XFSZ", "VTALRM", "PROF", "WINCH", "IO", "PWR", "SYS",
];

/** The real-time signals: 34 is RTMIN, 64 is RTMAX, and the ones between count up from the first and down from the last. */
function realTime(number: number): string {
  if (number === 34) return "RTMIN";
  if (number === 64) return "RTMAX";
  return number <= 49 ? `RTMIN+${number - 34}` : `RTMAX-${64 - number}`;
}

/** Every signal number there is, in the order `kill -l` prints them (32 and 33 are reserved by the C library and are not listed). */
export const SIGNAL_NUMBERS: number[] = [...Array.from({ length: 31 }, (_, i) => i + 1), ...Array.from({ length: 31 }, (_, i) => i + 34)];

/** The name of a signal without the SIG prefix, or null when there is no such signal. */
export function signalName(number: number): string | null {
  if (number >= 1 && number <= 31) return STANDARD[number - 1]!;
  if (number >= 34 && number <= 64) return realTime(number);
  return null;
}

/** The number of a signal given as a number, or as a name with or without SIG in any case; null when it is none. */
export function signalNumber(text: string): number | null {
  if (/^\d+$/.test(text)) {
    const number = Number(text);
    return number === 0 || signalName(number) !== null ? number : null;
  }
  const name = text.toUpperCase().replace(/^SIG/, "");
  return SIGNAL_NUMBERS.find((number) => signalName(number) === name) ?? null;
}

/** The text of `kill -l`: five signals per line, as bash prints them. */
export function signalTable(): string[] {
  const rows: string[] = [];
  for (let i = 0; i < SIGNAL_NUMBERS.length; i += 5) {
    rows.push(
      SIGNAL_NUMBERS.slice(i, i + 5)
        .map((number) => `${String(number).padStart(2)}) SIG${signalName(number)}\t`)
        .join("")
        .replace(/\t$/, "\t"),
    );
  }
  return rows;
}

/** What each signal does by default to a process that did not ask for anything else. */
export type SignalAction = "ignore" | "stop" | "continue" | "terminate";

export function defaultAction(number: number): SignalAction {
  if ([17, 23, 28].includes(number)) return "ignore"; // CHLD, URG, WINCH
  if ([19, 20, 21, 22].includes(number)) return "stop"; // STOP, TSTP, TTIN, TTOU
  if (number === 18) return "continue";
  return "terminate";
}
