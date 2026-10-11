import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mountMachine } from "../testkit";
import type { TerminalWindow } from "../terminalWindow";
import { COMMANDS_200, EXPECTED_FAILURES, SETUP_COMMANDS } from "./fixtures/commands200";

let win: TerminalWindow;
beforeAll(async () => {
  win = await mountMachine();
});
afterAll(() => {
  win.destroy();
  document.body.innerHTML = "";
});

// Covers SPEC-028 CA-14 and CA-03: the card of 200 commands of the test module runs on the engine.
describe("the card of the 200 commands (CA-14)", () => {
  it("runs every command with success, except the ones outside the spec", async () => {
    for (const command of SETUP_COMMANDS) await win.execute({ command });
    const failures: string[] = [];
    for (const command of COMMANDS_200) {
      const result = await win.execute({ command });
      if (result.status !== 0) failures.push(`${command} -> ${result.status}: ${result.output.split("\n")[0]}`);
    }
    const unexpected = failures.filter((failure) => !EXPECTED_FAILURES.some((expected) => failure.startsWith(`${expected} ->`)));
    expect(unexpected).toEqual([]);
  });

  it("curl answers --version and -V and keeps every other use as it was (CA-03)", async () => {
    for (const flag of ["--version", "-V"]) {
      const result = await win.execute({ command: `curl ${flag}` });
      expect(result.status).toBe(0);
      expect(result.output.split("\n")[0]).toMatch(/^curl 8\.5\.0 /);
      expect(result.output).toContain("Protocols:");
    }
    const other = await win.execute({ command: "curl" });
    expect(other.status).not.toBe(0);
    expect(other.output).toContain("curl");
    expect((await win.execute({ command: "curl --help" })).status).toBe(0);
  });
});
