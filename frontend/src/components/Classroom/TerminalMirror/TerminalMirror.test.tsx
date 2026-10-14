import { readFileSync } from "node:fs";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScreenElement, ScreenNode } from "@/engine/terminalScreen";
import { TerminalMirror } from "./TerminalMirror";

// The path goes through a variable on purpose: Vite rewrites `new URL("./literal", import.meta.url)` as an asset address.
const styleOf = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const style = styleOf("./TerminalMirror.module.scss");

type Attrs = Record<string, string | boolean>;
const el = (tag: string, attrs: Attrs | null, ...children: ScreenNode[]): ScreenElement => ({
  tag,
  ...(attrs ? { attrs } : {}),
  ...(children.length ? { children } : {}),
});

/** What the teacher's window looks like with one terminal: the bar with a tab and the screen with its lines and its prompt. */
const oneTerminal = (lines: string[] = ["Conectado a 192.168.0.10 via SSH como root."]): ScreenElement =>
  el(
    "div",
    { class: "janela" },
    el("div", { class: "janela-barra" }, el("div", { class: "janela-abas", role: "tablist" }, el("div", { class: "janela-aba ativa", role: "tab" }, el("span", { class: "aba-numero" }, "1")))),
    el(
      "div",
      { class: "janela-corpo" },
      el(
        "div",
        { class: "term visivel ativo" },
        el(
          "div",
          { class: "term-tela" },
          el("div", { class: "term-linhas" }, ...lines.map((text) => el("div", { class: "term-linha" }, el("span", { class: "c-info" }, text)))),
          el("div", { class: "term-entrada" }, el("span", { class: "c-prompt-usuario" }, "root@srv"), "# ", el("span", { class: "term-cursor" }, " ")),
        ),
        el("div", { class: "term-editor", hidden: true }),
      ),
    ),
  );

const loadStyle = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/engine/terminalScreen", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/engine/terminalScreen")>()), loadTerminalStyle: () => loadStyle() }));

beforeEach(() => loadStyle.mockClear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const window_ = () => screen.getByTestId("terminal-mirror");

// SPEC-056: the student sees the window of the teacher, drawn from a tree, and never runs anything
describe("TerminalMirror", () => {
  it("draws the tree it receives, with the same classes the terminal uses", () => {
    render(<TerminalMirror screen={oneTerminal(["linha um", "linha dois"])} />);
    const root = window_();
    expect(root.querySelector(".janela")).not.toBeNull();
    expect([...root.querySelectorAll(".term-linha")].map((line) => line.textContent)).toEqual(["linha um", "linha dois"]);
    expect(root.querySelector(".term-entrada .c-prompt-usuario")!.textContent).toBe("root@srv");
    expect(root.querySelector(".term-entrada .term-cursor")).not.toBeNull();
    expect(root.querySelector(".term-editor")!.hasAttribute("hidden")).toBe(true);
  });

  // CA-04: the same tabs and the same active tab
  it("shows the tabs and the active one", () => {
    const tab = (n: number, active: boolean) => el("div", { class: `janela-aba${active ? " ativa" : ""}`, role: "tab" }, el("span", { class: "aba-numero" }, String(n)), el("span", { class: "aba-titulo" }, `ssh ${n}`));
    const tree = el("div", { class: "janela" }, el("div", { class: "janela-abas", role: "tablist" }, tab(1, false), tab(2, true)), el("div", { class: "janela-corpo dividida" }));
    render(<TerminalMirror screen={tree} />);
    const tabs = [...window_().querySelectorAll('[role="tab"]')];
    expect(tabs).toHaveLength(2);
    expect(tabs.map((t) => t.classList.contains("ativa"))).toEqual([false, true]);
    expect(window_().querySelector(".janela-corpo")!.classList.contains("dividida")).toBe(true);
  });

  // CA-04: the side-by-side layout of the terminal reads a count that the window sets with a style, and the copy takes none from the sender
  it("counts the terminals of each body, because the side-by-side layout needs it, and takes no style from the tree", () => {
    const term = (n: number) => el("div", { class: "term visivel" }, el("div", { class: "term-tela", style: `--quantidade: ${n}` }));
    const tree = el("div", { class: "janela" }, el("div", { class: "janela-corpo dividida", style: "--quantidade: 9" }, term(1), term(2), term(3)));
    render(<TerminalMirror screen={tree} />);
    const body = window_().querySelector<HTMLElement>(".janela-corpo")!;
    expect(body.style.getPropertyValue("--quantidade")).toBe("3");
    expect(window_().querySelector(".term-tela")!.getAttribute("style")).toBeNull();
  });

  // CA-07: tags and attributes outside the list are ignored, and nothing is executed or loaded
  it("ignores the tags and the attributes outside the list, and turns the content of a tag that is not allowed into text", () => {
    const tree = el(
      "div",
      { class: "janela", id: "x", style: "color:red", onclick: "roubar()", "data-x": "1", href: "http://evil.example", src: "http://evil.example/x.png" },
      el("a", { href: "http://evil.example", class: "link" }, "um-link"),
      el("script", null, "roubar()"),
      el("img", { src: "http://evil.example/x.png", onerror: "roubar()" }),
      el("iframe", { src: "http://evil.example" }),
      el("label", null, "rotulo ", el("b", { onclick: "roubar()", class: "forte" }, "negrito")),
      el("span", { title: "dica", role: "note", "aria-selected": "true", hidden: true, lang: "pt" }, "ok"),
    );
    render(<TerminalMirror screen={tree} />);
    const root = window_();
    expect(root.querySelector("script, img, iframe, a, label")).toBeNull();
    expect(root.querySelector("[onclick], [onerror], [style], [href], [src], [data-x], [id], [lang]")).toBeNull();
    expect(root.textContent).toContain("um-link");
    expect(root.textContent).toContain("roubar()");
    expect(root.textContent).toContain("rotulo negrito");
    expect(root.querySelector("b.forte")!.textContent).toBe("negrito");
    const span = root.querySelector("span")!;
    expect(span.getAttribute("title")).toBe("dica");
    expect(span.getAttribute("role")).toBe("note");
    expect(span.getAttribute("aria-selected")).toBe("true");
    expect(span.hasAttribute("hidden")).toBe(true);
    expect(root.querySelector(".janela")!.getAttribute("class")).toBe("janela");
  });

  // CA-07: drawn with createElement, never with innerHTML
  it("draws without innerHTML", () => {
    const set = vi.spyOn(Element.prototype, "innerHTML", "set");
    const insert = vi.spyOn(Element.prototype, "insertAdjacentHTML");
    render(<TerminalMirror screen={oneTerminal(["<b>nao e tag</b>"])} />);
    expect(set).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    // A text that looks like markup is only text.
    expect(window_().querySelector(".term-linha")!.textContent).toBe("<b>nao e tag</b>");
    expect(window_().querySelector(".term-linha b")).toBeNull();
  });

  // CA-07: a container nobody can use
  it("puts the copy in an inert container, with the fields read-only and the typed value applied", () => {
    const tree = el(
      "div",
      { class: "janela" },
      el("textarea", { class: "vim-texto", value: "linha um\nlinha dois" }),
      el("input", { class: "vim-comando", value: ":wq" }),
      el("div", { class: "nao-campo", value: "ignorado" }),
      el("button", { class: "janela-nova" }, "＋"),
    );
    render(<TerminalMirror screen={tree} />);
    expect(window_().hasAttribute("inert")).toBe(true);
    const area = window_().querySelector<HTMLTextAreaElement>("textarea")!;
    const field = window_().querySelector<HTMLInputElement>("input")!;
    expect(area.value).toBe("linha um\nlinha dois");
    expect(area.readOnly).toBe(true);
    expect(field.value).toBe(":wq");
    expect(field.readOnly).toBe(true);
    expect(field.type).toBe("text");
    expect(window_().querySelector(".nao-campo")!.hasAttribute("value")).toBe(false);
  });

  it("does not trust the sender: a tree that is not what it should be draws what it can and does not throw", () => {
    const wrong = {
      tag: "div",
      attrs: "nao-e-objeto",
      children: [null, 42, { tag: 7 }, { children: ["sem tag"] }, "texto", { tag: "span", attrs: null, children: "nao-e-lista" }, { tag: "br", children: ["nunca"] }],
    } as unknown as ScreenElement;
    expect(() => render(<TerminalMirror screen={wrong} />)).not.toThrow();
    expect(window_().textContent).toContain("texto");
    expect(window_().textContent).not.toContain("nunca");
  });

  it("stops at a depth no terminal reaches, so a hostile tree cannot blow the stack", () => {
    let deep: ScreenElement = el("span", null, "no-fundo");
    for (let i = 0; i < 5000; i++) deep = el("div", null, deep);
    expect(() => render(<TerminalMirror screen={deep} />)).not.toThrow();
    expect(window_().textContent).not.toContain("no-fundo");
  });

  // The copy follows the end of the screen
  it("takes every terminal screen to its end at each update", () => {
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, get: () => 777 });
    try {
      const two = el(
        "div",
        { class: "janela" },
        el("div", { class: "janela-corpo dividida" }, el("div", { class: "term visivel" }, el("div", { class: "term-tela" })), el("div", { class: "term visivel" }, el("div", { class: "term-tela" }))),
      );
      const view = render(<TerminalMirror screen={two} />);
      const tops = () => [...window_().querySelectorAll<HTMLElement>(".term-tela")].map((tela) => tela.scrollTop);
      expect(tops()).toEqual([777, 777]);
      Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, get: () => 900 });
      view.rerender(<TerminalMirror screen={oneTerminal(["mais uma linha"])} />);
      expect(tops()).toEqual([900]);
    } finally {
      delete (HTMLElement.prototype as { scrollHeight?: number }).scrollHeight;
    }
  });

  it("replaces the screen at each update, without keeping what the new one no longer has", () => {
    const view = render(<TerminalMirror screen={oneTerminal(["antes"])} />);
    expect(window_().textContent).toContain("antes");
    view.rerender(<TerminalMirror screen={oneTerminal(["depois"])} />);
    expect(window_().textContent).toContain("depois");
    expect(window_().textContent).not.toContain("antes");
    expect(window_().querySelectorAll(".janela")).toHaveLength(1);
  });

  it("warns that it is a read-only copy, and says it is loading until the first screen arrives", () => {
    const view = render(<TerminalMirror screen={null} />);
    expect(screen.getByText("Você acompanha o terminal do professor. O teclado fica travado.")).toBeDefined();
    expect(screen.getByRole("status").textContent).toBe("Carregando o terminal…");
    expect(window_().querySelector(".janela")).toBeNull();
    view.rerender(<TerminalMirror screen={oneTerminal()} />);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText("Você acompanha o terminal do professor. O teclado fica travado.")).toBeDefined();
    view.rerender(<TerminalMirror screen={null} />);
    expect(window_().querySelector(".janela")).toBeNull();
    expect(screen.getByRole("status")).toBeDefined();
  });

  it("loads the stylesheet of the terminal once", () => {
    const view = render(<TerminalMirror screen={oneTerminal()} />);
    view.rerender(<TerminalMirror screen={oneTerminal(["outra"])} />);
    expect(loadStyle).toHaveBeenCalledTimes(1);
  });

  // The look of the terminal comes from the tokens, like the one of the study screen
  it("maps the variables of the terminal from the design tokens, and writes no color", () => {
    for (const variable of ["--terminal-fundo", "--terminal-texto", "--laranja", "--fonte", "--fonte-codigo"]) expect(style).toContain(variable);
    expect(style).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(style).not.toMatch(/\brgba?\(/);
  });

  // SPEC-057 CA-20, CA-21: the text the teacher selected is marked on the copy, by offsets over the text of the picture, and the copy stays unselectable
  describe("the selection of the teacher", () => {
    const lines = (...texts: string[]) => el("div", { class: "janela" }, el("div", { class: "term-linhas" }, ...texts.map((text) => el("div", { class: "term-linha" }, text))));
    const pick = (start: number, end: number, terminal = 1) => ({ pane: "terminal" as const, terminal, start, end });

    function highlightApi() {
      const registry = new Map<string, { ranges: Range[] }>();
      vi.stubGlobal("CSS", { ...CSS, highlights: registry });
      vi.stubGlobal(
        "Highlight",
        class {
          ranges: Range[];
          constructor(...ranges: Range[]) {
            this.ranges = ranges;
          }
        },
      );
      return registry;
    }
    afterEach(() => vi.unstubAllGlobals());

    it("marks the characters between the offsets, across lines", () => {
      const registry = highlightApi();
      render(<TerminalMirror screen={lines("alfa", "beta")} selection={pick(2, 6)} />);
      expect(registry.get("teacher-terminal")!.ranges.map((range) => range.toString())).toEqual(["fabe"]);
    });

    it("marks a stretch inside one line, and does not change what is drawn", () => {
      const registry = highlightApi();
      render(<TerminalMirror screen={lines("alfa", "beta")} selection={pick(5, 7)} />);
      expect(registry.get("teacher-terminal")!.ranges[0]!.toString()).toBe("et");
      expect(window_().textContent).toBe("alfabeta");
    });

    it("counts the text of a tag that is not allowed, which the copy keeps, and not the text it never draws", () => {
      const registry = highlightApi();
      const tree = el("div", { class: "janela" }, "ab", el("blink", null, "cd"), el("br", null, "XX"), "ef");
      render(<TerminalMirror screen={tree} selection={pick(2, 4)} />);
      expect(registry.get("teacher-terminal")!.ranges[0]!.toString()).toBe("cd");
      // The text that is not drawn still counts, as it does for the teacher, so what is after it is where the teacher has it.
      cleanup();
      const other = highlightApi();
      render(<TerminalMirror screen={tree} selection={pick(6, 8)} />);
      expect(other.get("teacher-terminal")!.ranges[0]!.toString()).toBe("ef");
    });

    it("marks again, on the new text, at every new screen", () => {
      const registry = highlightApi();
      const view = render(<TerminalMirror screen={lines("alfa")} selection={pick(1, 3)} />);
      const first = registry.get("teacher-terminal")!.ranges[0]!;
      expect(first.toString()).toBe("lf");
      view.rerender(<TerminalMirror screen={lines("zzzzz", "outra")} selection={pick(1, 3)} />);
      const second = registry.get("teacher-terminal")!.ranges[0]!;
      expect(second.toString()).toBe("zz");
      expect(second).not.toBe(first);
      expect(window_().contains(second.startContainer)).toBe(true);
    });

    it("follows the selection when the teacher changes it, and takes the mark away when he clears it or goes to the material", () => {
      const registry = highlightApi();
      const tree = lines("alfa", "beta");
      const view = render(<TerminalMirror screen={tree} selection={pick(0, 2)} />);
      expect(registry.get("teacher-terminal")!.ranges[0]!.toString()).toBe("al");
      view.rerender(<TerminalMirror screen={tree} selection={pick(4, 8)} />);
      expect(registry.get("teacher-terminal")!.ranges[0]!.toString()).toBe("beta");
      view.rerender(<TerminalMirror screen={tree} selection={null} />);
      expect(registry.has("teacher-terminal")).toBe(false);
      view.rerender(<TerminalMirror screen={tree} selection={pick(0, 2)} />);
      view.rerender(<TerminalMirror screen={tree} selection={{ pane: "material", start: { block: "b", offset: 0 }, end: { block: "b", offset: 3 } }} />);
      expect(registry.has("teacher-terminal")).toBe(false);
    });

    it("takes the mark away when the copy goes away", () => {
      const registry = highlightApi();
      const view = render(<TerminalMirror screen={lines("alfa")} selection={pick(0, 2)} />);
      view.unmount();
      expect(registry.has("teacher-terminal")).toBe(false);
    });

    it("marks nothing when the offsets are outside the text, or when there is no screen yet", () => {
      const registry = highlightApi();
      const view = render(<TerminalMirror screen={lines("alfa")} selection={pick(50, 60)} />);
      expect(registry.has("teacher-terminal")).toBe(false);
      view.rerender(<TerminalMirror screen={null} selection={pick(0, 2)} />);
      expect(registry.has("teacher-terminal")).toBe(false);
    });

    it("has marks that do not change the text when the browser has no highlight", () => {
      vi.stubGlobal("CSS", { escape: CSS.escape });
      const view = render(<TerminalMirror screen={lines("alfa", "beta")} selection={pick(2, 6)} />);
      const marks = [...window_().querySelectorAll("mark[data-teacher-selection]")];
      expect(marks.map((mark) => mark.textContent).join("")).toBe("fabe");
      expect(window_().textContent).toBe("alfabeta");
      view.rerender(<TerminalMirror screen={lines("alfa", "beta")} selection={null} />);
      expect(window_().querySelector("mark")).toBeNull();
      expect(window_().textContent).toBe("alfabeta");
    });

    it("keeps the copy inert and with no selection of its own", () => {
      render(<TerminalMirror screen={lines("alfa")} selection={pick(0, 2)} />);
      expect(window_().hasAttribute("inert")).toBe(true);
      expect(style).toMatch(/user-select:\s*none/);
    });
  });
});
