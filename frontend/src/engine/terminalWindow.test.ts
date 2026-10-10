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
