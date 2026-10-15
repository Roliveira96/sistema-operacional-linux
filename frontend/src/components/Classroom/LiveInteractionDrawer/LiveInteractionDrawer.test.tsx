import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveInteractionDrawer } from "./LiveInteractionDrawer";

afterEach(cleanup);

const hands = [
  { studentId: "u-1", name: "Ana Souza", requestedAt: "2026-10-14T10:00:00Z" },
  { studentId: "u-2", name: "Bruno Lima", requestedAt: "2026-10-14T10:01:00Z" },
];

// SPEC-051 CA-08 and CA-09
describe("LiveInteractionDrawer", () => {
  it("lets a student raise the hand", () => {
    const onRaise = vi.fn();
    render(<LiveInteractionDrawer role="student" userId="u-9" hands={[]} onRaise={onRaise} onLower={vi.fn()} onModerate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Levantar a mão" }));
    expect(onRaise).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Mãos levantadas")).toBeNull();
  });

  it("shows the student that the hand is up, with the place in the line, and lets him lower it", () => {
    const onLower = vi.fn();
    render(<LiveInteractionDrawer role="student" userId="u-2" hands={hands} onRaise={vi.fn()} onLower={onLower} onModerate={vi.fn()} />);
    expect(screen.getByText("Sua mão está levantada.")).toBeDefined();
    expect(screen.getByText("2º na fila")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Levantar a mão" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Abaixar a mão" }));
    expect(onLower).toHaveBeenCalledTimes(1);
  });

  it("shows the teacher the line in the order they came, and lets him lower one hand or all", () => {
    const onModerate = vi.fn();
    render(<LiveInteractionDrawer role="teacher" userId="t-1" hands={hands} onRaise={vi.fn()} onLower={vi.fn()} onModerate={onModerate} />);
    expect(screen.getByRole("heading", { name: "Mãos levantadas" })).toBeDefined();
    const names = screen.getAllByRole("listitem").map((item) => item.textContent);
    expect(names[0]).toContain("Ana Souza");
    expect(names[1]).toContain("Bruno Lima");
    fireEvent.click(screen.getByRole("button", { name: "Baixar a mão de Bruno Lima" }));
    expect(onModerate).toHaveBeenLastCalledWith("u-2");
    fireEvent.click(screen.getByRole("button", { name: "Baixar todas" }));
    expect(onModerate).toHaveBeenLastCalledWith(undefined);
    expect(screen.queryByRole("button", { name: "Levantar a mão" })).toBeNull();
  });

  it("says when nobody has the hand up, and has no button to lower all", () => {
    render(<LiveInteractionDrawer role="teacher" userId="t-1" hands={[]} onRaise={vi.fn()} onLower={vi.fn()} onModerate={vi.fn()} />);
    expect(screen.getByText("Ninguém com a mão levantada.")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Baixar todas" })).toBeNull();
  });

  it("makes room for the notes of the student", () => {
    render(
      <LiveInteractionDrawer role="student" userId="u-1" hands={[]} onRaise={vi.fn()} onLower={vi.fn()} onModerate={vi.fn()}>
        <p>caderno aqui</p>
      </LiveInteractionDrawer>,
    );
    expect(screen.getByText("caderno aqui")).toBeDefined();
  });
});
