import { afterEach, describe, expect, it, vi } from "vitest";
import { cheatSheetHtml, cleanOutput, mountTerminalWindow, type TerminalWindow } from "./terminalWindow";

let mounted: TerminalWindow | null = null;

async function mount(snapshot: unknown = null) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const onCommand = vi.fn();
  mounted = await mountTerminalWindow(container, snapshot, { onCommand });
  mounted.setSpeed(100);
  return { container, win: mounted, onCommand };
}

afterEach(() => {
  mounted?.destroy();
  mounted = null;
  document.body.innerHTML = "";
});

// The first mount loads the whole legacy engine, which is slow when the machine is busy.
vi.setConfig({ testTimeout: 30_000 });

describe("mountTerminalWindow", () => {
  // Covers SPEC-016 CA-01: the prototype window opens ready, as root, in tab 1.
  it("opens the terminal window with the root terminal connected", async () => {
    const { container } = await mount();
    expect(container.querySelector(".janela")).not.toBeNull();
    expect(container.querySelectorAll(".janela-aba")).toHaveLength(1);
    expect(container.textContent).toContain("Conectado a");
    expect(container.textContent).toContain("como root");
  });

  // Covers CA-03: a step is typed and run, and the machine is reported.
  it("runs a step and reports the serialized machine", async () => {
    const { container, win, onCommand } = await mount();
    await win.run({ command: "echo ola-mundo" });
    expect(container.textContent).toContain("ola-mundo");
    expect(onCommand).toHaveBeenCalled();
    expect(onCommand.mock.calls.at(-1)?.[0]).toMatchObject({ formato: "exame-so/maquina" });
  });

  // Covers SPEC-020 RN-08: the exit status of the command is what the test of a card reads.
  it("resolves with the exit status of the command", async () => {
    const { win } = await mount();
    expect(await win.run({ command: "echo ok" })).toBe(0);
    expect(await win.run({ command: "ls /nao-existe" })).not.toBe(0);
    expect(await win.run({ command: "true" })).toBe(0);
    expect(win.history().slice(-3)).toEqual(["echo ok", "ls /nao-existe", "true"]);
  });

  it("also gives what the command printed, so the error of a failure can be shown", async () => {
    const { win } = await mount();
    const ok = await win.execute({ command: "echo ola-mundo" });
    expect(ok).toEqual({ status: 0, output: "ola-mundo" });
    const bad = await win.execute({ command: "ls /nao-existe" });
    expect(bad.status).not.toBe(0);
    expect(bad.output).toContain("/nao-existe");
    expect(bad.output).not.toContain("ls /nao-existe\n");
  });

  it("cleans the printed text of a command", async () => {
    expect(cleanOutput("root@servidor:~# ls /x\nls: nope\nroot@servidor:~# ", "ls /x")).toBe("ls: nope");
    expect(cleanOutput("", "ls")).toBe("");
  });

  // Covers CA-03: a step with terminal 2 and a login opens that tab as that user.
  it("opens the tab and logs in when a step asks for terminal 2", async () => {
    const { container, win } = await mount();
    await win.run({ command: "whoami", terminal: 2, login: { user: "ricardo", password: "123" } });
    expect(container.querySelectorAll(".janela-aba")).toHaveLength(2);
    expect(container.textContent).toContain("ricardo@");
  });

  // Covers CA-02: reset returns to the given machine.
  it("resets to a snapshot", async () => {
    const { container, win } = await mount();
    const initial = win.snapshot();
    await win.run({ command: "touch /root/marcador.txt" });
    expect(JSON.stringify(win.snapshot())).toContain("marcador.txt");
    win.reset(initial);
    expect(JSON.stringify(win.snapshot())).not.toContain("marcador.txt");
    expect(container.querySelectorAll(".janela-aba")).toHaveLength(1);
  });

  // Covers CA-10: the scenario replaces the machine under the open terminal,
  // keeping what is on screen and the command history.
  it("loads a scenario keeping the screen and the history", async () => {
    const { container, win } = await mount();
    await win.run({ command: "touch /root/antes.txt" });
    const scenario = (() => {
      const base = JSON.parse(JSON.stringify(win.snapshot())) as { raiz: { filhos: { nome: string; filhos?: { nome: string }[] }[] } };
      const root = base.raiz.filhos.find((n) => n.nome === "root");
      if (root?.filhos) root.filhos = root.filhos.filter((n) => n.nome !== "antes.txt");
      return base;
    })();

    await win.loadScenario(scenario);

    expect(container.textContent).toContain("Preparando máquina");
    expect(container.textContent).toContain("touch /root/antes.txt");
    expect(JSON.stringify(win.snapshot())).not.toContain("antes.txt");

    await win.run({ command: "touch /root/depois.txt" });
    expect(JSON.stringify(win.snapshot())).toContain("depois.txt");
  });

  it("returns the cheat sheet of the prototype", async () => {
    const html = await cheatSheetHtml();
    expect(html).toContain("cola-secao-topico");
    expect(html).toContain("Tabela Oficial de Comandos");
  });
});

// SPEC-051 (sala ao vivo): the adapter tells what the teacher types and runs, and a read-only copy shows it.
describe("terminal window for the live classroom (SPEC-051)", () => {
  const key = (target: Element, name: string) =>
    target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
  const type = (container: HTMLElement, text: string) => {
    const screen = container.querySelector(".term-tela") as HTMLElement;
    for (const letter of text) key(screen, letter);
    return screen;
  };
  const mountLive = async () => {
    const onInput = vi.fn();
    const onCommandDone = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    mounted = await mountTerminalWindow(container, null, { onCommand: vi.fn(), onInput, onCommandDone });
    mounted.setSpeed(100);
    return { container, win: mounted, onInput, onCommandDone };
  };

  // Covers CA-07: the line being typed is reported at every key.
  it("reports the line the teacher is typing, key by key", async () => {
    const { container, onInput } = await mountLive();
    type(container, "ls");
    expect(onInput.mock.calls.map((call) => call[0])).toEqual([
      { terminal: 1, line: "l" },
      { terminal: 1, line: "ls" },
    ]);
    key(container.querySelector(".term-tela")!, "Backspace");
    expect(onInput).toHaveBeenLastCalledWith({ terminal: 1, line: "l" });
  });

  // Covers CA-07: when the command ends, the line, the output and the state of the machine are reported.
  it("reports the line, the output, the screen and the machine when a typed command ends", async () => {
    const { container, onInput, onCommandDone } = await mountLive();
    const screen = type(container, "echo ola-sala");
    key(screen, "Enter");
    await vi.waitFor(() => expect(onCommandDone).toHaveBeenCalledTimes(1));

    const done = onCommandDone.mock.calls[0]![0];
    expect(done).toMatchObject({ terminal: 1, line: "echo ola-sala", output: "ola-sala", status: 0, user: "root" });
    expect(done.state).toMatchObject({ formato: "exame-so/maquina" });
    expect(done.cwd).toMatch(/^\//);
    const printed = done.segments.map((s: { text: string }) => s.text).join("");
    expect(printed).toContain("root@");
    expect(printed).toContain("echo ola-sala");
    expect(printed).toContain("ola-sala\n");
    // The prompt line is empty again, and that is told too.
    await vi.waitFor(() => expect(onInput).toHaveBeenLastCalledWith({ terminal: 1, line: "" }));
  });

  // Covers CA-07: commands sent by a script are reported like typed ones, with their typing.
  it("also reports a command sent by run()", async () => {
    const { win, onInput, onCommandDone } = await mountLive();
    await win.run({ command: "echo via-run" });
    expect(onCommandDone).toHaveBeenCalledTimes(1);
    expect(onCommandDone.mock.calls[0]![0]).toMatchObject({ line: "echo via-run", output: "via-run" });
    expect(onInput.mock.calls.some((call) => call[0].line === "echo via-run")).toBe(true);
  });

  // Covers SPEC-051 section 6: a password typed in the terminal is never reported.
  it("never reports what is typed at a password prompt", async () => {
    const { win, onInput, onCommandDone } = await mountLive();
    await win.execute({ command: "passwd", answers: ["segredo-secreto", "segredo-secreto"] });
    const everything = JSON.stringify([onInput.mock.calls, onCommandDone.mock.calls]);
    expect(everything).not.toContain("segredo-secreto");
  });

  // Covers CA-07: a terminal opened later (another tab of the window) is watched too.
  it("watches the other terminals of the window", async () => {
    const { container, win, onCommandDone } = await mountLive();
    await win.run({ command: "echo no-dois", terminal: 2 });
    expect(container.querySelectorAll(".janela-aba").length).toBeGreaterThan(1);
    expect(onCommandDone.mock.calls.at(-1)![0]).toMatchObject({ terminal: 2, line: "echo no-dois" });
  });

  // Covers CA-07: the copy of the student is read-only, shows the typing, the command and the output, and applies the machine.
  it("makes a read-only copy that shows what the teacher does, without running anything", async () => {
    const teacher = await mountLive();
    key(type(teacher.container, "touch /tmp/marca-do-professor"), "Enter");
    await vi.waitFor(() => expect(teacher.onCommandDone).toHaveBeenCalled());
    const done = teacher.onCommandDone.mock.calls[0]![0];

    const container = document.createElement("div");
    document.body.appendChild(container);
    const copy = await mountTerminalWindow(container, null, { onCommand: vi.fn() });
    copy.setSpeed(100);
    try {
      copy.setReadOnly(true);
      expect(container.hasAttribute("inert")).toBe(true);
      type(container, "zqzq");
      expect(container.querySelector(".term-entrada")!.textContent).not.toContain("zqzq");

      await copy.showInput(1, "ls -la /tmp");
      expect(container.querySelector(".term-entrada")!.textContent).toContain("ls -la /tmp");

      const before = JSON.stringify(copy.snapshot());
      await copy.printScreen(1, [{ text: "root@x:~# touch /tmp/fantasma\n" }, { text: "saida-do-professor\n", className: "c-ok" }]);
      expect(container.textContent).toContain("touch /tmp/fantasma");
      expect(container.textContent).toContain("saida-do-professor");
      expect(JSON.stringify(copy.snapshot())).toBe(before);
      expect(container.querySelector(".term-entrada")!.textContent).not.toContain("ls -la /tmp");

      await copy.syncMachine(done.state, { terminal: 1, cwd: "/tmp" });
      expect(JSON.stringify(copy.snapshot())).toContain("marca-do-professor");
      expect(container.textContent).toContain("saida-do-professor");
      expect(container.querySelector(".term-entrada")!.textContent).toContain("/tmp");
    } finally {
      copy.destroy();
    }
  });

  it("gives the keyboard back when the copy is no longer read-only", async () => {
    const { container, win } = await mountLive();
    win.setReadOnly(true);
    expect(container.hasAttribute("inert")).toBe(true);
    win.setReadOnly(false);
    expect(container.hasAttribute("inert")).toBe(false);
    type(container, "abc");
    expect(container.querySelector(".term-entrada")!.textContent).toContain("abc");
  });
});
