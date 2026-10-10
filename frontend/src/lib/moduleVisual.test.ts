import { describe, expect, it } from "vitest";
import { moduleAccent, orderLabel, splitDescription, topicAccentVars } from "./moduleVisual";

// Covers SPEC-015 CA-04 (card data).
describe("moduleVisual", () => {
  it("maps legacy colors to the module accent token", () => {
    expect(moduleAccent("--cor-dir")).toEqual({ "--module-accent": "var(--color-module-dir)" });
    expect(moduleAccent("red")).toBeUndefined();
    expect(moduleAccent()).toBeUndefined();
  });

  it("splits tags and summary", () => {
    expect(splitDescription("pwd · ls · cd — Onde estou.")).toEqual({ tags: ["pwd", "ls", "cd"], summary: "Onde estou." });
  });

  it("keeps descriptions without the legacy shape whole", () => {
    expect(splitDescription("Texto simples.")).toEqual({ tags: [], summary: "Texto simples." });
    expect(splitDescription("a · b — ")).toEqual({ tags: [], summary: "a · b —" });
    // A formatted description is split by its visible text.
    expect(splitDescription("<p>ls · cd — <b>Navegar</b></p>")).toEqual({ tags: ["ls", "cd"], summary: "Navegar" });
  });

  it("formats the order label", () => {
    expect(orderLabel(3)).toBe("03");
    expect(orderLabel(12)).toBe("12");
    expect(orderLabel(0)).toBeNull();
    expect(orderLabel()).toBeNull();
  });

  // Covers SPEC-016: the topic screen takes the module color and mixes its tints.
  it("builds the accent variables of the topic screen", () => {
    const vars = topicAccentVars("--cor-dir") as Record<string, string>;
    expect(vars["--accent"]).toBe("var(--color-module-dir)");
    expect(vars["--accent-soft"]).toContain("color-mix");
    expect((topicAccentVars("red") as Record<string, string>)["--accent"]).toBe("var(--color-accent)");
    expect((topicAccentVars() as Record<string, string>)["--accent"]).toBe("var(--color-accent)");
  });
});
