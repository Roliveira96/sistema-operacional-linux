// Runs the snapshots of a module in the terminal of the application (SPEC-021): the module first and
// then the cards, in order. A step that ends with an error is a conflict, which the test of a card
// reports and the student never notices.

import type { TerminalWindow } from "@/engine/terminalWindow";
import type { SetupLayer, SetupStep } from "./setup";

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

/** Runs the steps of the layers in order and returns how each one ended. */
export async function runLayers(win: Pick<TerminalWindow, "execute" | "setSpeed">, layers: SetupLayer[], options: RunOptions = {}): Promise<StepResult[]> {
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
    }
  } finally {
    if (options.restoreSpeed !== undefined) win.setSpeed(options.restoreSpeed);
  }
  return results;
}
