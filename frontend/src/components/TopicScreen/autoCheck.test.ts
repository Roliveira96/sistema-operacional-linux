import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { problem } from "@/test/helpers";
import { createAutoCheck, type AutoCheckOptions } from "./autoCheck";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const ok = { passed: ["q"], progress: [] };

function setup(check: ReturnType<typeof vi.fn>) {
  const onResult = vi.fn();
  const onUnauthorized = vi.fn();
  let n = 0;
  const auto = createAutoCheck({ check: check as unknown as AutoCheckOptions["check"], snapshot: () => ({ n: ++n }), onResult, onUnauthorized });
  return { auto, onResult, onUnauthorized };
}

// Covers SPEC-016 RN-03, CA-04 and CA-05 (client side).
describe("createAutoCheck", () => {
  it("checks once after a quiet period", async () => {
    const check = vi.fn().mockResolvedValue(ok);
    const { auto, onResult } = setup(check);
    auto.schedule();
    await vi.advanceTimersByTimeAsync(300);
    auto.schedule();
    await vi.advanceTimersByTimeAsync(599);
    expect(check).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(check).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith(ok);
  });

  it("never runs two checks at once and checks again afterwards", async () => {
    let release: (v: unknown) => void = () => {};
    const check = vi.fn().mockImplementationOnce(() => new Promise((r) => (release = r))).mockResolvedValue(ok);
    const { auto } = setup(check);
    auto.schedule();
    await vi.advanceTimersByTimeAsync(600);
    auto.schedule();
    await vi.advanceTimersByTimeAsync(600);
    expect(check).toHaveBeenCalledTimes(1);
    release(ok);
    await vi.advanceTimersByTimeAsync(600);
    expect(check).toHaveBeenCalledTimes(2);
  });

  it("stops for visitors", async () => {
    const check = vi.fn().mockRejectedValue(problem("not-authenticated", 401));
    const { auto, onUnauthorized } = setup(check);
    auto.schedule();
    await vi.advanceTimersByTimeAsync(600);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    auto.schedule();
    await vi.advanceTimersByTimeAsync(5000);
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("waits for Retry-After and ignores other failures", async () => {
    const check = vi
      .fn()
      .mockRejectedValueOnce(problem("rate-limited", 429, { retryAfterSeconds: 3 }))
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(ok);
    const { auto, onResult } = setup(check);
    auto.schedule();
    await vi.advanceTimersByTimeAsync(600);
    await vi.advanceTimersByTimeAsync(2999);
    expect(check).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(check).toHaveBeenCalledTimes(2);
    expect(onResult).not.toHaveBeenCalled();
    auto.schedule();
    await vi.advanceTimersByTimeAsync(600);
    expect(onResult).toHaveBeenCalledWith(ok);
    auto.stop();
    auto.schedule();
    await vi.advanceTimersByTimeAsync(600);
    expect(check).toHaveBeenCalledTimes(3);
  });
});
