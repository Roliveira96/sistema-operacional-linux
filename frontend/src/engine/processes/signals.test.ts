import { describe, expect, it } from "vitest";
import { defaultAction, SIGNAL_NUMBERS, signalName, signalNumber, signalTable } from "./signals";

// Covers SPEC-029 CA-06: the signals of Linux and `kill -l`, as bash prints them.
describe("signals", () => {
  it("names the 62 signals of Linux, with the real-time ones counted from both ends", () => {
    expect(SIGNAL_NUMBERS).toHaveLength(62);
    expect([1, 2, 9, 10, 15, 17, 18, 19, 20, 28, 31].map(signalName)).toEqual(["HUP", "INT", "KILL", "USR1", "TERM", "CHLD", "CONT", "STOP", "TSTP", "WINCH", "SYS"]);
    expect([34, 35, 49, 50, 63, 64].map(signalName)).toEqual(["RTMIN", "RTMIN+1", "RTMIN+15", "RTMAX-14", "RTMAX-1", "RTMAX"]);
    // 32 and 33 are reserved by the C library; 0 and 65 are not signals.
    expect([0, 32, 33, 65, -1].map(signalName)).toEqual([null, null, null, null, null]);
  });

  it("reads a number, a name with or without SIG, in any case, and refuses what is none", () => {
    expect(signalNumber("9")).toBe(9);
    expect(signalNumber("KILL")).toBe(9);
    expect(signalNumber("sigkill")).toBe(9);
    expect(signalNumber("SigUsr2")).toBe(12);
    expect(signalNumber("RTMAX-1")).toBe(63);
    expect(signalNumber("0")).toBe(0);
    for (const bad of ["99", "32", "FOO", "", "SIG"]) expect(signalNumber(bad), bad).toBeNull();
  });

  it("prints the table in rows of five, the way bash does, and skips 32 and 33", () => {
    const rows = signalTable();
    expect(rows).toHaveLength(13);
    expect(rows[0]).toBe(" 1) SIGHUP\t 2) SIGINT\t 3) SIGQUIT\t 4) SIGILL\t 5) SIGTRAP\t");
    expect(rows[3]).toContain("16) SIGSTKFLT\t17) SIGCHLD");
    expect(rows[6]).toBe("31) SIGSYS\t34) SIGRTMIN\t35) SIGRTMIN+1\t36) SIGRTMIN+2\t37) SIGRTMIN+3\t");
    expect(rows[12]).toBe("63) SIGRTMAX-1\t64) SIGRTMAX\t");
  });

  it("knows what each signal does when nobody asked for anything else", () => {
    expect(defaultAction(17)).toBe("ignore");
    expect(defaultAction(28)).toBe("ignore");
    expect(defaultAction(19)).toBe("stop");
    expect(defaultAction(22)).toBe("stop");
    expect(defaultAction(18)).toBe("continue");
    for (const n of [1, 2, 9, 10, 12, 15]) expect(defaultAction(n)).toBe("terminate");
  });
});
