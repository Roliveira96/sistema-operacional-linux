import { afterAll, describe, expect, it } from "vitest";
import { mountMachine } from "../testkit";
import { runConformance } from "./runner";

afterAll(() => {
  document.body.innerHTML = "";
});

// Covers SPEC-030 CA-26, RN-19: `clear` wipes the screen of the terminal, but the exported transcript keeps every command from the first to the last.
describe("the transcript on the real engine", () => {
  it("keeps the commands before and after a clear, and the suites after it", async () => {
    const report = await runConformance({
      suites: [
        {
          name: "clear",
          kind: "command",
          group: "shell",
          cases: [{ command: "echo antes-do-clear" }, { command: "clear" }, { command: "echo depois-do-clear" }],
        },
        { name: "pwd", kind: "command", group: "arquivos", cases: [{ command: "pwd", expect: "/tmp/lab" }] },
      ],
      mount: mountMachine,
    });
    expect(report.conformant).toBe(true);
    const { transcript } = report;
    const order = [
      "# comando clear",
      "$ echo antes-do-clear\nantes-do-clear\n",
      "$ clear\n",
      "$ echo depois-do-clear\ndepois-do-clear\n",
      "# comando pwd",
      "$ pwd\n/tmp/lab",
    ];
    const positions = order.map((text) => transcript.indexOf(text));
    expect(positions.every((position) => position >= 0), `missing in the transcript: ${order.filter((_, i) => positions[i]! < 0).join(" | ")}`).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    // The screen was cleared by the command, but the file was not.
    expect(transcript).toContain("[exit 0 · ok]");
  });
});
