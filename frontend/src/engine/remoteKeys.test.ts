import { afterEach, describe, expect, it, vi } from "vitest";
import { deliverKey, deliverPaste, isRemoteKey, remoteKeyboard, type RemoteKey } from "./remoteKeys";
import { mountTerminalWindow, type TerminalWindow } from "./terminalWindow";

// SPEC-071 CA-07: the keys of the teacher reach the terminal of the student as if he typed them, with the real engine.

// The first mount loads the whole engine, which is slow when the machine is busy.
vi.setConfig({ testTimeout: 60_000 });

let mounted: TerminalWindow | null = null;

async function mount() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  mounted = await mountTerminalWindow(container, null, { onCommand: () => undefined });
  mounted.setSpeed(100);
  return { container, win: mounted };
}

afterEach(() => {
  mounted?.destroy();
  mounted = null;
  document.body.innerHTML = "";
});

const keys = (root: HTMLElement, ...list: Array<string | RemoteKey>) => {
  for (const k of list) deliverKey(root, typeof k === "string" ? { key: k } : k);
};
const type = (root: HTMLElement, text: string) => keys(root, ...Array.from(text));
const ctrl = (key: string): RemoteKey => ({ key, ctrl: true });
const outputOf = (container: HTMLElement) => container.querySelector(".term.ativo .term-linhas")?.textContent ?? container.textContent ?? "";

/** Runs a command on the terminal (not by the teacher) and gives what it printed. */
async function run(win: TerminalWindow, command: string) {
  return (await win.execute({ command })).output;
}

describe("remoteKeys, in the shell", () => {
  it("types a command and runs it with Enter", async () => {
    const { container, win } = await mount();
    type(container, "echo remoto");
    keys(container, "Enter");
    await vi.waitFor(() => expect(outputOf(container)).toContain("remoto"));
    expect(win.history().at(-1)).toBe("echo remoto");
  });

  it("edits the line with Backspace, the arrows, Home and End, and goes through the history with ArrowUp", async () => {
    const { container, win } = await mount();
    type(container, "echo abx");
    keys(container, "Backspace", "c", "Home", "End", "ArrowLeft", "ArrowRight", "Enter");
    await vi.waitFor(() => expect(win.history().at(-1)).toBe("echo abc"));
    await vi.waitFor(() => expect(win.isRunning()).toBe(false));
    keys(container, "ArrowUp", "Enter");
    await vi.waitFor(() => expect(win.history().filter((c) => c === "echo abc")).toHaveLength(2));
  });

  it("completes with Tab", async () => {
    const { container, win } = await mount();
    await run(win, "mkdir -p /tmp/remoto-unico");
    type(container, "ls /tmp/remoto-u");
    keys(container, "Tab", "Enter");
    await vi.waitFor(() => expect(win.history().at(-1)).toBe("ls /tmp/remoto-unico/"));
  });

  it("stops a busy command with Ctrl+C", async () => {
    const { container, win } = await mount();
    type(container, "sleep 30");
    keys(container, "Enter");
    await vi.waitFor(() => expect(win.isBusy(1)).toBe(true));
    keys(container, ctrl("c"));
    await vi.waitFor(() => expect(win.isBusy(1)).toBe(false));
    expect(outputOf(container)).toContain("^C");
  });

  it("leaves the live top with Ctrl+C", async () => {
    const { container, win } = await mount();
    type(container, "top");
    keys(container, "Enter");
    await vi.waitFor(() => expect(win.isBusy(1)).toBe(true));
    keys(container, ctrl("c"));
    await vi.waitFor(() => expect(win.isBusy(1)).toBe(false));
  });

  it("pastes several lines, each one run as a command, the next line waiting for the command before it", async () => {
    const { container, win } = await mount();
    const keyboard = remoteKeyboard(container, () => win.isRunning());
    keyboard.paste("echo primeira\necho segunda\n");
    await vi.waitFor(() => expect(win.history().slice(-2)).toEqual(["echo primeira", "echo segunda"]));
  });

  it("keeps the keys typed while a command runs for when it ends, and gives Ctrl+C at once", async () => {
    const { container, win } = await mount();
    const keyboard = remoteKeyboard(container, () => win.isRunning());
    for (const char of "sleep 30") keyboard.key({ key: char });
    keyboard.key({ key: "Enter" });
    await vi.waitFor(() => expect(win.isRunning()).toBe(true));
    for (const char of "echo depois") keyboard.key({ key: char });
    keyboard.key({ key: "Enter" });
    keyboard.key({ key: "c", ctrl: true });
    await vi.waitFor(() => expect(win.history().at(-1)).toBe("echo depois"));
    keyboard.stop();
  });

  it("pastes one line with the low-level delivery when nothing runs", async () => {
    const { container, win } = await mount();
    deliverPaste(container, "echo direto\n");
    await vi.waitFor(() => expect(win.history().at(-1)).toBe("echo direto"));
  });
});

describe("remoteKeys, in the editors", () => {
  it("writes, breaks the line, saves with Ctrl+O and leaves with Ctrl+X in nano", async () => {
    const { container, win } = await mount();
    type(container, "nano /tmp/nano.txt");
    keys(container, "Enter");
    await vi.waitFor(() => expect(container.querySelector(".nano-texto")).not.toBeNull());
    type(container, "oi");
    keys(container, "Enter");
    type(container, "tchau");
    keys(container, "ArrowUp", "End", "Backspace", ctrl("o"));
    await vi.waitFor(() => expect(container.querySelector(".nano-estado input")).not.toBeNull());
    keys(container, "Enter", ctrl("x"));
    await vi.waitFor(() => expect(container.querySelector(".nano-texto")).toBeNull());
    expect(await run(win, "cat /tmp/nano.txt")).toBe("o\ntchau");
  });

  it("goes to insert with i, writes, leaves with Escape and saves with :wq in vim", async () => {
    const { container, win } = await mount();
    type(container, "vim /tmp/vim.txt");
    keys(container, "Enter");
    await vi.waitFor(() => expect(container.querySelector(".vim-texto")).not.toBeNull());
    keys(container, "i");
    type(container, "linha um");
    keys(container, "Enter");
    type(container, "linha dois");
    keys(container, "Escape");
    type(container, ":wq");
    keys(container, "Enter");
    await vi.waitFor(() => expect(container.querySelector(".vim-texto")).toBeNull());
    expect(await run(win, "cat /tmp/vim.txt")).toBe("linha um\nlinha dois");
  });

  it("pastes in the editor", async () => {
    const { container, win } = await mount();
    type(container, "nano /tmp/colado.txt");
    keys(container, "Enter");
    await vi.waitFor(() => expect(container.querySelector(".nano-texto")).not.toBeNull());
    deliverPaste(container, "a\nb");
    keys(container, ctrl("x"));
    await vi.waitFor(() => expect(container.textContent).toMatch(/Salvar|Gravar/i));
    keys(container, "s");
    await vi.waitFor(() => expect(container.querySelector(".nano-estado input")).not.toBeNull());
    keys(container, "Enter");
    await vi.waitFor(() => expect(container.querySelector(".nano-texto")).toBeNull());
    expect(await run(win, "cat /tmp/colado.txt")).toBe("a\nb");
  });
});

describe("remoteKeys, the events", () => {
  it("marks the events it makes, so a lock of the student's keyboard lets them through, and no other", () => {
    const root = document.createElement("div");
    const screen = document.createElement("div");
    screen.className = "term-tela";
    root.appendChild(screen);
    document.body.appendChild(root);
    const seen: boolean[] = [];
    screen.addEventListener("keydown", (event) => seen.push(isRemoteKey(event)));
    deliverKey(root, { key: "a" });
    screen.dispatchEvent(new KeyboardEvent("keydown", { key: "b", bubbles: true }));
    expect(seen).toEqual([true, false]);
  });
});
