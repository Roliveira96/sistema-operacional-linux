import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiProblemError } from "@/services/httpClient";
import type { ModuleCheckResult } from "@/services/practiceService";
import { CHECK_DELAY_MS, useModuleCheck } from "./useModuleCheck";

const result = (passed: string[], completed: string[] = passed): ModuleCheckResult => ({
  passed,
  progress: completed.map((id) => ({ questionId: id, completedAt: "t" })),
});

const problem = (status: number, retryAfterSeconds?: number) => {
  const error = new ApiProblemError({ type: "x", title: "x", status }, status);
  return retryAfterSeconds === undefined ? error : Object.assign(error, { retryAfterSeconds });
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

// Covers SPEC-016 CA-04 and RN-03.
describe("useModuleCheck", () => {
  it("waits for a quiet moment and sends only the last machine state", async () => {
    const checkModule = vi.fn().mockResolvedValue(result(["q1"]));
    const { result: hook } = renderHook(() => useModuleCheck({ checkModule }, "m1"));

    act(() => hook.current.submit({ n: 1 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHECK_DELAY_MS - 100);
    });
    act(() => hook.current.submit({ n: 2 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHECK_DELAY_MS - 100);
    });
    expect(checkModule).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(checkModule).toHaveBeenCalledTimes(1);
    expect(checkModule).toHaveBeenCalledWith("m1", { n: 2 });
    expect(hook.current.completed.has("q1")).toBe(true);
  });

  it("reports only the challenges newly met", async () => {
    const checkModule = vi.fn().mockResolvedValueOnce(result(["q1"])).mockResolvedValueOnce(result(["q1", "q2"]));
    const onNew = vi.fn();
    const { result: hook } = renderHook(() => useModuleCheck({ checkModule }, "m1", onNew));
    for (const n of [1, 2]) {
      act(() => hook.current.submit({ n }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(CHECK_DELAY_MS + 10);
      });
    }
    expect(onNew.mock.calls).toEqual([[["q1"]], [["q2"]]]);
    expect([...hook.current.completed].sort()).toEqual(["q1", "q2"]);
  });

  it("never runs two checks at once and checks again with the newest state", async () => {
    let release: (value: ModuleCheckResult) => void = () => {};
    const checkModule = vi
      .fn()
      .mockImplementationOnce(() => new Promise<ModuleCheckResult>((resolve) => (release = resolve)))
      .mockResolvedValue(result(["q1"]));
    const { result: hook } = renderHook(() => useModuleCheck({ checkModule }, "m1"));

    act(() => hook.current.submit({ n: 1 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHECK_DELAY_MS + 10);
    });
    act(() => hook.current.submit({ n: 2 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHECK_DELAY_MS + 10);
    });
    expect(checkModule).toHaveBeenCalledTimes(1);

    await act(async () => {
      release(result([]));
      await vi.advanceTimersByTimeAsync(CHECK_DELAY_MS + 10);
    });
    expect(checkModule).toHaveBeenCalledTimes(2);
    expect(checkModule).toHaveBeenLastCalledWith("m1", { n: 2 });
  });

  it("asks the visitor to sign in on 401 and stops checking", async () => {
    const checkModule = vi.fn().mockRejectedValue(problem(401));
    const { result: hook } = renderHook(() => useModuleCheck({ checkModule }, "m1"));
    act(() => hook.current.submit({}));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHECK_DELAY_MS + 10);
    });
    expect(hook.current.needsLogin).toBe(true);
    act(() => hook.current.submit({}));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHECK_DELAY_MS + 10);
    });
    expect(checkModule).toHaveBeenCalledTimes(1);
  });

  it("waits for Retry-After after a 429 and then checks again", async () => {
    const checkModule = vi.fn().mockRejectedValueOnce(problem(429, 10)).mockResolvedValue(result(["q1"]));
    const { result: hook } = renderHook(() => useModuleCheck({ checkModule }, "m1"));
    act(() => hook.current.submit({ n: 1 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHECK_DELAY_MS + 10);
    });
    expect(checkModule).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9000);
    });
    expect(checkModule).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(checkModule).toHaveBeenCalledTimes(2);
    expect(hook.current.completed.has("q1")).toBe(true);
  });

  it("uses a default wait for a 429 without Retry-After and ignores other failures", async () => {
    const checkModule = vi.fn().mockRejectedValueOnce(problem(429)).mockRejectedValueOnce(new Error("network")).mockResolvedValue(result([]));
    const { result: hook } = renderHook(() => useModuleCheck({ checkModule }, "m1"));
    act(() => hook.current.submit({}));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHECK_DELAY_MS + 10);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5100);
    });
    expect(checkModule).toHaveBeenCalledTimes(2);
    expect(hook.current.needsLogin).toBe(false);
    act(() => hook.current.submit({}));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHECK_DELAY_MS + 10);
    });
    expect(checkModule).toHaveBeenCalledTimes(3);
  });

  it("starts from the progress loaded with the page", () => {
    const { result: hook } = renderHook(() => useModuleCheck({ checkModule: vi.fn() }, "m1"));
    act(() => hook.current.seed(["q9"]));
    expect(hook.current.completed.has("q9")).toBe(true);
  });
});
