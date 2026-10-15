import { readFileSync } from "node:fs";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { messages } from "@/messages/pt-BR";
import { WaitingScreen } from "./WaitingScreen";

// The path goes through a variable on purpose: Vite rewrites `new URL("./literal", import.meta.url)` as an asset address. Some styles use CRLF.
const styleOf = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const css = styleOf("./WaitingScreen.module.scss");
const tokens = styleOf("../../../styles/_tokens.scss");

/** The text between the braces of the block that opens at the first `{` after `from`, with the inner braces matched. */
function blockAfter(source: string, from: number): string {
  const open = source.indexOf("{", from);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(open + 1, i);
  }
  throw new Error("unbalanced block in the style");
}

/** The declarations of the rule `.name { ... }`. */
const rule = (name: string) => {
  const at = css.search(new RegExp(`^\\.${name}\\s*\\{`, "m"));
  expect(at, `the rule .${name} exists`).toBeGreaterThanOrEqual(0);
  return blockAfter(css, at);
};

/** Each `@keyframes` of the style, with the properties its steps set. */
const keyframes = () =>
  [...css.matchAll(/@keyframes\s+([\w-]+)/g)].map((found) => {
    const body = blockAfter(css, found.index!);
    return { name: found[1]!, properties: new Set([...body.matchAll(/([a-z-]+)\s*:/g)].map((property) => property[1]!)) };
  });

const STARTED = "2026-10-14T10:00:00Z";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(new Date("2026-10-14T11:05:30Z"));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const screenOf = () => screen.getByRole("status", { name: "Tela de espera" });

// SPEC-061 CA-02: the title of the class and the time of the class, running second by second, the same for everybody
describe("WaitingScreen", () => {
  it("shows the title of the class and the time since it began, as hh:mm:ss", () => {
    render(<WaitingScreen title="Permissões de arquivos" startedAt={STARTED} />);
    expect(screen.getByText("Permissões de arquivos")).toBeDefined();
    expect(screen.getByText("01:05:30")).toBeDefined();
  });

  it("keeps the time running, second by second", () => {
    render(<WaitingScreen title="Permissões" startedAt={STARTED} />);
    act(() => void vi.advanceTimersByTime(1000));
    expect(screen.getByText("01:05:31")).toBeDefined();
    act(() => void vi.advanceTimersByTime(59_000));
    expect(screen.getByText("01:06:30")).toBeDefined();
  });

  it("counts from the start of the class it is given, and a new start corrects it at once", () => {
    const view = render(<WaitingScreen title="Permissões" startedAt={STARTED} />);
    view.rerender(<WaitingScreen title="Permissões" startedAt="2026-10-14T10:30:00Z" />);
    expect(screen.getByText("00:35:30")).toBeDefined();
  });

  it("starts at 00:00:00 for a start that is a little ahead of the clock of the browser", () => {
    render(<WaitingScreen title="Permissões" startedAt="2026-10-14T11:05:34Z" />);
    expect(screen.getByText("00:00:00")).toBeDefined();
  });

  it("says 'Aula ao vivo' when the class has no title", () => {
    const view = render(<WaitingScreen title="" startedAt={STARTED} />);
    expect(screen.getByText("Aula ao vivo")).toBeDefined();
    view.rerender(<WaitingScreen title="   " startedAt={STARTED} />);
    expect(screen.getByText("Aula ao vivo")).toBeDefined();
  });

  it("tells, in a short line, that the class will go on", () => {
    render(<WaitingScreen title="Permissões" startedAt={STARTED} />);
    expect(screen.getByText("A aula já vai continuar")).toBeDefined();
  });

  it("is a status called 'Tela de espera'", () => {
    render(<WaitingScreen title="Permissões" startedAt={STARTED} />);
    expect(screenOf().textContent).toContain("Permissões");
  });

  it("does not make the screen reader tell the time at every second, and tells the title", () => {
    render(<WaitingScreen title="Permissões" startedAt={STARTED} />);
    expect(screen.getByText("01:05:30").closest("[aria-hidden='true']")).not.toBeNull();
    expect(screen.getByText("Permissões").closest("[aria-hidden='true']")).toBeNull();
    expect(screen.getByText("A aula já vai continuar").closest("[aria-hidden='true']")).toBeNull();
  });

  it("stops the clock when it goes away", () => {
    const view = render(<WaitingScreen title="Permissões" startedAt={STARTED} />);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

// SPEC-061 CA-03: colorful and moving, with the tokens of the theme only, and only with transform and opacity
describe("the style of the waiting screen", () => {
  it("covers the whole stage, over everything the stage draws", () => {
    const body = rule("screen");
    expect(body).toMatch(/position:\s*absolute/);
    expect(body).toMatch(/inset:\s*0\b/);
    expect(body).toMatch(/overflow:\s*hidden/);
    // The slides and the pointer of the teacher are drawn at 6 and 5.
    expect(Number(/z-index:\s*(\d+)/.exec(body)?.[1])).toBeGreaterThan(6);
  });

  it("has no color written in the style, and every variable it reads is a token or its own", () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix)\(/);
    const own = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((found) => found[1]!));
    const read = new Set([...css.matchAll(/var\((--[\w-]+)/g)].map((found) => found[1]!));
    expect(read.size).toBeGreaterThan(0);
    for (const name of read) expect(own.has(name) || tokens.includes(`${name}:`), `${name} is a token`).toBe(true);
  });

  it("paints the blobs with the orange of the accent, the blue, the green and the amber of the theme", () => {
    for (const token of ["--color-accent", "--color-info", "--color-success", "--color-warning"]) expect(css).toContain(`var(${token})`);
  });

  it("has a dark gradient behind the blobs, from the tokens", () => {
    expect(rule("screen")).toMatch(/background:\s*linear-gradient\([^;]*var\(--/);
  });

  it("moves only with transform and opacity, with the keyframes in this very file", () => {
    const all = keyframes();
    expect(all.length).toBeGreaterThan(0);
    for (const { name, properties } of all) {
      expect([...properties].filter((property) => !["transform", "opacity"].includes(property)), `the steps of ${name}`).toEqual([]);
      expect(css, `${name} is used`).toMatch(new RegExp(`animation(-name)?:[^;]*\\b${name}\\b`));
    }
    // Every animation points to keyframes declared above, so nothing depends on another file (the build renames names across files).
    for (const found of css.matchAll(/animation(?:-name)?:\s*([^;]+);/g)) {
      if (found[1]!.trim() === "none") continue;
      expect(all.some(({ name }) => new RegExp(`\\b${name}\\b`).test(found[1]!)), found[1]).toBe(true);
    }
  });

  it("never animates the place or the size of anything", () => {
    expect(css).not.toMatch(/transition\s*:/);
    expect(css).not.toMatch(/transition-property\s*:/);
    for (const { properties } of keyframes()) for (const property of ["top", "left", "right", "bottom", "width", "height", "margin", "inset", "filter", "box-shadow"]) expect(properties.has(property)).toBe(false);
  });

  it("asks the browser to prepare only transform and opacity, and only for the blobs", () => {
    for (const found of css.matchAll(/will-change:\s*([^;]+);/g)) {
      for (const property of found[1]!.split(",").map((part) => part.trim())) expect(["transform", "opacity", "auto"]).toContain(property);
    }
    expect(css).toMatch(/will-change:\s*transform,\s*opacity/);
    for (const name of ["screen", "content", "title", "clock", "note"]) expect(rule(name)).not.toMatch(/will-change/);
  });

  it("stops the movement for who asks for reduced motion, and the time keeps running", () => {
    const at = css.indexOf("@media (prefers-reduced-motion: reduce)");
    expect(at).toBeGreaterThanOrEqual(0);
    expect(blockAfter(css, at)).toMatch(/\.blob\s*\{[^}]*animation:\s*none/);
    // The way of stopping it is the style: the clock is a component with its own timer, which no style reaches.
    expect(css.match(/@media[^{]*/g)!.map((query) => query.trim())).toEqual(["@media (prefers-reduced-motion: reduce)"]);
  });

  it("declares the animation of the blobs in one place, so the reduced motion has one thing to stop", () => {
    const outside = css.replace(/@media[^{]*\{(?:[^{}]|\{[^{}]*\})*\}/g, "").replace(/@keyframes[^{]*\{(?:[^{}]|\{[^{}]*\})*\}/g, "");
    expect(outside.match(/animation\s*:/g) ?? []).toHaveLength(1);
  });

  it("writes the time with numbers of fixed width, so the digits do not dance", () => {
    expect(rule("clock")).toMatch(/font-variant-numeric:\s*tabular-nums/);
  });

  it("puts the title big and in the center, with the time and the line below it", () => {
    expect(rule("screen")).toMatch(/align-items:\s*center/);
    expect(rule("screen")).toMatch(/justify-content:\s*center/);
    expect(rule("title")).toMatch(/text-align:\s*center/);
    expect(rule("title")).toMatch(/font-size:\s*calc\(var\(--font-size-/);
  });

  it("does not read the size of the window: the stage is the same for everybody", () => {
    expect(css).not.toMatch(/\d(vh|vw|dvh|dvw)\b/);
  });
});

// SPEC-061 CA-06: nothing of the interface says "Tela preta" any more; the protocol does not change (the state is still `blank`)
describe("the texts of the waiting screen", () => {
  const texts = (value: unknown): string[] => {
    if (typeof value === "string") return [value];
    if (Array.isArray(value)) return value.flatMap(texts);
    if (value && typeof value === "object") return Object.values(value).flatMap(texts);
    return [];
  };

  it("has no text that says 'Tela preta'", () => {
    expect(texts(messages).filter((text) => /tela preta/i.test(text))).toEqual([]);
  });

  it("calls the button, the label and the notice of the teacher 'Tela de espera'", () => {
    expect(messages.classroom.present.blank).toBe("Tela de espera");
    expect(messages.classroom.present.blankOn).toBe("Tela de espera ligada. Aperte B para voltar.");
  });

  it("calls the key B and the tip 'tela de espera'", () => {
    const keyB = messages.classroom.present.keys.find(([key]) => key === "B");
    expect(keyB?.[1]).toMatch(/^tela de espera/);
    expect(messages.classroom.present.tipText).toContain("B tela de espera");
  });
});
