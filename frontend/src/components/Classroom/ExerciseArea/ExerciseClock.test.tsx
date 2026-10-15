import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { round } from "@/test/exerciseFixtures";
import { ExerciseClock } from "./ExerciseClock";

beforeEach(() => vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"], now: new Date("2026-10-14T13:00:00.000Z") }));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const time = () => screen.getByRole("timer", { name: "Tempo restante" }).textContent;
const clock = (over = {}) => <ExerciseClock exercise={round(over)} label="Tempo restante" />;

// SPEC-065 CA-03: the clock is the same for everybody, by the end of the round and by the clock of the server
describe("ExerciseClock", () => {
  it("counts the time left to the end of the round, as minutes and seconds, with the label it was given", () => {
    render(clock());
    expect(time()).toBe("05:00");
  });

  it("corrects the clock of the browser by the one of the server", () => {
    // The server is 30 s ahead of this browser, so 30 s of the 5 minutes are already gone.
    render(clock({ skewMs: 30_000 }));
    expect(time()).toBe("04:30");
  });

  it("counts down every second", () => {
    render(clock());
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(time()).toBe("04:59");
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(time()).toBe("03:59");
  });

  it("stops at 00:00 and never goes below it, as the server is the one that ends the round", () => {
    render(clock());
    act(() => {
      vi.advanceTimersByTime(400_000);
    });
    expect(time()).toBe("00:00");
  });

  it("starts at 00:00 for a round that is already over by its end time", () => {
    render(clock({ endsAt: "2026-10-14T12:59:00.000Z" }));
    expect(time()).toBe("00:00");
  });

  it("stops ticking when it goes away", () => {
    const view = render(clock());
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
