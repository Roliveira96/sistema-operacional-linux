import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPaced } from "./pace";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

// SPEC-065 section 3.1: the progress goes at most every 2 s and the picture of the terminal at most every 200 ms; the state is saved at most every 2 s.
describe("createPaced", () => {
  it("sends the first value at once and keeps the ones that follow until the interval is over, then sends only the last", () => {
    const send = vi.fn();
    const paced = createPaced<number>(send, 200);
    paced.push(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenLastCalledWith(1);
    paced.push(2);
    paced.push(3);
    vi.advanceTimersByTime(199);
    expect(send).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith(3);
    vi.advanceTimersByTime(1000);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("sends at once again when a value comes after the interval, with nothing waiting", () => {
    const send = vi.fn();
    const paced = createPaced<string>(send, 2000);
    paced.push("a");
    vi.advanceTimersByTime(2500);
    paced.push("b");
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith("b");
  });

  it("waits the whole interval before the first send when it does not lead, and keeps one send for the values of the interval", () => {
    const send = vi.fn();
    const paced = createPaced<number>(send, 2000, { leading: false });
    paced.push(1);
    vi.advanceTimersByTime(1999);
    expect(send).not.toHaveBeenCalled();
    paced.push(2);
    vi.advanceTimersByTime(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenLastCalledWith(2);
    vi.advanceTimersByTime(5000);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("tries again after the interval when the send says it did not go, with the newest value if a newer one came", () => {
    const send = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);
    const paced = createPaced<number>(send, 2000);
    paced.push(1);
    expect(send).toHaveBeenCalledTimes(1);
    paced.push(2);
    vi.advanceTimersByTime(2000);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith(2);
    vi.advanceTimersByTime(10_000);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("keeps trying the same value while the send keeps saying no", () => {
    const send = vi.fn(() => false);
    const paced = createPaced<number>(send, 2000);
    paced.push(7);
    vi.advanceTimersByTime(6000);
    expect(send).toHaveBeenCalledTimes(4);
    expect(send).toHaveBeenLastCalledWith(7);
  });

  it("flush sends what is waiting at once, and cancel drops it", () => {
    const send = vi.fn();
    const paced = createPaced<number>(send, 2000, { leading: false });
    paced.push(1);
    paced.flush();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenLastCalledWith(1);
    paced.flush();
    expect(send).toHaveBeenCalledTimes(1);
    paced.push(2);
    paced.cancel();
    vi.advanceTimersByTime(5000);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
