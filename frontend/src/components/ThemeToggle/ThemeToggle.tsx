"use client";

import { useEffect, useState } from "react";
import { messages } from "@/messages/pt-BR";
import { applyTheme, isTheme, saveTheme, type Theme } from "@/theme/theme";
import styles from "./ThemeToggle.module.scss";

function currentTheme(): Theme | null {
  const value = document.documentElement.dataset.theme;
  return isTheme(value) ? value : null;
}

function safeLocalStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/** Switches between light and dark themes without reloading the page. */
export function ThemeToggle() {
  // The theme is set by the inline head script before hydration; null until
  // mounted keeps server and client markup identical.
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    // Sync once with the theme the inline script already applied.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(currentTheme() ?? "light");
  }, []);

  function toggle() {
    const next: Theme = (currentTheme() ?? "light") === "dark" ? "light" : "dark";
    applyTheme(document.documentElement, next);
    saveTheme(safeLocalStorage(), next);
    setTheme(next);
  }

  const label = theme === "dark" ? messages.theme.switchToLight : messages.theme.switchToDark;

  return (
    <button type="button" className={styles.toggle} onClick={toggle} aria-label={label} title={label}>
      <span aria-hidden="true" className={styles.icon}>
        {theme === "dark" ? "☀" : "☾"}
      </span>
    </button>
  );
}
