import { describe, expect, it } from "vitest";
import { readSavedTheme, resolveInitialTheme, saveTheme, THEME_STORAGE_KEY, themeInitScript } from "./theme";

function matchMediaReturning(dark: boolean) {
  return (() => ({ matches: dark })) as unknown as (query: string) => MediaQueryList;
}

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  } as Storage;
}

const blockedStorage = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("SecurityError");
  },
} as unknown as Storage;

// Covers SPEC-004 CA-19.
describe("resolveInitialTheme", () => {
  it("prefers the saved theme", () => {
    const win = { localStorage: memoryStorage({ [THEME_STORAGE_KEY]: "light" }), matchMedia: matchMediaReturning(true) };
    expect(resolveInitialTheme(win)).toBe("light");
  });

  it("falls back to the system preference", () => {
    expect(resolveInitialTheme({ localStorage: memoryStorage(), matchMedia: matchMediaReturning(true) })).toBe("dark");
    expect(resolveInitialTheme({ localStorage: memoryStorage(), matchMedia: matchMediaReturning(false) })).toBe("light");
  });

  it("ignores invalid saved values and blocked storage", () => {
    const invalid = memoryStorage({ [THEME_STORAGE_KEY]: "purple" });
    expect(resolveInitialTheme({ localStorage: invalid, matchMedia: matchMediaReturning(true) })).toBe("dark");
    expect(resolveInitialTheme({ localStorage: blockedStorage, matchMedia: matchMediaReturning(true) })).toBe("dark");
  });

  it("never throws when saving to blocked storage", () => {
    expect(() => saveTheme(blockedStorage, "dark")).not.toThrow();
    expect(readSavedTheme(blockedStorage)).toBeNull();
  });
});

describe("themeInitScript", () => {
  it("applies the saved theme to the root element", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    new Function(themeInitScript)();
    expect(document.documentElement.dataset.theme).toBe("dark");
    window.localStorage.clear();
  });
});
