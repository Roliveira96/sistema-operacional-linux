import { describe, expect, it } from "vitest";
import { shellQuote, writtenFile } from "./setupContent";

// Covers the editor sessions of a recording: they are not commands, their text reaches the snapshot as a file (SPEC-021).
describe("setupContent", () => {
  it("finds the file an editor-like command writes", () => {
    expect(writtenFile("nano /home/ana/a.txt")).toBe("/home/ana/a.txt");
    expect(writtenFile("vim -n /srv/b.txt")).toBe("/srv/b.txt");
    expect(writtenFile("vi c.txt")).toBe("c.txt");
    expect(writtenFile("tee /tmp/t.txt")).toBe("/tmp/t.txt");
    expect(writtenFile("cat > /tmp/c.txt")).toBe("/tmp/c.txt");
    for (const other of ["ls /tmp", "echo oi > /tmp/a", "cat /tmp/a", "nano", "nano a b", "mkdir /x", "echo x | tee /tmp/a"]) expect(writtenFile(other)).toBeUndefined();
  });

  it("quotes a text for the shell", () => {
    expect(shellQuote("simples")).toBe("'simples'");
    expect(shellQuote("it's")).toBe(String.raw`'it'\''s'`);
  });
});
