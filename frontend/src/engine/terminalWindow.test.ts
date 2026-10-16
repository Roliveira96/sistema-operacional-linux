import { afterEach, describe, expect, it, vi } from "vitest";
import { cheatSheetHtml, cleanOutput, mountTerminalWindow, type TerminalWindow } from "./terminalWindow";
import type { ScreenElement, ScreenNode } from "./terminalScreen";

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
  vi.useRealTimers();
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

// SPEC-056 (espelho da tela): the teacher's window tells its whole screen as a safe tree, throttled and only when it changed.
describe("picture of the screen for the live classroom (SPEC-056)", () => {
  // The lists of the spec, written here on purpose: they are the oracle, not the code under test.
  const TAGS = ["div", "span", "b", "i", "em", "strong", "kbd", "code", "pre", "br", "button", "textarea", "input", "table", "tbody", "tr", "td", "th"];
  const ATTRS = ["class", "hidden", "title", "aria-selected", "role", "value"];

  const key = (target: Element, name: string, init: KeyboardEventInit = {}) =>
    target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init }));
  const type = (container: HTMLElement, text: string) => {
    const screen = container.querySelector(".term-tela") as HTMLElement;
    for (const letter of text) key(screen, letter);
    return screen;
  };
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const flush = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };

  const walk = (node: ScreenNode, visit: (element: ScreenElement) => void) => {
    if (typeof node === "string") return;
    visit(node);
    node.children?.forEach((child) => walk(child, visit));
  };
  const textOf = (node: ScreenNode): string => (typeof node === "string" ? node : (node.children ?? []).map(textOf).join(""));
  const hasClass = (node: ScreenElement, name: string) => (node.attrs?.class as string | undefined)?.split(" ").includes(name) ?? false;
  const findAll = (tree: ScreenElement, test: (element: ScreenElement) => boolean) => {
    const found: ScreenElement[] = [];
    walk(tree, (element) => test(element) && found.push(element));
    return found;
  };
  const byClass = (tree: ScreenElement, name: string) => findAll(tree, (element) => hasClass(element, name));
  const byteLength = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

  const mountScreen = async () => {
    const onScreen = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    mounted = await mountTerminalWindow(container, null, { onCommand: vi.fn(), onScreen });
    mounted.setSpeed(100);
    const last = () => onScreen.mock.calls.at(-1)![0] as ScreenElement;
    const lines = () => container.querySelector(".term-linhas") as HTMLElement;
    const line = (text: string) => {
      const div = document.createElement("div");
      div.className = "term-linha";
      div.textContent = text;
      lines().appendChild(div);
    };
    return { container, win: mounted, onScreen, last, lines, line };
  };

  // Covers CA-05 on the window side: the whole screen goes out as soon as the terminal mounts, with no change needed.
  it("delivers the whole window as soon as the terminal mounts", async () => {
    const { onScreen, last } = await mountScreen();
    expect(onScreen).toHaveBeenCalledTimes(1);
    expect(last().tag).toBe("div");
    expect(hasClass(last(), "janela")).toBe(true);
    expect(textOf(last())).toContain("Conectado a");
    expect(byClass(last(), "janela-aba")).toHaveLength(1);
  });

  it("does not watch anything when nobody asked for the picture", async () => {
    const spy = vi.spyOn(MutationObserver.prototype, "observe");
    await mount();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  // Covers CA-03: the line being typed, the cursor and the colors reach the picture.
  it("shows the line being typed with its cursor, and the colors of the prompt", async () => {
    const { container, last } = await mountScreen();
    type(container, "ls -l");
    await vi.waitFor(() => expect(byClass(last(), "term-entrada").map(textOf).join("")).toContain("ls -l"));
    const entry = byClass(last(), "term-entrada")[0]!;
    expect(findAll(entry, (element) => hasClass(element, "c-prompt-usuario")).length).toBeGreaterThan(0);
    expect(findAll(entry, (element) => hasClass(element, "term-cursor")).length).toBe(1);
    key(container.querySelector(".term-tela")!, "Backspace");
    await vi.waitFor(() => expect(byClass(last(), "term-entrada").map(textOf).join("")).not.toContain("ls -l"));
    expect(byClass(last(), "term-entrada").map(textOf).join("")).toContain("ls -");
  });

  // Covers CA-03: the output of a command and its colors.
  it("shows the output of a command, with the colors it printed", async () => {
    const { win, last } = await mountScreen();
    await win.run({ command: "ls /" });
    await vi.waitFor(() => expect(byClass(last(), "term-linhas").map(textOf).join("")).toContain("ls /"));
    expect(byClass(last(), "c-dir").length).toBeGreaterThan(0);
  });

  // Covers CA-01: clear and Ctrl+L leave the student with a clean screen.
  it("shows a clean screen after clear", async () => {
    const { win, last } = await mountScreen();
    await win.run({ command: "echo ola-do-professor" });
    await vi.waitFor(() => expect(textOf(last())).toContain("ola-do-professor"));
    await win.run({ command: "clear" });
    await vi.waitFor(() => expect(textOf(last())).not.toContain("ola-do-professor"));
    expect(textOf(last())).not.toContain("Conectado a");
  });

  it("shows a clean screen after Ctrl+L", async () => {
    const { container, win, last } = await mountScreen();
    await win.run({ command: "echo ola-do-professor" });
    await vi.waitFor(() => expect(textOf(last())).toContain("ola-do-professor"));
    key(container.querySelector(".term-tela")!, "l", { ctrlKey: true });
    await vi.waitFor(() => expect(textOf(last())).not.toContain("ola-do-professor"));
  });

  // Covers CA-02: vim, with its text, its bar and its mode, and the way back to the normal screen.
  it("shows vim with the text, the bar and the mode as the teacher edits, and the normal screen again when he leaves", async () => {
    const { container, last } = await mountScreen();
    key(type(container, "vim /root/aula.txt"), "Enter");
    await vi.waitFor(() => expect(byClass(last(), "vim-texto")).toHaveLength(1));
    // The terminal screen is hidden while the editor is open.
    expect(byClass(last(), "term-tela")[0]!.attrs?.hidden).toBe(true);
    expect(byClass(last(), "term-editor")[0]!.attrs?.hidden).toBeUndefined();
    expect(textOf(byClass(last(), "vim-barra")[0]!)).toContain("aula.txt");

    const area = container.querySelector(".vim-texto") as HTMLTextAreaElement;
    key(area, "i");
    await vi.waitFor(() => expect(textOf(byClass(last(), "vim-barra")[0]!)).toContain("INSERÇÃO"));
    expect(hasClass(byClass(last(), "vim-texto")[0]!, "inserindo")).toBe(true);

    // What is typed in a textarea changes no node of the DOM: the picture follows the input event.
    area.value = "linha um\nlinha dois";
    area.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.waitFor(() => expect(byClass(last(), "vim-texto")[0]!.attrs?.value).toBe("linha um\nlinha dois"));

    key(area, "Escape");
    key(area, ":");
    const command = container.querySelector(".vim-comando") as HTMLInputElement;
    await vi.waitFor(() => expect(byClass(last(), "vim-comando")[0]!.attrs?.hidden).toBeUndefined());
    command.value = ":q!";
    key(command, "Enter");
    await vi.waitFor(() => expect(byClass(last(), "vim-texto")).toHaveLength(0));
    expect(byClass(last(), "term-tela")[0]!.attrs?.hidden).toBeUndefined();
  });

  // Covers CA-02: nano, with its text and its "Modified" mark.
  it("shows nano with the text and the modified mark, and the normal screen again when he leaves", async () => {
    const { container, last } = await mountScreen();
    key(type(container, "nano /root/notas.txt"), "Enter");
    await vi.waitFor(() => expect(byClass(last(), "nano-texto")).toHaveLength(1));
    expect(textOf(byClass(last(), "nano-nome")[0]!)).toContain("notas.txt");

    const area = container.querySelector(".nano-texto") as HTMLTextAreaElement;
    area.value = "um texto novo";
    area.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.waitFor(() => expect(byClass(last(), "nano-texto")[0]!.attrs?.value).toBe("um texto novo"));
    expect(textOf(byClass(last(), "nano-mod")[0]!)).toBe("Modificado");

    key(area, "x", { ctrlKey: true });
    await vi.waitFor(() => expect(textOf(byClass(last(), "nano-estado")[0]!)).toContain("Salvar o buffer modificado"));
    key(area, "n");
    await vi.waitFor(() => expect(byClass(last(), "nano-texto")).toHaveLength(0));
    expect(byClass(last(), "term-tela")[0]!.attrs?.hidden).toBeUndefined();
  });

  // Covers CA-02, CA-03: the text of a textarea or input does not change the DOM, so the picture follows the keys and the input event.
  it("follows what is typed in a textarea or an input, which changes no node of the DOM", async () => {
    const { container, last, lines } = await mountScreen();
    const area = document.createElement("textarea");
    const field = document.createElement("input");
    area.className = "area";
    field.className = "campo";
    lines().append(area, field);
    await vi.waitFor(() => expect(byClass(last(), "area")).toHaveLength(1));
    area.value = "abc";
    area.dispatchEvent(new Event("input", { bubbles: true }));
    field.value = "xyz";
    field.dispatchEvent(new KeyboardEvent("keyup", { key: "z", bubbles: true }));
    await vi.waitFor(() => expect(byClass(last(), "area")[0]!.attrs?.value).toBe("abc"));
    await vi.waitFor(() => expect(byClass(last(), "campo")[0]!.attrs?.value).toBe("xyz"));
    // The value is the live one (the property), not the attribute of the markup.
    area.value = "abcd";
    area.dispatchEvent(new KeyboardEvent("keydown", { key: "d", bubbles: true }));
    container.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.waitFor(() => expect(byClass(last(), "area")[0]!.attrs?.value).toBe("abcd"));
  });

  // Covers CA-04: the same tabs, the same active tab, and the side by side mode.
  it("shows the tabs, the active one, and the side-by-side mode", async () => {
    const { container, win, last } = await mountScreen();
    expect(byClass(last(), "janela-aba")).toHaveLength(1);
    await win.run({ command: "whoami", terminal: 2, login: { user: "ricardo", password: "123" } });
    await vi.waitFor(() => expect(byClass(last(), "janela-aba")).toHaveLength(2));
    const tabs = byClass(last(), "janela-aba");
    expect(hasClass(tabs[0]!, "ativa")).toBe(false);
    expect(hasClass(tabs[1]!, "ativa")).toBe(true);
    expect(tabs.every((tab) => tab.attrs?.role === "tab")).toBe(true);
    expect(textOf(tabs[1]!)).toContain("ricardo@");
    expect(byClass(last(), "term")).toHaveLength(2);
    expect(byClass(last(), "term").filter((term) => hasClass(term, "visivel"))).toHaveLength(1);

    (container.querySelector(".janela-dividir") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(hasClass(byClass(last(), "janela-corpo")[0]!, "dividida")).toBe(true));
    expect(byClass(last(), "term").filter((term) => hasClass(term, "visivel"))).toHaveLength(2);
    (container.querySelectorAll(".janela-aba")[0] as HTMLElement).click();
    await vi.waitFor(() => expect(hasClass(byClass(last(), "janela-aba")[0]!, "ativa")).toBe(true));
  });

  // Covers CA-07: only the tags and the attributes of the list, and nothing that executes or loads.
  it("keeps only the allowed tags and attributes, and turns what is not allowed into text", async () => {
    const { last, lines } = await mountScreen();
    lines().insertAdjacentHTML(
      "beforeend",
      '<div class="caixa" id="x" data-x="1" style="color:red" onclick="roubar()" title="dica" role="note" aria-selected="true" hidden>' +
        '<a href="http://evil.example" class="l">um-link</a><script>roubar()</script><img src="http://evil.example/x.png" onerror="roubar()">' +
        '<iframe src="http://evil.example"></iframe><span lang="pt">ok</span><label>rotulo <b>negrito</b></label></div>',
    );
    await vi.waitFor(() => expect(byClass(last(), "caixa")).toHaveLength(1));
    const tags = new Set<string>();
    const attrs = new Set<string>();
    walk(last(), (element) => {
      tags.add(element.tag);
      Object.keys(element.attrs ?? {}).forEach((name) => attrs.add(name));
    });
    expect([...tags].every((tag) => TAGS.includes(tag))).toBe(true);
    expect([...attrs].every((name) => ATTRS.includes(name))).toBe(true);
    const box = byClass(last(), "caixa")[0]!;
    expect(box.attrs).toEqual({ class: "caixa", title: "dica", role: "note", "aria-selected": "true", hidden: true });
    const text = textOf(box);
    expect(text).toContain("um-link");
    expect(text).toContain("rotulo ");
    expect(text).toContain("negrito");
    expect(findAll(box, (element) => element.tag === "b").map(textOf)).toEqual(["negrito"]);
    const json = JSON.stringify(last());
    for (const forbidden of ["href", "evil.example", "onclick", "onerror", "style", "data-x", '"img"', '"script"', '"iframe"', '"a"', '"label"']) {
      expect(json).not.toContain(forbidden);
    }
  });

  // Covers CA-06: a password never reaches the picture, nor the value of a password or hidden field.
  it("never copies the value of a password field, of a hidden field or of a field inside something hidden", async () => {
    const { last, lines } = await mountScreen();
    lines().insertAdjacentHTML(
      "beforeend",
      '<input type="password" class="a"><input type="hidden" class="b"><div hidden><textarea class="c"></textarea></div><input class="d" hidden><input class="e">',
    );
    const set = (selector: string, value: string) => ((document.querySelector(selector) as HTMLInputElement).value = value);
    set(".a", "segredo-um");
    set(".b", "segredo-dois");
    set(".c", "segredo-tres");
    set(".d", "segredo-quatro");
    set(".e", "visivel");
    await vi.waitFor(() => expect(byClass(last(), "e")).toHaveLength(1));
    document.querySelector(".e")!.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.waitFor(() => expect(byClass(last(), "e")[0]!.attrs?.value).toBe("visivel"));
    expect(JSON.stringify(last())).not.toContain("segredo-");
    expect(byClass(last(), "a")[0]!.attrs?.value).toBeUndefined();
    expect(byClass(last(), "b")[0]!.attrs?.value).toBeUndefined();
  });

  // The teacher types the password: the terminal draws nothing of it, and neither does the picture, at any moment.
  it("never shows what the teacher types at a password prompt", async () => {
    const { container, onScreen, last } = await mountScreen();
    const screen = type(container, "passwd");
    key(screen, "Enter");
    await vi.waitFor(() => expect(textOf(last())).toContain("Nova senha:"));
    type(container, "segredo-secreto");
    await sleep(250);
    expect(textOf(last())).toContain("Nova senha:");
    key(screen, "Enter");
    await vi.waitFor(() => expect(textOf(last())).toContain("Redigite a nova senha:"));
    type(container, "segredo-secreto");
    key(screen, "Enter");
    await vi.waitFor(() => expect(textOf(last())).toContain("senha atualizada com sucesso"));
    await sleep(250);
    expect(JSON.stringify(onScreen.mock.calls)).not.toContain("segredo-secreto");
  });

  // Covers the size rules: the children of an element are cut from the start, and the message fits the limit.
  it("cuts the children of an element from the start, keeping the last 400", async () => {
    const { last, line } = await mountScreen();
    for (let i = 0; i < 1000; i++) line(`linha-${i}`);
    await vi.waitFor(() => expect(textOf(last())).toContain("linha-999"));
    const children = byClass(last(), "term-linhas")[0]!.children!;
    expect(children).toHaveLength(400);
    expect(textOf(children[0]!)).toBe("linha-600");
    expect(textOf(children.at(-1)!)).toBe("linha-999");
  });

  it("cuts more when the message would pass the limit, keeping the end of the screen", async () => {
    const { last, line } = await mountScreen();
    for (let i = 0; i < 600; i++) line(`${"x".repeat(1000)}-${i}`);
    await vi.waitFor(() => expect(textOf(last())).toContain("-599"));
    const size = byteLength({ screen: last() });
    expect(size).toBeLessThanOrEqual(200_000);
    expect(size).toBeGreaterThan(1000);
    const children = byClass(last(), "term-linhas")[0]!.children!;
    expect(children.length).toBeLessThan(400);
    expect(textOf(children.at(-1)!)).toMatch(/-599$/);
  });

  // Covers the throttling: at most one delivery every 100 ms, the first at once, the last one at the end, and only when changed.
  it("delivers at most once every 100 ms, with the first change at once and the burst that follows together", async () => {
    const { container, onScreen, last, line } = await mountScreen();
    vi.useFakeTimers();
    vi.advanceTimersByTime(300);
    const before = onScreen.mock.calls.length;

    line("um");
    await flush();
    expect(onScreen).toHaveBeenCalledTimes(before + 1);
    expect(textOf(last())).toContain("um");

    line("dois");
    await flush();
    line("tres");
    await flush();
    expect(onScreen).toHaveBeenCalledTimes(before + 1);
    vi.advanceTimersByTime(99);
    expect(onScreen).toHaveBeenCalledTimes(before + 1);
    vi.advanceTimersByTime(1);
    expect(onScreen).toHaveBeenCalledTimes(before + 2);
    expect(textOf(last())).toContain("tres");

    // Nothing changed, so nothing goes out, whatever the keys say.
    container.dispatchEvent(new KeyboardEvent("keyup", { key: "a", bubbles: true }));
    vi.advanceTimersByTime(500);
    expect(onScreen).toHaveBeenCalledTimes(before + 2);
  });

  it("cancels the delivery that was waiting when the window is destroyed", async () => {
    const { win, onScreen, line } = await mountScreen();
    // Right after the mount the next delivery has to wait for the 100 ms, so it is pending when the window goes away.
    line("depois");
    await flush();
    const count = onScreen.mock.calls.length;
    win.destroy();
    await sleep(250);
    expect(onScreen).toHaveBeenCalledTimes(count);
  });

  // SPEC-057 CA-20, CA-21: what the teacher selects is told in characters over the text of the picture, so the window gives, with each picture, how
  // to turn a point of its DOM into an offset in that text.
  describe("the locator of the text of the picture", () => {
    const locatorOf = (onScreen: ReturnType<typeof vi.fn>) => onScreen.mock.calls.at(-1)![1] as { offsetOf(node: Node, offset: number): number | null; terminalOf(node: Node): number | null };
    const textNodeOf = (element: Element) => element.firstChild as Text;
    const treeText = (tree: ScreenElement) => textOf(tree);

    it("comes with every picture", async () => {
      const { onScreen } = await mountScreen();
      const locator = locatorOf(onScreen);
      expect(typeof locator.offsetOf).toBe("function");
      expect(typeof locator.terminalOf).toBe("function");
    });

    it("turns a point of a text node of the window into an offset in the text of the picture", async () => {
      const { onScreen, last, line, lines } = await mountScreen();
      line("alfa");
      line("beta");
      line("gama");
      await vi.waitFor(() => expect(treeText(last())).toContain("gama"));
      const text = treeText(last());
      const locator = locatorOf(onScreen);
      const beta = [...lines().querySelectorAll(".term-linha")].find((el) => el.textContent === "beta")!;
      expect(locator.offsetOf(textNodeOf(beta), 0)).toBe(text.indexOf("beta"));
      expect(locator.offsetOf(textNodeOf(beta), 3)).toBe(text.indexOf("beta") + 3);
    });

    it("counts the text of a tag that is out of the list, which the picture keeps", async () => {
      const { onScreen, last, lines } = await mountScreen();
      const div = document.createElement("div");
      div.className = "term-linha";
      div.innerHTML = "ab<a>cd</a>ef";
      lines().appendChild(div);
      await vi.waitFor(() => expect(treeText(last())).toContain("abcdef"));
      const text = treeText(last());
      const anchor = div.querySelector("a")!;
      expect(locatorOf(onScreen).offsetOf(textNodeOf(anchor), 1)).toBe(text.indexOf("abcdef") + 3);
    });

    it("counts only what the picture kept, after the children cut from the start", async () => {
      const { onScreen, last, line, lines } = await mountScreen();
      for (let i = 0; i < 1000; i++) line(`linha-${i}`);
      await vi.waitFor(() => expect(treeText(last())).toContain("linha-999"));
      const text = treeText(last());
      const locator = locatorOf(onScreen);
      const all = [...lines().querySelectorAll(".term-linha")];
      const kept = all.find((el) => el.textContent === "linha-700")!;
      expect(locator.offsetOf(textNodeOf(kept), 2)).toBe(text.indexOf("linha-700") + 2);
      // A line that was cut is before everything the picture has.
      const first = text.indexOf("linha-600");
      expect(locator.offsetOf(textNodeOf(all[10]!), 2)).toBeLessThanOrEqual(first);
      expect(locator.offsetOf(textNodeOf(all.at(-1)!), 5)).toBe(text.indexOf("linha-999") + 5);
    });

    it("tells the number of the terminal a point is in", async () => {
      const { container, onScreen, last } = await mountScreen();
      const body = container.querySelector(".janela-corpo")!;
      const second = document.createElement("div");
      second.className = "term";
      second.innerHTML = '<div class="term-tela"><div class="term-linhas"><div class="term-linha">segundo-terminal</div></div></div>';
      body.appendChild(second);
      await vi.waitFor(() => expect(treeText(last())).toContain("segundo-terminal"));
      const locator = locatorOf(onScreen);
      const firstLine = container.querySelector(".term .term-linha, .term .term-linhas")!;
      expect(locator.terminalOf(firstLine)).toBe(1);
      expect(locator.terminalOf(second.querySelector(".term-linha")!.firstChild!)).toBe(2);
      expect(locator.terminalOf(document.body)).toBeNull();
    });

    it("is made again with each picture, so it follows the text that is on the window now", async () => {
      const { onScreen, last, line, lines } = await mountScreen();
      line("primeira");
      await vi.waitFor(() => expect(treeText(last())).toContain("primeira"));
      const before = locatorOf(onScreen);
      line("segunda");
      await vi.waitFor(() => expect(treeText(last())).toContain("segunda"));
      const after = locatorOf(onScreen);
      expect(after).not.toBe(before);
      const second = [...lines().querySelectorAll(".term-linha")].find((el) => el.textContent === "segunda")!;
      expect(after.offsetOf(textNodeOf(second), 0)).toBe(treeText(last()).indexOf("segunda"));
    });
  });

  // The copy by commands is gone: the window no longer tells what is typed, nor offers the calls that applied it to a copy.
  it("has no calls for the copy by commands any more", async () => {
    const { win } = await mountScreen();
    for (const gone of ["setReadOnly", "showInput", "printScreen", "syncMachine"]) expect(win).not.toHaveProperty(gone);
  });
});

// SPEC-073 CA-09, CA-11: the commands the teacher runs in the presentation window, for the diary of the lesson
describe("commands of the teacher for the live classroom (SPEC-073)", () => {
  const key = (target: Element, name: string) => target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
  const type = (container: HTMLElement, text: string) => {
    const screen = container.querySelector(".term-tela") as HTMLElement;
    for (const letter of text) key(screen, letter);
    return screen;
  };

  const mountRuns = async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const onCommandRun = vi.fn();
    mounted = await mountTerminalWindow(container, null, { onCommand: vi.fn(), onCommandRun });
    mounted.setSpeed(100);
    return { container, win: mounted, onCommandRun };
  };

  it("reports a step that was run, once, with the terminal, the line, the exit status and the output", async () => {
    const { win, onCommandRun } = await mountRuns();
    await win.run({ command: "echo ola-mundo" });
    expect(onCommandRun).toHaveBeenCalledTimes(1);
    expect(onCommandRun).toHaveBeenCalledWith({ terminal: 1, command: "echo ola-mundo", exitStatus: 0, output: "ola-mundo", outputTruncated: false });

    await win.run({ command: "ls /nao-existe" });
    expect(onCommandRun).toHaveBeenCalledTimes(2);
    const failed = onCommandRun.mock.calls[1]![0];
    expect(failed.command).toBe("ls /nao-existe");
    expect(failed.exitStatus).not.toBe(0);
    expect(failed.output).toContain("/nao-existe");
  });

  it("reports what the teacher types by hand, in the terminal where he typed it", async () => {
    const { container, win, onCommandRun } = await mountRuns();
    const screen = type(container, "echo digitado");
    key(screen, "Enter");
    await vi.waitFor(() => expect(onCommandRun).toHaveBeenCalledTimes(1));
    expect(onCommandRun).toHaveBeenCalledWith({ terminal: 1, command: "echo digitado", exitStatus: 0, output: "digitado", outputTruncated: false });

    await win.run({ command: "whoami", terminal: 2, login: { user: "ricardo", password: "123" } });
    await vi.waitFor(() => expect(onCommandRun).toHaveBeenCalledTimes(2));
    expect(onCommandRun.mock.calls[1]![0]).toMatchObject({ terminal: 2, command: "whoami", exitStatus: 0, output: "ricardo" });
  });

  it("reports nothing for an empty line, and nothing when nobody asked for the commands", async () => {
    const { container, onCommandRun } = await mountRuns();
    key(type(container, ""), "Enter");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(onCommandRun).not.toHaveBeenCalled();

    const { win, onCommand } = await mount();
    await win.run({ command: "echo sem-ouvinte" });
    expect(onCommand).toHaveBeenCalled();
  });

  // RN-08: the line comes from the history of the shell, which never has a password; the output never shows one either
  it("never reports what the teacher types at a password prompt", async () => {
    const { container, onCommandRun } = await mountRuns();
    const screen = type(container, "passwd");
    key(screen, "Enter");
    await vi.waitFor(() => expect(container.textContent).toContain("Nova senha:"));
    type(container, "segredo-secreto");
    key(screen, "Enter");
    await vi.waitFor(() => expect(container.textContent).toContain("Redigite a nova senha:"));
    type(container, "segredo-secreto");
    key(screen, "Enter");
    await vi.waitFor(() => expect(onCommandRun).toHaveBeenCalledTimes(1));
    expect(onCommandRun.mock.calls[0]![0].command).toBe("passwd");
    expect(JSON.stringify(onCommandRun.mock.calls)).not.toContain("segredo-secreto");
  });

  it("cuts the output at 4,000 characters and says so", async () => {
    const { win, onCommandRun } = await mountRuns();
    // long lines are sent at once, without the typing (SPEC-032): what is reported is the same
    win.setInstant(true);
    const chunk = "x".repeat(1500);
    await win.run({ command: `echo ${chunk} > /tmp/muito` });
    await win.run({ command: `echo ${chunk} >> /tmp/muito` });
    await win.run({ command: `echo ${chunk} >> /tmp/muito` });
    onCommandRun.mockClear();
    await win.run({ command: "cat /tmp/muito" });
    expect(onCommandRun).toHaveBeenCalledTimes(1);
    const run = onCommandRun.mock.calls[0]![0];
    expect(run.command).toBe("cat /tmp/muito");
    expect(run.output).toHaveLength(4000);
    expect(run.outputTruncated).toBe(true);
  });
});
