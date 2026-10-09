import { describe, expect, it } from "vitest";
import { moduleAccent, orderLabel, splitDescription } from "./moduleVisual";

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
    expect(splitDescription("a · b — ")).toEqual({ tags: [], summary: "a · b — " });
  });

  it("formats the order label", () => {
    expect(orderLabel(3)).toBe("03");
    expect(orderLabel(12)).toBe("12");
    expect(orderLabel(0)).toBeNull();
    expect(orderLabel()).toBeNull();
  });
});
