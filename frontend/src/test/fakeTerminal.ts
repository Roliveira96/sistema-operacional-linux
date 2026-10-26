import { vi } from "vitest";

/** What the exam asks of the window of the terminal (SPEC-084): to start a machine, to format it and to go away. */
export interface FakeTerminalWindow {
  reset: ReturnType<typeof vi.fn>;
  resetAnimated: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
}

export interface FakeCallbacks {
  onCommand(snapshot: unknown): void;
}

/**
 * A stand-in for `mountTerminalWindow`: each mount gives a fake window and keeps the callbacks it got, so a test can make the student type a command
 * (`callbacks[n].onCommand(machine)`) and can see which machine each window was given (`windows[n].reset`).
 */
export function terminalMount() {
  const windows: FakeTerminalWindow[] = [];
  const callbacks: FakeCallbacks[] = [];
  const mount = vi.fn(async (_container: HTMLElement, _snapshot: unknown, given: FakeCallbacks) => {
    const window: FakeTerminalWindow = { reset: vi.fn(), resetAnimated: vi.fn().mockResolvedValue(undefined), destroy: vi.fn() };
    windows.push(window);
    callbacks.push(given);
    return window;
  });
  return { mount, windows, callbacks };
}
