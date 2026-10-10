import { describe, expect, it } from "vitest";
import { accountName, isCompleteMode, octalMode } from "./inputs";
import { invalidFiles } from "./setup";

// Nothing outside what is expected gets into a field of the snapshot.
describe("octalMode", () => {
  it("keeps only the digits 0 to 7, up to 4 of them", () => {
    expect(octalMode("644")).toBe("644");
    expect(octalMode("0755")).toBe("0755");
    expect(octalMode("888")).toBe("");
    expect(octalMode("8888")).toBe("");
    expect(octalMode("abc123")).toBe("123");
    expect(octalMode("7 5 5")).toBe("755");
    expect(octalMode("12345")).toBe("1234");
    expect(octalMode("-6+4.4")).toBe("644");
    expect(octalMode("")).toBe("");
  });

  it("says whether a permission is complete: 3 or 4 digits, or none", () => {
    for (const ok of ["", "644", "755", "1777", "0644"]) expect(isCompleteMode(ok)).toBe(true);
    for (const bad of ["6", "64", "12345", "888", "abc"]) expect(isCompleteMode(bad)).toBe(false);
  });
});

describe("accountName", () => {
  it("keeps only what a user or group name can have", () => {
    expect(accountName("ricardo")).toBe("ricardo");
    expect(accountName("Ana Maria")).toBe("anamaria");
    expect(accountName("1ana")).toBe("ana");
    expect(accountName("-x")).toBe("x");
    expect(accountName("a/b:c;d")).toBe("abcd");
    expect(accountName("dev_ops-2")).toBe("dev_ops-2");
    expect(accountName("a".repeat(40))).toHaveLength(32);
  });
});

describe("invalidFiles", () => {
  it("finds the files the server would refuse", () => {
    const setup = { summary: "", steps: [], files: [{ path: "/ok", content: "", mode: "644" }, { path: "relativo", content: "" }, { path: "/", content: "" }, { path: "/b", content: "", mode: "64" }, { path: "/c", content: "" }] };
    expect(invalidFiles(setup)).toEqual([{ path: "relativo", reason: "path" }, { path: "/", reason: "path" }, { path: "/b", reason: "mode" }]);
    expect(invalidFiles(undefined)).toEqual([]);
  });
});
