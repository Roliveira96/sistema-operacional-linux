import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const globals = readFileSync(path.resolve(import.meta.dirname, "globals.scss"), "utf8");

// Covers SPEC-016: the terminal's closed editor (display: flex, hidden) took half of the window
// because a component stylesheet beat the hidden attribute. The global rule must keep winning.
describe("globals.scss", () => {
  it("makes the hidden attribute win over any display set by a component", () => {
    expect(globals).toMatch(/\[hidden\]\s*\{\s*display:\s*none\s*!important;?\s*\}/);
  });
});
