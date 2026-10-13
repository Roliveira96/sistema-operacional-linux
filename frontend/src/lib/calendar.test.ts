import { describe, expect, it } from "vitest";
import { addMonths, isoDate, monthGrid, parseIsoDate, sameDay, suggestLessons, minutesOf, weekdayIndex } from "./calendar";

describe("calendar helpers (SPEC-042)", () => {
  it("formats and parses local calendar days", () => {
    const d = parseIsoDate("2026-10-19");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(9);
    expect(d.getDate()).toBe(19);
    expect(isoDate(d)).toBe("2026-10-19");
    expect(sameDay(d, new Date(2026, 9, 19, 23, 0))).toBe(true);
    expect(weekdayIndex("2026-10-19")).toBe(1);
  });

  it("builds a month grid that starts on Sunday and has whole weeks", () => {
    const grid = monthGrid(2026, 9); // October 2026 starts on a Thursday
    expect(grid.length % 7).toBe(0);
    expect(isoDate(grid[0]!)).toBe("2026-09-27");
    expect(grid.some((d) => isoDate(d) === "2026-10-31")).toBe(true);
    expect(monthGrid(2026, 1).length).toBe(35); // February 2026 starts on a Sunday
  });

  it("moves months across years", () => {
    expect(isoDate(addMonths(new Date(2026, 11, 15), 1))).toBe("2027-01-01");
    expect(isoDate(addMonths(new Date(2026, 0, 31), -1))).toBe("2025-12-01");
  });

  it("suggests the number of lessons by the duration, from 1 to 8 (50 min each)", () => {
    expect(minutesOf("08:20")).toBe(500);
    expect(suggestLessons("08:20", "10:00")).toBe(2);
    expect(suggestLessons("19:00", "22:30")).toBe(4);
    expect(suggestLessons("08:00", "08:20")).toBe(1);
    expect(suggestLessons("07:00", "23:00")).toBe(8);
    expect(suggestLessons("10:00", "09:00")).toBe(1);
  });
});
