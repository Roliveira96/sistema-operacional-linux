import { readFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cheatSheetHtml, mountTerminalWindow, type TerminalWindow } from "./engine";

interface Manifest {
  scenarios: Array<{ sourceKey: string; snapshot: unknown }>;
}

const manifest = JSON.parse(
  gunzipSync(
    readFileSync(path.resolve(import.meta.dirname, "../../../backend/internal/modules/content/seed/data/content_manifest.json.gz")),
  ).toString("utf8"),
) as Manifest;
const scenario = (key: string) => manifest.scenarios.find((s) => s.sourceKey === key)!.snapshot;

interface Tree {
  nome: string;
  filhos?: Tree[];
}
const has = (snapshot: unknown, ...names: string[]) => {
  let node = (snapshot as { raiz: Tree }).raiz;
  for (const name of names) {
    const child = node.filhos?.find((f) => f.nome === name);
    if (!child) return false;
    node = child;
  }
  return true;
};

let open: TerminalWindow | null = null;
afterEach(() => {
  open?.destroy();
  open = null;
});

async function mount(snapshot: unknown) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const onCommand = vi.fn();
  open = await mountTerminalWindow(container, snapshot, { onCommand });
  open.setSpeed(100);
  return { container, onCommand, win: open };
}

// Covers SPEC-016 CA-01, CA-03, CA-08 and CA-10: the prototype window runs through the adapter.
describe("terminal window adapter", () => {
  it("mounts the prototype window on the topic machine and runs steps", async () => {
    const { container, onCommand, win } = await mount(scenario("scenario/topic/diretorios"));
    expect(container.querySelector(".janela .janela-aba")?.textContent).toContain("root@");
    await win.run({ command: "mkdir /root/empresa" });
    expect(onCommand).toHaveBeenCalled();
    expect(has(win.snapshot(), "root", "empresa")).toBe(true);
    expect(container.textContent).toContain("mkdir /root/empresa");
  });

  it("logs in on other terminals and answers questions", async () => {
    const { container, win } = await mount(null);
    await win.run({ command: "whoami", terminal: 2, login: { user: "ricardo", password: "123" } });
    expect(container.querySelectorAll(".janela-aba")).toHaveLength(2);
    expect(container.textContent).toContain("ricardo@");
  });

  it("prepares an exercise machine keeping the history and swaps machines", async () => {
    const { container, win } = await mount(null);
    await win.run({ command: "mkdir /tmp/antes" });
    await win.prepare(scenario("scenario/topic/diretorios"), ["Preparando máquina para o desafio 1…"]);
    expect(container.textContent).toContain("Preparando máquina para o desafio 1…");
    expect(container.textContent).toContain("mkdir /tmp/antes");
    expect(has(win.snapshot(), "tmp", "antes")).toBe(false);

    await win.run({ command: "mkdir /tmp/depois" });
    win.load(null);
    expect(has(win.snapshot(), "tmp", "depois")).toBe(false);
  });

  it("builds the prototype cheat sheet", async () => {
    expect(await cheatSheetHtml()).toContain("cola-");
  });
});
