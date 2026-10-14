import { readFileSync } from "node:fs";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveInteractionDrawer } from "./LiveInteractionDrawer";

const styleOf = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const css = styleOf("./LiveInteractionDrawer.module.scss");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(new Date("2026-10-14T10:05:00Z"));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const hands = [
  { studentId: "u-1", name: "Ana Souza", requestedAt: "2026-10-14T10:00:00Z", question: "Como uso o chmod?\nE o chown?" },
  { studentId: "u-2", name: "Bruno Lima", requestedAt: "2026-10-14T10:04:40Z", question: "" },
  { studentId: "u-3", name: "Carla Dias", requestedAt: "2026-10-14T10:03:00Z" },
];

const teacher = (list = hands, onModerate = vi.fn()) =>
  render(<LiveInteractionDrawer role="teacher" userId="t-1" hands={list} onRaise={vi.fn()} onLower={vi.fn()} onModerate={onModerate} />);
const item = (name: string) => screen.getByText(name).closest("li") as HTMLElement;

// SPEC-058 CA-06: each hand in the panel has the name, how long ago, and the doubt, as text
describe("the raised hands in the panel of the teacher", () => {
  it("shows the name, how long ago the hand went up, and the doubt", () => {
    teacher();
    const ana = within(item("Ana Souza"));
    expect(ana.getByText("há 5 min")).toBeDefined();
    expect(ana.getByTestId("hand-question").textContent).toBe("Como uso o chmod?\nE o chown?");
  });

  it("says 'less than a minute' for a hand that just went up", () => {
    teacher();
    expect(within(item("Bruno Lima")).getByText("há menos de 1 min")).toBeDefined();
  });

  it("shows only the name and the time of a hand without a doubt, whether the question is empty or missing", () => {
    teacher();
    for (const name of ["Bruno Lima", "Carla Dias"]) {
      expect(within(item(name)).queryByTestId("hand-question")).toBeNull();
    }
    expect(within(item("Carla Dias")).getByText("há 2 min")).toBeDefined();
  });

  it("shows the doubt as text, never as HTML", () => {
    const attack = `<img src=x onerror="alert(1)"><b>negrito</b> <script>alert(2)</script>`;
    const view = teacher([{ studentId: "u-1", name: "Ana Souza", requestedAt: "2026-10-14T10:00:00Z", question: attack }]);
    expect(within(item("Ana Souza")).getByTestId("hand-question").textContent).toBe(attack);
    expect(view.container.querySelector("img, b, script")).toBeNull();
  });

  it("keeps the line breaks of the doubt", () => {
    const rule = css.slice(css.indexOf(".question {"), css.indexOf("}", css.indexOf(".question {")));
    expect(rule).toMatch(/white-space:\s*pre-wrap/);
    expect(rule).toMatch(/overflow-wrap:\s*anywhere/);
  });

  it("keeps the order they came in and the actions of before: lower one hand, lower all", () => {
    const onModerate = vi.fn();
    teacher(hands, onModerate);
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      expect.stringContaining("Ana Souza"),
      expect.stringContaining("Bruno Lima"),
      expect.stringContaining("Carla Dias"),
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Baixar a mão de Ana Souza" }));
    expect(onModerate).toHaveBeenLastCalledWith("u-1");
    fireEvent.click(screen.getByRole("button", { name: "Baixar todas" }));
    expect(onModerate).toHaveBeenLastCalledWith(undefined);
  });

  it("keeps counting how long ago while the panel stays open", () => {
    teacher();
    expect(within(item("Bruno Lima")).getByText("há menos de 1 min")).toBeDefined();
    act(() => void vi.advanceTimersByTime(60_000));
    expect(within(item("Bruno Lima")).getByText("há 1 min")).toBeDefined();
    expect(within(item("Ana Souza")).getByText("há 6 min")).toBeDefined();
  });

  it("shows nothing about time or doubt for the student, who has only his own button", () => {
    render(<LiveInteractionDrawer role="student" userId="u-1" hands={hands} onRaise={vi.fn()} onLower={vi.fn()} onModerate={vi.fn()} />);
    expect(screen.queryByTestId("hand-question")).toBeNull();
    expect(screen.queryByText(/há \d+ min|há menos/)).toBeNull();
  });
});
