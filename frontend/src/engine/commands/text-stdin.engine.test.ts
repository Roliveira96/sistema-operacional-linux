import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mountMachine } from "../testkit";
import type { TerminalWindow } from "../terminalWindow";

let win: TerminalWindow;
beforeAll(async () => {
  win = await mountMachine();
  await win.execute({ command: "mkdir -p /tmp/s && cd /tmp/s && printf 'um\\ndois\\ntres\\n' > a.txt" });
}, 60000);
afterAll(() => {
  win.destroy();
  document.body.innerHTML = "";
});

const run = (command: string) => win.execute({ command });
/** What the command printed: the terminal gives it without the last line break. */
const ok = async (command: string) => {
  const result = await run(command);
  expect(result.status, `${command}: ${result.output}`).toBe(0);
  return result.output;
};

// Covers SPEC-028 CA-07 (RN-12): a text or sum command with no file reads the standard input, from a pipe and from a redirection.
describe("the text commands read the standard input", () => {
  const cases: [string, string][] = [
    ["tac", "tres\ndois\num"],
    ["rev", "mu\nsiod\nsert"],
    ["nl", "     1\tum\n     2\tdois\n     3\ttres"],
    ["paste -s -d,", "um,dois,tres"],
    ["base64", "dW0KZG9pcwp0cmVzCg=="],
  ];
  it.each(cases)("%s works in a pipe and with <", async (command, expected) => {
    expect(await ok(`cat a.txt | ${command}`)).toBe(expected);
    expect(await ok(`${command} < a.txt`)).toBe(expected);
  });

  it("the sums name the standard input with a dash, in a pipe and with <", async () => {
    const piped = await ok("cat a.txt | sha256sum");
    expect(piped).toMatch(/^[0-9a-f]{64} {2}-$/);
    expect(await ok("sha256sum < a.txt")).toBe(piped);
    const md5 = await ok("cat a.txt | md5sum");
    expect(md5).toMatch(/^[0-9a-f]{32} {2}-$/);
    expect(await ok("md5sum < a.txt")).toBe(md5);
  });

  it("xxd reads the standard input", async () => {
    const expected = await ok("xxd a.txt");
    expect(await ok("cat a.txt | xxd")).toBe(expected);
    expect(await ok("xxd < a.txt")).toBe(expected);
  });

  it("shuf shuffles the lines it is given, and keeps all of them", async () => {
    for (const command of ["cat a.txt | shuf", "shuf < a.txt"]) {
      const lines = (await ok(command)).split("\n").filter(Boolean).sort();
      expect(lines, command).toEqual(["dois", "tres", "um"]);
    }
  });

  it("paste joins the lines of the standard input in pairs", async () => {
    expect(await ok("printf 'a\\nb\\nc\\nd\\n' | paste - -")).toBe("a\tb\nc\td");
  });

  it("file tells what the standard input is, when the operand is a dash", async () => {
    const result = await ok("cat a.txt | file -");
    expect(result).toMatch(/^\/dev\/stdin: /);
    expect(result).toContain("text");
  });
});
