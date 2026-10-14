import { afterEach, describe, expect, it, vi } from "vitest";
import { mountTerminalWindow, type TerminalWindow } from "./terminalWindow";

let mounted: TerminalWindow | null = null;

async function mount() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  mounted = await mountTerminalWindow(container, null, { onCommand: vi.fn() });
  mounted.setSpeed(100);
  return mounted;
}

afterEach(() => {
  mounted?.destroy();
  mounted = null;
  document.body.innerHTML = "";
});

// The first mount loads the whole legacy engine, which is slow when the machine is busy.
vi.setConfig({ testTimeout: 30_000 });

// SPEC-060 CA-04: the live class must know, before it types, that a terminal cannot take a command, instead of waiting for it
describe("TerminalWindow.isBusy", () => {
  it("says no for a terminal that is waiting for a command", async () => {
    const win = await mount();
    expect(win.isBusy(1)).toBe(false);
  });

  it("says no for a terminal that is not open, which a step opens", async () => {
    const win = await mount();
    expect(win.isBusy(2)).toBe(false);
    expect(win.isBusy(3)).toBe(false);
  });

  it("says yes while a command runs in the terminal, and no again when it ends, and not for another terminal", async () => {
    const win = await mount();
    await win.run({ command: "whoami", terminal: 2, login: { user: "ricardo", password: "123" } });
    const running = win.run({ command: "sleep 2" });
    await vi.waitFor(() => expect(win.isBusy(1)).toBe(true));
    expect(win.isBusy(2)).toBe(false);
    await running;
    expect(win.isBusy(1)).toBe(false);
  });
});
