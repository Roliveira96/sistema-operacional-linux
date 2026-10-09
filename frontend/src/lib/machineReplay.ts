import { mountTerminalWindow, type TerminalWindow } from "@/engine/terminalWindow";
import type { SetupLayer } from "./setup";
import { runLayers } from "./setupRunner";

/**
 * Builds a machine from the scenario the author started from by running the layers on it, and returns the
 * machine as the engine serializes it. It lives in a window nobody sees and is destroyed afterwards.
 */
export async function replayMachine(base: unknown, layers: SetupLayer[]): Promise<unknown> {
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = "position:fixed;left:-10000px;top:0;width:900px;height:600px;overflow:hidden";
  document.body.appendChild(host);
  let win: TerminalWindow | undefined;
  try {
    win = await mountTerminalWindow(host, base, { onCommand: () => {} });
    await runLayers(win, layers);
    return win.snapshot();
  } finally {
    win?.destroy();
    host.remove();
  }
}
