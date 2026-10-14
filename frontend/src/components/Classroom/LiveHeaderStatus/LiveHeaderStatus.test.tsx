import { readFileSync } from "node:fs";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveHeaderStatus } from "./LiveHeaderStatus";

const styleOf = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const STARTED = "2026-10-14T10:00:00Z";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(new Date("2026-10-14T11:05:30Z"));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const timer = () => screen.getByRole("timer", { name: "Tempo de aula" });

// SPEC-058 CA-01, CA-02: the time of the class and the raised hands, on the right of the title of the module
describe("LiveHeaderStatus", () => {
  it("shows the time of the class as hh:mm:ss since the start", () => {
    render(<LiveHeaderStatus startedAt={STARTED} hands={0} />);
    expect(timer().textContent).toBe("01:05:30");
  });

  it("keeps the clock going, second by second", () => {
    render(<LiveHeaderStatus startedAt={STARTED} hands={0} />);
    act(() => void vi.advanceTimersByTime(1000));
    expect(timer().textContent).toBe("01:05:31");
    act(() => void vi.advanceTimersByTime(59_000));
    expect(timer().textContent).toBe("01:06:30");
  });

  it("corrects the clock at once when the room tells another start, as every snapshot does", () => {
    const view = render(<LiveHeaderStatus startedAt={STARTED} hands={0} />);
    view.rerender(<LiveHeaderStatus startedAt="2026-10-14T10:30:00Z" hands={0} />);
    expect(timer().textContent).toBe("00:35:30");
  });

  it("starts at 00:00:00 for a start that is a little ahead of the clock of the browser", () => {
    render(<LiveHeaderStatus startedAt="2026-10-14T11:05:34Z" hands={0} />);
    expect(timer().textContent).toBe("00:00:00");
  });

  it("shows the hands as an icon and a number, with the label for who cannot see the icon", () => {
    render(<LiveHeaderStatus startedAt={STARTED} hands={3} />);
    const hands = screen.getByRole("img", { name: "3 mãos levantadas" });
    expect(hands.textContent).toBe("3");
    expect(hands.querySelector("svg")).not.toBeNull();
  });

  it("says 0 when nobody has the hand up", () => {
    render(<LiveHeaderStatus startedAt={STARTED} hands={0} />);
    expect(screen.getByRole("img", { name: "0 mãos levantadas" }).textContent).toBe("0");
  });

  it("says one hand in the singular", () => {
    render(<LiveHeaderStatus startedAt={STARTED} hands={1} />);
    expect(screen.getByRole("img", { name: "1 mão levantada" }).textContent).toBe("1");
  });

  // CA-02
  it("follows the number of hands as they go up and down", () => {
    const view = render(<LiveHeaderStatus startedAt={STARTED} hands={1} />);
    view.rerender(<LiveHeaderStatus startedAt={STARTED} hands={2} />);
    expect(screen.getByRole("img", { name: "2 mãos levantadas" }).textContent).toBe("2");
    view.rerender(<LiveHeaderStatus startedAt={STARTED} hands={0} />);
    expect(screen.getByRole("img", { name: "0 mãos levantadas" }).textContent).toBe("0");
  });

  it("stops the clock when it goes away", () => {
    const view = render(<LiveHeaderStatus startedAt={STARTED} hands={0} />);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses only the tokens of the theme, with no color written in the style", () => {
    const css = styleOf("./LiveHeaderStatus.module.scss");
    expect(css.length).toBeGreaterThan(0);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\brgba?\(/);
    expect(css).not.toMatch(/\bhsla?\(/);
  });
});
