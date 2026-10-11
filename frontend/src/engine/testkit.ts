import { vi } from "vitest";
import { mountTerminalWindow, type CommandResult, type TerminalWindow } from "./terminalWindow";

// The first mount loads the whole legacy engine, which is slow when the machine is busy.
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

/** Mounts the real terminal window on the default machine, at full speed. */
export async function mountMachine(): Promise<TerminalWindow> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const win = await mountTerminalWindow(host, null, { onCommand: () => {} });
  win.setSpeed(100);
  return win;
}

/** Runs the commands one after the other on the root terminal and gives the result of the last one. */
export async function runAll(win: TerminalWindow, ...commands: string[]): Promise<CommandResult> {
  let result: CommandResult = { status: 0, output: "" };
  for (const command of commands) result = await win.execute({ command });
  return result;
}
