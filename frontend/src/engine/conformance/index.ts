import { mountTerminalWindow, type TerminalWindow } from "../terminalWindow";
import { engineCatalog } from "./catalog";
import { manifest } from "./manifest";
import { casesOf, runConformance } from "./runner";
import type { ConformanceProgress, ConformanceReport } from "./types";

export { downloadText, exportFilename, reportToText, transcriptFile, transcriptFilename } from "./exportText";
export { manifest } from "./manifest";
export type { CaseResult, ConformanceCase, ConformanceProgress, ConformanceReport, ConformanceSuite, SuiteResult } from "./types";

/** How big the verification is, to tell the administrator before it starts: the suites and every case that runs, the --help of each command included (SPEC-030 CA-03). */
export const manifestSize = { suites: manifest.length, cases: manifest.reduce((sum, suite) => sum + casesOf(suite).length, 0) };

export interface VerifyOptions {
  /** An element on the screen where the terminal window is drawn live. */
  host?: HTMLElement;
  /** Gets the window when it opens. With a place on the screen the window stays open after the run, and whoever opened the screen closes it. */
  onWindow?: (win: TerminalWindow) => void;
}

/**
 * Verifies the whole engine on a machine made in memory for this run (SPEC-030): the terminal window lives in a hidden element that is removed at the end,
 * nothing is sent over the network or saved in the browser (RN-05).
 */
export async function verifyEngine(onProgress?: (progress: ConformanceProgress) => void, options: VerifyOptions = {}): Promise<ConformanceReport> {
  // Without a place of its own on the screen the window stays hidden; with one, the administrator watches the commands run (SPEC-030 RN-15).
  const own = options.host === undefined;
  const host = options.host ?? document.createElement("div");
  if (own) {
    host.hidden = true;
    document.body.appendChild(host);
  }
  try {
    return await runConformance({
      suites: manifest,
      catalog: await engineCatalog(),
      mount: async () => {
        const win = await mountTerminalWindow(host, null, { onCommand: () => {} });
        options.onWindow?.(win);
        return win;
      },
      keepWindow: !own,
      onProgress,
    });
  } finally {
    if (own) host.remove();
  }
}
