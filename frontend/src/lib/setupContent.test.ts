import { describe, expect, it } from "vitest";
import { isPlainText, nextCwd, printfSteps, resolvePath, shellQuote, writtenFile } from "./setupContent";

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

  it("resolves a relative path from a folder, with . and ..", () => {
    expect(resolvePath("/home/ricardo/financeiro", "teste.txt")).toBe("/home/ricardo/financeiro/teste.txt");
    expect(resolvePath("/home/ricardo", "./a/../b/c.txt")).toBe("/home/ricardo/b/c.txt");
    expect(resolvePath("/home/ricardo", "../x")).toBe("/home/x");
    expect(resolvePath("/", "a")).toBe("/a");
    expect(resolvePath("/qualquer", "/abs/ok.txt")).toBe("/abs/ok.txt");
  });

  it("follows the cd the author types, and gives up when the folder cannot be known", () => {
    expect(nextCwd("/root", "ls")).toBe("/root");
    expect(nextCwd("/root", "cd /home/ricardo/financeiro/")).toBe("/home/ricardo/financeiro");
    expect(nextCwd("/home/ricardo", "cd financeiro")).toBe("/home/ricardo/financeiro");
    expect(nextCwd("/home/ricardo/financeiro", "cd ..")).toBe("/home/ricardo");
    expect(nextCwd("/home/ricardo", "cd")).toBe("/root");
    expect(nextCwd("/home/ricardo", "cd ~")).toBe("/root");
    for (const hard of ["cd -", "cd $HOME", "cd ~ana", 'cd "a b"']) expect(nextCwd("/home/ricardo", hard)).toBeUndefined();
    expect(nextCwd(undefined, "cd financeiro")).toBeUndefined();
    expect(nextCwd(undefined, "cd /srv")).toBe("/srv");
    expect(nextCwd(undefined, "ls")).toBeUndefined();
  });
});
