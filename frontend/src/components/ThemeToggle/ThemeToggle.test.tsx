import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { messages } from "@/messages/pt-BR";
import { THEME_STORAGE_KEY } from "@/theme/theme";
import { ThemeToggle } from "./ThemeToggle";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

// Covers SPEC-004 CA-20.
describe("ThemeToggle", () => {
  it("switches data-theme and remembers the choice", async () => {
    document.documentElement.dataset.theme = "light";
    await act(async () => {
      render(<ThemeToggle />);
    });

    fireEvent.click(screen.getByRole("button", { name: messages.theme.switchToDark }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");

    fireEvent.click(screen.getByRole("button", { name: messages.theme.switchToLight }));
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });
});
