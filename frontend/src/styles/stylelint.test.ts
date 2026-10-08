// @vitest-environment node
import path from "node:path";
import stylelint from "stylelint";
import { describe, expect, it } from "vitest";

const configFile = path.resolve(import.meta.dirname, "../../stylelint.config.mjs");

async function lint(code: string, codeFilename: string) {
  const result = await stylelint.lint({ code, codeFilename, configFile });
  return result.results[0]!.warnings.map((w) => w.rule);
}

// Covers SPEC-004 CA-18.
describe("stylelint color policy", () => {
  const component = path.resolve(import.meta.dirname, "../components/Fake/Fake.module.scss");

  it.each([
    ["hex", ".box {\n  color: #fff;\n}\n", "color-no-hex"],
    ["named", ".box {\n  color: red;\n}\n", "color-named"],
    ["function", ".box {\n  color: rgb(0 0 0);\n}\n", "function-disallowed-list"],
  ])("rejects %s colors in components", async (_kind, code, rule) => {
    expect(await lint(code, component)).toContain(rule);
  });

  it("accepts tokens in components", async () => {
    expect(await lint(".box {\n  color: var(--color-text-primary);\n}\n", component)).toEqual([]);
  });

  it("allows literals in the tokens file", async () => {
    const tokens = path.resolve(import.meta.dirname, "_tokens.scss");
    expect(await lint(":root {\n  --color-bg: #fff;\n}\n", tokens)).toEqual([]);
  });
});
