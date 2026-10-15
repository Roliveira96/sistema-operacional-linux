import { describe, expect, it } from "vitest";
import { clock, elapsed } from "./elapsed";

describe("elapsed", () => {
  it("writes the time span as h:mm:ss", () => {
    expect(elapsed(3_930_000)).toBe("1:05:30");
    expect(elapsed(-5)).toBe("0:00:00");
  });
});

// SPEC-058 CA-01: the header of the module shows the time of the class as hh:mm:ss
describe("clock", () => {
  it("writes the time span as hh:mm:ss, with two digits for the hour", () => {
    expect(clock(0)).toBe("00:00:00");
    expect(clock(5_000)).toBe("00:00:05");
    expect(clock(3_930_000)).toBe("01:05:30");
    expect(clock(36_000_000)).toBe("10:00:00");
  });

  it("keeps counting hours past 99, and drops the fractions of a second", () => {
    expect(clock(100 * 3_600_000)).toBe("100:00:00");
    expect(clock(59_999)).toBe("00:00:59");
  });

  it("never goes below zero, for a start a little ahead of the clock of the browser", () => {
    expect(clock(-4_000)).toBe("00:00:00");
  });
});
