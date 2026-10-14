import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TopicPlayer } from "@/hooks/useTopicPlayer";
import { buildTopicScript } from "@/lib/topicScript";
import type { ContentBlock } from "@/services/contentService";
import { LessonPanel } from "./LessonPanel";

afterEach(cleanup);

const blocks: ContentBlock[] = [
  { id: "b-1", type: "TEXT", position: 0, payload: { title: "Sistema", command: "uname", html: "<p>Sobre o sistema</p>" } },
  { id: "b-2", type: "COMMAND", position: 1, payload: { steps: [{ command: "uname -o", explanation: "Mostra o sistema operacional" }, { command: "whoami", terminal: 2, login: { user: "ricardo", password: "123" } }] } },
  { id: "b-3", type: "COMMAND", position: 2, payload: { steps: [{ command: "pwd" }] } },
];
const script = buildTopicScript(blocks);

function player(over: Partial<TopicPlayer> = {}): TopicPlayer {
  return {
    index: -1,
    playing: false,
    playingCard: null,
    running: null,
    activeCard: null,
    done: new Set(),
    speed: 1,
    setSpeed: vi.fn(),
    toggleAll: vi.fn(),
    toggleCard: vi.fn(),
    runOne: vi.fn(async () => undefined),
    next: vi.fn(async () => undefined),
    back: vi.fn(async () => undefined),
    rewind: vi.fn(),
    ...over,
  };
}

const buttons = () => screen.getAllByRole("button", { name: /Executar no terminal/ }) as HTMLButtonElement[];
const row = (step: number) => document.querySelector(`[data-step="${step}"]`) as HTMLElement;

// SPEC-060 CA-01, CA-02: in the live class, the example of a command has its run button, for who can run it and for who cannot
describe("the examples of the material in the live class", () => {
  describe("for the teacher, who can run them", () => {
    it("draws the run button of each command example, named as the study screen names it", () => {
      render(<LessonPanel script={script} player={player()} readOnly canRun />);
      expect(buttons().map((button) => button.getAttribute("aria-label"))).toEqual(["Executar no terminal 1: uname -o", "Executar no terminal 2: whoami", "Executar no terminal 1: pwd"]);
      expect(buttons().map((button) => button.title)).toEqual(["Executar no terminal 1", "Executar no terminal 2", "Executar no terminal 1"]);
      expect(buttons().every((button) => button.textContent === "▶" && !button.disabled && button.getAttribute("tabindex") === null)).toBe(true);
    });

    it("runs the example of the button, by its place in the script", () => {
      const p = player();
      render(<LessonPanel script={script} player={p} readOnly canRun />);
      fireEvent.click(buttons()[1]!);
      expect(p.runOne).toHaveBeenLastCalledWith(1);
      fireEvent.click(buttons()[2]!);
      expect(p.runOne).toHaveBeenLastCalledWith(2);
      expect(p.runOne).toHaveBeenCalledTimes(2);
    });

    // CA-03
    it("shows the state of the example that runs, in its own row, and turns off the buttons of all the others", () => {
      render(<LessonPanel script={script} player={player({ running: 1 })} readOnly canRun />);
      expect(row(1).classList.contains("running")).toBe(true);
      expect(row(0).classList.contains("running")).toBe(false);
      expect(row(2).classList.contains("running")).toBe(false);
      expect(buttons().map((button) => button.disabled)).toEqual([true, true, true]);
    });

    it("turns the buttons on again when the example ends", () => {
      const view = render(<LessonPanel script={script} player={player({ running: 0 })} readOnly canRun />);
      expect(buttons().every((button) => button.disabled)).toBe(true);
      view.rerender(<LessonPanel script={script} player={player({ running: null })} readOnly canRun />);
      expect(buttons().every((button) => !button.disabled)).toBe(true);
      expect(row(0).classList.contains("running")).toBe(false);
    });

    it("runs nothing from a button that is off", () => {
      const p = player({ running: 0 });
      render(<LessonPanel script={script} player={p} readOnly canRun />);
      fireEvent.click(buttons()[1]!);
      expect(p.runOne).not.toHaveBeenCalled();
    });
  });

  describe("for the student, who only sees them", () => {
    it("draws the same buttons, with the same names, off", () => {
      render(<LessonPanel script={script} player={player()} readOnly />);
      expect(buttons().map((button) => button.getAttribute("aria-label"))).toEqual(["Executar no terminal 1: uname -o", "Executar no terminal 2: whoami", "Executar no terminal 1: pwd"]);
      expect(buttons().every((button) => button.disabled && button.textContent === "▶")).toBe(true);
    });

    it("keeps the buttons out of the order of the tab, and runs nothing when they are clicked", () => {
      const p = player();
      render(<LessonPanel script={script} player={p} readOnly canRun={false} />);
      expect(buttons().map((button) => button.tabIndex)).toEqual([-1, -1, -1]);
      for (const button of buttons()) fireEvent.click(button);
      expect(p.runOne).not.toHaveBeenCalled();
    });

    it("draws the buttons with the class of the teacher's, so they have the same size and place", () => {
      const view = render(<LessonPanel script={script} player={player()} readOnly canRun />);
      const teacher = buttons().map((button) => button.className);
      view.unmount();
      render(<LessonPanel script={script} player={player()} readOnly />);
      expect(buttons().map((button) => button.className)).toEqual(teacher);
      expect(teacher.every((name) => name === "run")).toBe(true);
    });
  });

  // CA-06: what is for the study alone stays out of the live class, and the study screen keeps its own button
  describe("what does not change", () => {
    it("leaves out of the live class the button of the card and the marks, which are for the study alone", () => {
      render(<LessonPanel script={script} player={player()} readOnly canRun />);
      expect(screen.queryByText(/Rodar este card/)).toBeNull();
      expect(screen.queryByText(/Marcar como visto/)).toBeNull();
    });

    it("keeps the button of the study screen on: it runs even while another example runs, as the player says", () => {
      const p = player({ running: 0 });
      render(<LessonPanel script={script} player={p} />);
      expect(buttons().every((button) => !button.disabled && button.getAttribute("tabindex") === null)).toBe(true);
      expect(screen.getAllByText(/Rodar este card/).length).toBeGreaterThan(0);
      fireEvent.click(buttons()[1]!);
      expect(p.runOne).toHaveBeenCalledWith(1);
    });

    it("keeps the study screen's button on whatever `canRun` says, since it is only for the live class", () => {
      render(<LessonPanel script={script} player={player()} canRun={false} />);
      expect(buttons().every((button) => !button.disabled)).toBe(true);
    });
  });

  // CA-05: the button is the same box in both, and the state of the example changes no size
  describe("the style of the button", () => {
    // The name is kept in a variable: written in the call, Vite would take it as an asset to be built.
    const file = "./LessonPanel.module.scss";
    const css = readFileSync(new URL(file, import.meta.url), "utf8");
    /** The body of a rule, from its opening brace to the brace that closes it, whatever is nested in it. */
    const body = (selector: string) => {
      // The selector starts its line, so `.run` is not found at the end of `&.running .run`.
      const found = new RegExp(`(^|\\n)[ \\t]*${selector.replace(/[.*+?^${}()|[\]\\&]/g, "\\$&")} \\{`).exec(css);
      expect(found).not.toBeNull();
      const start = css.indexOf("{", found!.index);
      let depth = 0;
      for (let i = start; i < css.length; i++) {
        if (css[i] === "{") depth++;
        if (css[i] === "}" && --depth === 0) return css.slice(start + 1, i);
      }
      return "";
    };
    const BOX = /(^|[\s;{])(width|height|min-width|min-height|margin[\w-]*|padding[\w-]*|border(-width)?|display|position|flex[\w-]*|font-size|line-height|gap|order)\s*:/;
    /** The `&:disabled` rule nested in `.run`, which is where the off button is styled. */
    const off = () => {
      const run = body(".run");
      const start = run.indexOf("&:disabled");
      expect(start).toBeGreaterThanOrEqual(0);
      return run.slice(start, run.indexOf("}", start));
    };

    it("is a box of a fixed size, which is the same on and off", () => {
      expect(body(".run")).toMatch(/width:\s*28px/);
      expect(body(".run")).toMatch(/height:\s*28px/);
      expect(off()).not.toMatch(BOX);
    });

    it("does not answer to the mouse when it is off: no pointer, no color of the hover", () => {
      expect(off()).toMatch(/cursor:\s*default/);
      expect(body(".run")).toMatch(/&:hover:not\(:disabled\)/);
    });

    it("changes no size when the example is the one that runs: the row only changes color and the button only pulses", () => {
      expect(body("&.current")).not.toMatch(BOX);
      expect(body("&.running .run")).not.toMatch(BOX);
    });
  });
});
