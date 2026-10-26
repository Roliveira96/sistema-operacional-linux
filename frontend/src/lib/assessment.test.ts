import { describe, expect, it } from "vitest";
import { STARTED, summary } from "@/test/assessmentFixtures";
import {
  countdown,
  equalWeights,
  formatPeriod,
  formatScore,
  fromLocalInput,
  needsClearanceWarning,
  needsStartWarning,
  sumWeights,
  toLocalInput,
} from "./assessment";

// SPEC-075 RN-06, D-14: points are whole hundredths, so the sum is exact.
describe("equalWeights", () => {
  it("shares the maximum in hundredths and gives the leftovers to the first questions", () => {
    expect(equalWeights(10, 3)).toEqual([3.34, 3.33, 3.33]);
    expect(equalWeights(10, 4)).toEqual([2.5, 2.5, 2.5, 2.5]);
    expect(equalWeights(0.05, 3)).toEqual([0.02, 0.02, 0.01]);
  });

  it("always closes the sum", () => {
    for (const [max, n] of [[10, 3], [7, 6], [100, 7], [9.99, 5], [0.1, 3]] as const) {
      expect(sumWeights(equalWeights(max, n))).toBe(Math.round(max * 100));
    }
  });

  it("has no weights without questions", () => {
    expect(equalWeights(10, 0)).toEqual([]);
  });
});

describe("sumWeights", () => {
  it("adds in whole hundredths, with none of the error of a float", () => {
    expect(sumWeights([0.1, 0.2])).toBe(30);
    expect(sumWeights([3.34, 3.33, 3.33])).toBe(1000);
    expect(sumWeights([])).toBe(0);
  });
});

describe("formatScore", () => {
  it("writes the points with two places and a decimal comma", () => {
    expect(formatScore(10)).toBe("10,00");
    expect(formatScore(3.3)).toBe("3,30");
    expect(formatScore(0)).toBe("0,00");
  });
});

describe("formatPeriod", () => {
  it("writes an exam of one day as a day and a range of hours", () => {
    expect(formatPeriod("2026-10-23T09:00:00-03:00", "2026-10-23T11:00:00-03:00")).toBe("23/10/2026, 09:00–11:00");
  });

  it("writes an assignment of several days with both ends", () => {
    expect(formatPeriod("2026-10-23T09:00:00-03:00", "2026-10-30T23:59:00-03:00")).toBe("23/10/2026 09:00 a 30/10/2026 23:59");
  });
});

// The fields of date and time take a local value; the server wants Brasília (SPEC-042 RN-13).
describe("local input", () => {
  it("sends the value of the field with the offset of Brasília", () => {
    expect(fromLocalInput("2026-10-23T09:00")).toBe("2026-10-23T09:00:00-03:00");
  });

  it("fills the field with the date and the time the server wrote", () => {
    expect(toLocalInput("2026-10-23T09:00:00-03:00")).toBe("2026-10-23T09:00");
    expect(toLocalInput(undefined)).toBe("");
  });
});

describe("countdown", () => {
  it("counts hours, minutes and seconds", () => {
    expect(countdown(90 * 60_000)).toBe("01:30:00");
    expect(countdown(59_000)).toBe("00:00:59");
  });

  it("counts the days when there is more than one", () => {
    expect(countdown((2 * 24 * 60 + 3 * 60 + 10) * 60_000)).toBe("2 d 03:10:00");
  });

  it("stops at zero", () => {
    expect(countdown(-5000)).toBe("00:00:00");
  });
});

// SPEC-083 CA-12, D-06, D-07: the list tells the teacher to start the exam when it can start, and warns about the students who wait only after it started.
describe("warnings of the list", () => {
  const ready = () => summary({ phase: "RUNNING", startsAt: "2026-10-21T09:00:00-03:00", endsAt: "2026-10-21T11:00:00-03:00" });
  const started = (over = {}) => summary({ ...STARTED, clearanceCounts: { pending: 3, approved: 29, rejected: 0 }, ...over });

  it("says the exam can be started when it is in person, scheduled and running, and nobody started it", () => {
    expect(needsStartWarning(ready())).toBe(true);
    expect(needsStartWarning(summary({ ...ready(), requiresClearance: false }))).toBe(true);
  });

  it("does not say it before the start time, after the end, once started, online or canceled", () => {
    expect(needsStartWarning(summary())).toBe(false);
    expect(needsStartWarning(summary({ ...ready(), phase: "ENDED" }))).toBe(false);
    expect(needsStartWarning(started())).toBe(false);
    expect(needsStartWarning(summary({ ...ready(), modality: "ONLINE", requiresClearance: false }))).toBe(false);
    expect(needsStartWarning(summary({ ...ready(), status: "CANCELED" }))).toBe(false);
  });

  it("warns about who waits only after the start, with the exam still running", () => {
    expect(needsClearanceWarning(started())).toBe(true);
    expect(needsClearanceWarning(started({ clearanceCounts: { pending: 0, approved: 32, rejected: 0 } }))).toBe(false);
    expect(needsClearanceWarning(started({ phase: "ENDED" }))).toBe(false);
    expect(needsClearanceWarning(started({ requiresClearance: false }))).toBe(false);
    expect(needsClearanceWarning(started({ status: "CANCELED" }))).toBe(false);
  });

  it("no longer warns before the start, not even 30 minutes before the start time or while the exam runs without being started", () => {
    const waiting = { clearanceCounts: { pending: 3, approved: 29, rejected: 0 } };
    expect(needsClearanceWarning(summary({ ...waiting, startsAt: "2026-10-21T10:30:00-03:00", endsAt: "2026-10-21T12:00:00-03:00" }))).toBe(false);
    expect(needsClearanceWarning(summary({ ...ready(), ...waiting }))).toBe(false);
  });
});
