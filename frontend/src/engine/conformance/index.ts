import { mountTerminalWindow } from "../terminalWindow";
import { engineCatalog } from "./catalog";
import { manifest } from "./manifest";
import { runConformance } from "./runner";
import type { ConformanceProgress, ConformanceReport } from "./types";

export { manifest } from "./manifest";
export type { ConformanceItem, ConformanceProgress, ConformanceReport, ItemResult } from "./types";

/**
 * Verifies the whole engine on a machine made in memory for this run (SPEC-030): the terminal window lives in a hidden element that is removed at the end,
 * nothing is sent over the network or saved in the browser (RN-05).
 */
export async function verifyEngine(onProgress?: (progress: ConformanceProgress) => void): Promise<ConformanceReport> {
  const host = document.createElement("div");
  host.hidden = true;
  document.body.appendChild(host);
  try {
    return await runConformance({
      items: manifest,
      catalog: await engineCatalog(),
      mount: () => mountTerminalWindow(host, null, { onCommand: () => {} }),
      onProgress,
    });
  } finally {
    host.remove();
  }
}
