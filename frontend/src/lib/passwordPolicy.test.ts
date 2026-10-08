import { describe, expect, it } from "vitest";
import { checkPassword } from "./passwordPolicy";

// Mirrors SPEC-003 RN-14.
describe("checkPassword", () => {
  it("accepts a long passphrase", () => {
    expect(checkPassword("correct horse battery")).toEqual([]);
  });

  it("reports every violation", () => {
    expect(checkPassword("short")).toEqual(["TOO_SHORT"]);
    expect(checkPassword("x".repeat(129))).toEqual(["TOO_LONG"]);
    expect(checkPassword("User@Example.com", { email: "user@example.com" })).toEqual(["EQUALS_EMAIL"]);
    expect(checkPassword("same password!", { current: "same password!" })).toEqual(["SAME_AS_CURRENT"]);
  });

  it("counts characters, not bytes", () => {
    expect(checkPassword("ççççççççç1")).toEqual([]);
  });
});
