// Theme selection (SPEC-004). The initial theme is applied by an inline,
// render-blocking script before the first paint: the saved preference when
// there is one, otherwise the operating system preference.

export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "linux-lab-theme";

export function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark";
}

/** Returns the saved theme, or null when storage is empty or unavailable. */
export function readSavedTheme(storage: Pick<Storage, "getItem"> | undefined): Theme | null {
  try {
    const value = storage?.getItem(THEME_STORAGE_KEY);
    return isTheme(value) ? value : null;
  } catch {
    return null;
  }
}

/** Persists the theme; failures are ignored because the choice is a convenience. */
export function saveTheme(storage: Pick<Storage, "setItem"> | undefined, theme: Theme): void {
  try {
    storage?.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage may be blocked (private mode); the system preference still applies.
  }
}

export function systemTheme(matchMedia: ((query: string) => MediaQueryList) | undefined): Theme {
  try {
    return matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function resolveInitialTheme(win: Pick<Window, "localStorage" | "matchMedia">): Theme {
  let storage: Storage | undefined;
  try {
    storage = win.localStorage;
  } catch {
    storage = undefined;
  }
  return readSavedTheme(storage) ?? systemTheme(win.matchMedia?.bind(win));
}

export function applyTheme(root: HTMLElement, theme: Theme): void {
  root.dataset.theme = theme;
}

/**
 * Self-contained script injected in <head>. It must not depend on bundled
 * code because it runs before hydration; it mirrors resolveInitialTheme.
 */
export const themeInitScript = `(function () {
  var theme = "light";
  try {
    var saved = window.localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
    if (saved === "light" || saved === "dark") {
      theme = saved;
    } else if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
      theme = "dark";
    }
  } catch (e) {
    try {
      if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) theme = "dark";
    } catch (e2) {}
  }
  document.documentElement.dataset.theme = theme;
})();`;
