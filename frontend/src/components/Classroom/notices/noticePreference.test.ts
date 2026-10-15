import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NOTICE_KEY, readNoticePreference, useNoticePreference, writeNoticePreference } from "./noticePreference";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

// SPEC-064 CA-05: the choice, on or off, is kept in the browser
describe("the preference of the notices, in the browser", () => {
  it("is on by default, once the permission is given", () => {
    expect(readNoticePreference()).toBe(true);
  });

  it("keeps what was written, off and on again", () => {
    writeNoticePreference(false);
    expect(localStorage.getItem(NOTICE_KEY)).toBe("off");
    expect(readNoticePreference()).toBe(false);
    writeNoticePreference(true);
    expect(localStorage.getItem(NOTICE_KEY)).toBe("on");
    expect(readNoticePreference()).toBe(true);
  });

  it("has a key of its own, apart from the sound of the panel", () => {
    writeNoticePreference(false);
    expect(NOTICE_KEY).not.toBe("live-arrival-sound");
    expect(localStorage.getItem("live-arrival-sound")).toBeNull();
  });

  it("reads as on when the browser does not let it read, and does not break", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    expect(() => readNoticePreference()).not.toThrow();
    expect(readNoticePreference()).toBe(true);
  });

  it("does not break when the browser does not let it write: the choice just does not last", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    expect(() => writeNoticePreference(false)).not.toThrow();
  });
});

describe("useNoticePreference", () => {
  it("starts from what the browser kept", () => {
    localStorage.setItem(NOTICE_KEY, "off");
    const { result } = renderHook(() => useNoticePreference());
    expect(result.current[0]).toBe(false);
  });

  it("starts on when nothing was kept", () => {
    const { result } = renderHook(() => useNoticePreference());
    expect(result.current[0]).toBe(true);
  });

  it("changes and keeps the choice", () => {
    const { result } = renderHook(() => useNoticePreference());
    act(() => result.current[1](false));
    expect(result.current[0]).toBe(false);
    expect(localStorage.getItem(NOTICE_KEY)).toBe("off");
    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);
    expect(localStorage.getItem(NOTICE_KEY)).toBe("on");
  });

  it("changes the choice for this screen even when the browser does not keep it", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    const { result } = renderHook(() => useNoticePreference());
    act(() => result.current[1](false));
    expect(result.current[0]).toBe(false);
  });
});
