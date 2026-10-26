import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClassForm } from "./ClassForm";

afterEach(cleanup);

/** The name of a control: its label, or what the author wrote for it. */
const named = (el: Element) => (el as HTMLInputElement).labels?.length || el.getAttribute("aria-label") || el.getAttribute("aria-labelledby");

// SPEC-078 CA-01, CA-17 (section 3.1): the bar of actions and the names of the controls.
describe("ClassForm accessibility", () => {
  it("keeps Cancelar and Salvar together in one bar of actions, in that order", () => {
    render(<ClassForm onSubmit={vi.fn()} cancelHref="/app/classes/c-1" submitLabel="Salvar Alterações" />);
    const bar = screen.getByRole("group", { name: "Ações do formulário" });
    const cancel = within(bar).getByRole("link", { name: "Cancelar" });
    const submit = within(bar).getByRole("button", { name: "Salvar Alterações" });
    expect(cancel.getAttribute("href")).toBe("/app/classes/c-1");
    expect(cancel.compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(bar.closest("form")).not.toBeNull();
  });

  it("gives every control of every tab a name, and groups with a legend", () => {
    render(<ClassForm onSubmit={vi.fn()} classId="c-1" loadModules={vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, limit: 50 })} />);
    // the groups are in the tab that is open at first
    for (const name of ["Identificação", "Apresentação", "Vigência", "Encontros virtuais"]) expect(screen.getByRole("group", { name })).toBeDefined();
    for (const tab of screen.getAllByRole("tab")) {
      fireEvent.click(tab);
      const panel = document.getElementById(tab.getAttribute("aria-controls")!)!;
      for (const control of panel.querySelectorAll("input, select, textarea")) {
        expect(named(control), `${tab.textContent}: ${control.outerHTML}`).toBeTruthy();
      }
    }
  });
});
