import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TeacherSplitView } from "./TeacherSplitView";

afterEach(cleanup);

// SPEC-054 CA-07, CA-13 and CA-14
describe("TeacherSplitView", () => {
  it("shows My screen and the Class screen at the same time, the second as read only and labeled", () => {
    render(<TeacherSplitView mine={<p>so eu vejo</p>} classScreen={<p>a turma vê</p>} accepted={3} />);
    const mine = screen.getByRole("region", { name: "Minha tela" });
    const klass = screen.getByRole("region", { name: "Tela da turma" });
    expect(within(mine).getByText("so eu vejo")).toBeDefined();
    expect(within(klass).getByText("a turma vê")).toBeDefined();
    expect(within(klass).getByText("A turma está vendo isto")).toBeDefined();
    expect(within(klass).getByText("3 estudantes aceitos")).toBeDefined();
    expect(within(mine).queryByText("a turma vê")).toBeNull();
  });

  it("says one student, in the singular", () => {
    render(<TeacherSplitView mine={null} classScreen={null} accepted={1} />);
    expect(screen.getByText("1 estudante aceito")).toBeDefined();
  });

  it("collapses the Class screen and brings it back", () => {
    render(<TeacherSplitView mine={<p>minha</p>} classScreen={<p>turma</p>} accepted={0} />);
    const toggle = screen.getByRole("button", { name: "Recolher a tela da turma" });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(toggle);
    expect(screen.queryByText("turma")).toBeNull();
    expect(screen.getByText("minha")).toBeDefined();
    const back = screen.getByRole("button", { name: "Mostrar a tela da turma" });
    expect(back.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(back);
    expect(screen.getByText("turma")).toBeDefined();
  });

  // CA-14: only tokens, never a color written in the style
  it("uses only the color tokens", () => {
    const css = readFileSync("src/components/Classroom/TeacherSplitView/TeacherSplitView.module.scss", "utf8");
    expect(css.length).toBeGreaterThan(0);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\brgba?\(/);
  });
});
