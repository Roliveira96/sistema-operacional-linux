import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { summary } from "@/test/assessmentFixtures";
import type { AssessmentSummary } from "@/services/assessmentService";
import { AssessmentList } from "./AssessmentList";

afterEach(cleanup);

function setup(items: AssessmentSummary[]) {
  const h = { onNew: vi.fn(), onRetry: vi.fn(), onEdit: vi.fn(), onPreview: vi.fn(), onReschedule: vi.fn(), onCancel: vi.fn() };
  render(<AssessmentList status="ready" items={items} hrefOf={(a) => `/app/classes/c-1/assessments/${a.id}`} {...h} />);
  return h;
}

const more = (title: string) => screen.getByRole("button", { name: `Mais ações de ${title}` });
const exam = () => summary({ id: "a-1", title: "Prova 1: permissões" });

// SPEC-080 CA-04 and CA-05: the actions of rare use are in the menu Mais ações, with Cancelar last.
describe("AssessmentList menu of actions", () => {
  it("has Pré-visualizar, Reagendar and Cancelar in the menu, the last one apart, and runs the one that is chosen", () => {
    const h = setup([exam()]);
    fireEvent.click(more("Prova 1: permissões"));
    const menu = screen.getByRole("menu");
    expect(within(menu).getAllByRole("menuitem").map((i) => i.textContent)).toEqual(["Pré-visualizar", "Reagendar", "Cancelar"]);

    fireEvent.click(within(menu).getByRole("menuitem", { name: "Reagendar" }));
    expect(h.onReschedule).toHaveBeenCalledWith(expect.objectContaining({ id: "a-1" }));
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.click(more("Prova 1: permissões"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Pré-visualizar" }));
    expect(h.onPreview).toHaveBeenCalledWith(expect.objectContaining({ id: "a-1" }));

    fireEvent.click(more("Prova 1: permissões"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Cancelar" }));
    expect(h.onCancel).toHaveBeenCalledWith(expect.objectContaining({ id: "a-1" }));
  });

  it("opens with the arrow down, walks with the arrows, and gives the focus back to the button on Escape", () => {
    setup([exam()]);
    const button = more("Prova 1: permissões");
    button.focus();
    fireEvent.keyDown(button, { key: "ArrowDown" });
    const items = screen.getAllByRole("menuitem");
    expect(document.activeElement).toBe(items[0]);

    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "End" });
    expect(document.activeElement).toBe(items[2]);

    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("shows the words Mais ações on the button, and keeps Editar in view", () => {
    setup([exam()]);
    expect(more("Prova 1: permissões").textContent).toBe("Mais ações");
    expect(screen.getByRole("button", { name: "Editar Prova 1: permissões" })).toBeDefined();
    expect(screen.queryByRole("button", { name: /^Reagendar/ })).toBeNull(); // only inside the menu, once it is open
  });

  it("keeps an action that the phase does not allow in the menu, off, with the reason tied to it", () => {
    const h = setup([summary({ id: "a-2", title: "Passada", phase: "ENDED" })]);
    fireEvent.click(more("Passada"));
    const reschedule = screen.getByRole("menuitem", { name: "Reagendar" });
    const reason = screen.getByText("A avaliação já terminou.");
    expect(reschedule.getAttribute("aria-disabled")).toBe("true");
    expect(reschedule.getAttribute("aria-describedby")).toBe(reason.id);
    expect(screen.getByRole("menuitem", { name: "Cancelar" }).getAttribute("aria-disabled")).toBeNull();

    fireEvent.click(reschedule);
    expect(h.onReschedule).not.toHaveBeenCalled();
  });

  it("leaves only the preview on in a canceled assessment, and Editar off", () => {
    setup([summary({ id: "a-3", title: "Desfeita", status: "CANCELED", cancelReason: "Falta de energia" })]);
    expect((screen.getByRole("button", { name: "Editar Desfeita" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(more("Desfeita"));
    expect(screen.getByRole("menuitem", { name: "Pré-visualizar" }).getAttribute("aria-disabled")).toBeNull();
    for (const name of ["Reagendar", "Cancelar"]) expect(screen.getByRole("menuitem", { name }).getAttribute("aria-disabled")).toBe("true");
  });
});
