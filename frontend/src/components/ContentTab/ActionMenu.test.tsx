import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionMenu, type MenuAction } from "./ActionMenu";

afterEach(cleanup);

function setup(actions: MenuAction[], wide?: boolean) {
  render(
    <>
      <p id="why">Cancelada: só leitura</p>
      <ActionMenu label="Mais ações de Prova 1" text={wide ? "Mais ações" : "⋯"} actions={actions} wide={wide} />
    </>,
  );
  return screen.getByRole("button", { name: "Mais ações de Prova 1" });
}

// SPEC-080 CA-05 (section 6): an action the phase does not allow stays in the menu, off, with its reason; the menu keeps doing what it did.
describe("ActionMenu", () => {
  it("runs the action that is chosen and closes", () => {
    const onSelect = vi.fn();
    const button = setup([{ key: "a", label: "Reagendar", onSelect }]);
    fireEvent.click(button);
    fireEvent.click(screen.getByRole("menuitem", { name: "Reagendar" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("keeps an off action in the menu, readable and reachable, tied to its reason, and does not run it", () => {
    const onSelect = vi.fn();
    const button = setup([
      { key: "p", label: "Pré-visualizar", onSelect: vi.fn() },
      { key: "r", label: "Reagendar", onSelect, disabled: true, describedBy: "why" },
    ]);
    fireEvent.click(button);
    const off = screen.getByRole("menuitem", { name: "Reagendar" });
    expect(off.getAttribute("aria-disabled")).toBe("true");
    expect(off.getAttribute("aria-describedby")).toBe("why");

    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(off); // it takes the focus, so a screen reader can say why it is off

    fireEvent.click(off);
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole("menu")).toBeDefined(); // and the menu stays open
  });

  it("does not mark an action that is on", () => {
    const button = setup([{ key: "p", label: "Pré-visualizar", onSelect: vi.fn() }]);
    fireEvent.click(button);
    expect(screen.getByRole("menuitem", { name: "Pré-visualizar" }).getAttribute("aria-disabled")).toBeNull();
  });

  it("can show its text on the button, not only the three dots", () => {
    const button = setup([{ key: "p", label: "Pré-visualizar", onSelect: vi.fn() }], true);
    expect(button.textContent).toBe("Mais ações");
  });
});
