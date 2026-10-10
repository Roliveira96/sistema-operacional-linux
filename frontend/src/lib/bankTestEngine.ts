// The machine of "Testar Banco de Exercícios" (SPEC-023 12.1, D-19): the terminal of the application mounted out of sight, with the
// snapshot of the module and the one of the bank run once; every round goes back to that machine at once.

import { mountTerminalWindow } from "@/engine/terminalWindow";
import type { Sandbox } from "./bankTest";
import { checkConditions } from "./exerciseConditions";
import { isConflict, runLayers, type StepResult } from "./setupRunner";
import type { Setup, SetupLayer } from "./setup";

/** Typing speed of the test: no show, just the work. */
const SPEED = 100;

export interface EngineSandbox {
  /** Null when a snapshot ended with an error: the batteries do not start (SPEC-023 12.1). */
  sandbox: Sandbox | null;
  /** The steps of the snapshots that failed. */
  conflicts: StepResult[];
  destroy(): void;
}

/** Mounts the terminal on `scenario`, runs the layers (the module, then the bank) and keeps the machine they left as the base of every round. */
export async function createEngineSandbox(scenario: unknown, layers: SetupLayer[], onStep?: (done: number) => void): Promise<EngineSandbox> {
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-9999px;top:0;width:800px;height:600px;overflow:hidden";
  document.body.appendChild(host);
  const win = await mountTerminalWindow(host, scenario, { onCommand: () => {} });
  win.setSpeed(SPEED);
  let done = 0;
  const results = await runLayers(win, layers, { restoreSpeed: SPEED, onStep: () => onStep?.(++done) });
  const conflicts = results.filter(isConflict);
  const base = win.snapshot();
  const destroy = () => {
    win.destroy();
    host.remove();
  };
  if (conflicts.length > 0) return { sandbox: null, conflicts, destroy };
  const solve = async (setup: Setup) => {
    const run = await runLayers(win, [{ id: "solution", kind: "card", label: "", setup }], { restoreSpeed: SPEED });
    return run.every((r) => !isConflict(r));
  };
  return {
    sandbox: {
      reset: async () => win.reset(base),
      solve,
      holds: (conditions) => checkConditions(conditions, win.snapshot()).done,
    },
    conflicts,
    destroy,
  };
}
