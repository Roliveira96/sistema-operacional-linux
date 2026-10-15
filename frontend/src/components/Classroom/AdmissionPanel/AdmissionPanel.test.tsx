import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdmissionEntry } from "@/services/classroomService";
import { AdmissionPanel } from "./AdmissionPanel";

afterEach(cleanup);

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();
const ana: AdmissionEntry = { studentId: "u-1", name: "Ana", requestedAt: minutesAgo(5) };
const bruno: AdmissionEntry = { studentId: "u-2", name: "Bruno", requestedAt: minutesAgo(0.5) };
const carla: AdmissionEntry = { studentId: "u-3", name: "Carla" };

function setup(waiting: AdmissionEntry[], admitted: AdmissionEntry[] = []) {
  const handlers = { onAccept: vi.fn(), onAcceptAll: vi.fn(), onRemove: vi.fn() };
  const view = render(<AdmissionPanel waiting={waiting} admitted={admitted} {...handlers} />);
  return { ...handlers, ...view };
}

// SPEC-054 CA-06
describe("AdmissionPanel", () => {
  it("says when nobody is waiting", () => {
    setup([]);
    expect(screen.getByRole("heading", { name: "Sala de espera" })).toBeDefined();
    expect(screen.getByText("Nenhum aluno esperando. Compartilhe o aviso da aula com a turma.")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Aceitar todos" })).toBeNull();
  });

  it("lists who waits, with how long, and accepts one, all or declines", () => {
    const h = setup([ana, bruno]);
    const list = screen.getByRole("list", { name: "Aguardando" });
    expect(within(list).getByText("Ana")).toBeDefined();
    expect(within(list).getByText("há 5 min")).toBeDefined();
    expect(within(list).getByText("há menos de 1 min")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Aceitar Ana" }));
    expect(h.onAccept).toHaveBeenCalledWith("u-1");
    fireEvent.click(screen.getByRole("button", { name: "Recusar Bruno" }));
    expect(h.onRemove).toHaveBeenCalledWith("u-2");
    fireEvent.click(screen.getByRole("button", { name: "Aceitar todos" }));
    expect(h.onAcceptAll).toHaveBeenCalledTimes(1);
  });

  // SPEC-055 CA-19: accept all is the main button of the waiting room
  it("makes Accept all the main button, and Accept of each student the secondary one", () => {
    setup([ana, bruno]);
    expect(screen.getByRole("button", { name: "Aceitar todos" }).className).toContain("primary");
    expect(screen.getByRole("button", { name: "Aceitar Ana" }).className).not.toContain("primary");
  });

  it("lists who is in the class, counts them and removes one", () => {
    const h = setup([], [carla, bruno]);
    expect(screen.getByText("Aceitos: 2")).toBeDefined();
    const list = screen.getByRole("list", { name: "Na aula" });
    expect(within(list).getByText("Carla")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Remover Carla da aula" }));
    expect(h.onRemove).toHaveBeenCalledWith("u-3");
  });

  it("warns, quietly, when a new student arrives, and not for who was already waiting", () => {
    const h = setup([ana]);
    expect(screen.queryByText(/Novo estudante/)).toBeNull();
    h.rerender(<AdmissionPanel waiting={[ana, carla]} admitted={[]} onAccept={h.onAccept} onAcceptAll={h.onAcceptAll} onRemove={h.onRemove} />);
    expect(screen.getByRole("status").textContent).toBe("Novo estudante na sala de espera: Carla");
  });
});
