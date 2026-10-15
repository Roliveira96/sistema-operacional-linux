import { describe, expect, it } from "vitest";
import { mmss } from "./format";

// SPEC-065: the time of the exercise, the time left and the time a student took, all as mm:ss.
describe("mmss", () => {
  it("writes minutes and seconds with two digits each", () => {
    expect(mmss(0)).toBe("00:00");
    expect(mmss(65)).toBe("01:05");
    expect(mmss(192)).toBe("03:12");
  });

  it("goes past an hour in minutes, and never below zero", () => {
    expect(mmss(3600)).toBe("60:00");
    expect(mmss(-4)).toBe("00:00");
  });

  it("drops the fraction of a second", () => {
    expect(mmss(59.9)).toBe("00:59");
  });
});
