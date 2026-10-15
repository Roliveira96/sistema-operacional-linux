import { readdirSync, readFileSync } from "node:fs";
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

// The build turns the name inside ::highlight() of a CSS Module into a local name (::highlight(teacher-material) becomes ::highlight(_1ZEqVW_teacher-material)),
// and the browser registers the highlight with the plain one: the mark of the teacher's selection was never painted on the screen of the student. The rules of
// the highlights live in the global stylesheet, where the names stay as they are.
describe("the highlights of the browser", () => {
  it("are painted by the global stylesheet, for the selection of the teacher", () => {
    expect(globals).toMatch(/::highlight\(teacher-material\)/);
    expect(globals).toMatch(/::highlight\(teacher-terminal\)/);
  });

  it("are in no CSS Module, whose build would rename them", () => {
    const modules = (readdirSync(path.resolve(import.meta.dirname, ".."), { recursive: true }) as string[]).filter((file) => file.endsWith(".module.scss"));
    const named = modules.filter((file) => readFileSync(path.resolve(import.meta.dirname, "..", file), "utf8").includes("::highlight("));
    expect(named).toEqual([]);
  });
});
