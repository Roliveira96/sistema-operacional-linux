import { describe, expect, it } from "vitest";
import { isPlainText, printfSteps, shellQuote, writtenFile } from "./setupContent";

// Covers the files an author writes with an editor while recording a snapshot (SPEC-021).
describe("setupContent", () => {
  it("finds the file an editor-like command writes", () => {
    expect(writtenFile("nano /home/ana/a.txt")).toBe("/home/ana/a.txt");
    expect(writtenFile("vim -n /srv/b.txt")).toBe("/srv/b.txt");
    expect(writtenFile("vi c.txt")).toBe("c.txt");
    expect(writtenFile("tee /tmp/t.txt")).toBe("/tmp/t.txt");
    expect(writtenFile("cat > /tmp/c.txt")).toBe("/tmp/c.txt");
    for (const other of ["ls /tmp", "echo oi > /tmp/a", "cat /tmp/a", "nano", "nano a b", "mkdir /x"]) expect(writtenFile(other)).toBeUndefined();
  });

  it("quotes a text for the shell", () => {
    expect(shellQuote("simples")).toBe("'simples'");
    expect(shellQuote("it's")).toBe(String.raw`'it'\''s'`);
  });

  it("writes a text with one printf, then appends the next chunks, so no step is longer than a command can be", () => {
    expect(printfSteps("/x/a.txt", "l1\nl2")).toEqual([{ command: String.raw`printf '%s\n' 'l1' 'l2' > '/x/a.txt'` }]);
    expect(printfSteps("/x/e.txt", "")).toEqual([{ command: "touch '/x/e.txt'" }]);
    expect(printfSteps("/x/b.txt", "a\n\nb")[0]!.command).toBe(String.raw`printf '%s\n' 'a' '' 'b' > '/x/b.txt'`);

    const long = Array.from({ length: 60 }, (_, i) => `linha numero ${i} com algum texto`).join("\n");
    const steps = printfSteps("/x/long.txt", long);
    expect(steps.length).toBeGreaterThan(1);
    expect(steps[0]!.command).toContain("> '/x/long.txt'");
    for (const step of steps.slice(1)) expect(step.command).toContain(">> '/x/long.txt'");
    for (const step of steps) expect(step.command.length).toBeLessThanOrEqual(500);
  });

  it("only converts a text a backslash would not change", () => {
    expect(isPlainText("a b $HOME")).toBe(true);
    expect(isPlainText("a"+String.fromCharCode(92)+"nb")).toBe(false);
  });
});
