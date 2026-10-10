// Runs the snapshots of a module in the terminal of the application (SPEC-021): the module first and
// then the cards, in order. A step that ends with an error is a conflict, which the test of a card
// reports and the student never notices.

import type { TerminalWindow } from "@/engine/terminalWindow";
import { overlayFiles, type MachineJson } from "./machineFiles";
import type { SetupFile, SetupLayer, SetupStep } from "./setup";

/** Typing speed of a setup run: fast enough to be a wait, not a show. */
export const SETUP_SPEED = 60;

/** How one step of a snapshot ended. */
export interface StepResult {
  layer: SetupLayer;
  index: number;
  step: SetupStep;
  /** Exit status (0 is success), or null when the command did not run. */
  status: number | null;
  /** What the terminal printed. */
  output: string;
}

export const isConflict = (r: StepResult) => r.status !== 0;

interface RunOptions {
  /** Called after each step. */
  onStep?: (result: StepResult) => void;
  /** Checked before each step; true stops the run. */
  shouldStop?: () => boolean;
  /** The typing speed to go back to when the run is over. */
  restoreSpeed?: number;
}

/** Puts files into the machine of a terminal as they are, and says how it went (status 0 is success). */
export async function applyFiles(win: Partial<Pick<TerminalWindow, "snapshot" | "loadScenario">>, files: SetupFile[]): Promise<{ status: number; output: string }> {
  try {
    if (!win.snapshot || !win.loadScenario) throw new Error("o terminal não carrega arquivos");
    await win.loadScenario(overlayFiles(win.snapshot() as MachineJson, files));
    return { status: 0, output: "" };
  } catch (error) {
    return { status: 1, output: error instanceof Error ? error.message : String(error) };
  }
}

/** Runs the steps of the layers in order and returns how each one ended. */
export async function runLayers(win: Pick<TerminalWindow, "execute" | "setSpeed"> & Partial<Pick<TerminalWindow, "snapshot" | "loadScenario">>, layers: SetupLayer[], options: RunOptions = {}): Promise<StepResult[]> {
  const results: StepResult[] = [];
  win.setSpeed(SETUP_SPEED);
  try {
    for (const layer of layers) {
      for (let index = 0; index < layer.setup.steps.length; index++) {
        if (options.shouldStop?.()) return results;
        const step = layer.setup.steps[index]!;
        const { status, output } = await win.execute({ command: step.command, terminal: step.terminal, login: step.login, answers: step.answers });
        const result: StepResult = { layer, index, step, status, output };
        results.push(result);
        options.onStep?.(result);
      }
      // The files of the snapshot go in after its commands, so they have the last word on what a file holds.
      const files = layer.setup.files ?? [];
      if (files.length > 0 && !options.shouldStop?.()) {
        const step: SetupStep = { command: `(${files.length} ${files.length === 1 ? "arquivo" : "arquivos"} do ambiente)` };
        const { status, output } = await applyFiles(win, files);
        const result: StepResult = { layer, index: layer.setup.steps.length, step, status, output };
        results.push(result);
        options.onStep?.(result);
      }
    }
  } finally {
    if (options.restoreSpeed !== undefined) win.setSpeed(options.restoreSpeed);
  }
  return results;
}
