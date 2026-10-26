import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClassForm } from "./ClassForm";

afterEach(cleanup);

const open = (name: string) => fireEvent.click(screen.getByRole("tab", { name }));
const panelOf = (name: string) => document.getElementById(screen.getByRole("tab", { name }).getAttribute("aria-controls")!)!;

function fillRequired() {
  fireEvent.change(screen.getByLabelText(/Nome da Turma/i), { target: { value: "Turma A" } });
  fireEvent.change(screen.getByLabelText(/Código da Disciplina/i), { target: { value: "SO34E" } });
  fireEvent.change(screen.getByLabelText(/Semestre Letivo/i), { target: { value: "2026/2" } });
  fireEvent.change(screen.getByLabelText(/Data de Início/i), { target: { value: "2026-08-01" } });
  fireEvent.change(screen.getByLabelText(/Data de Término/i), { target: { value: "2026-12-01" } });
}

// SPEC-078 CA-05 (section 3.1): the Informações tab in four groups, and the virtual meetings out of the Horários tab.
describe("ClassForm groups and fields by tab", () => {
  it("groups the data of the class: identification with the color, presentation, validity and virtual meetings", () => {
    render(<ClassForm onSubmit={vi.fn()} />);
    const info = panelOf("Informações");

    const identification = within(info).getByRole("group", { name: "Identificação" });
    expect(within(identification).getByLabelText(/Nome da Turma/i)).toBeDefined();
    expect(within(identification).getByLabelText(/Código da Disciplina/i)).toBeDefined();
    expect(within(identification).getByLabelText(/Semestre Letivo/i)).toBeDefined();
    expect(within(identification).getByRole("radiogroup", { name: "Cor da turma" })).toBeDefined();

    const presentation = within(info).getByRole("group", { name: "Apresentação" });
    expect(within(presentation).getByRole("textbox", { name: "Resumo da disciplina" })).toBeDefined();

    const validity = within(info).getByRole("group", { name: "Vigência" });
    expect(within(validity).getByLabelText(/Data de Início/i)).toBeDefined();
    expect(within(validity).getByLabelText(/Data de Término/i)).toBeDefined();

    const virtual = within(info).getByRole("group", { name: "Encontros virtuais" });
    expect(within(virtual).getByRole("checkbox", { name: /Habilitar Encontros Virtuais Integrados/i })).toBeDefined();
  });

  it("keeps the virtual meetings out of the Horários tab, and still sends the choice", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ClassForm onSubmit={onSubmit} />);
    expect(within(panelOf("Horários")).queryByLabelText(/Encontros Virtuais/i)).toBeNull();

    fillRequired();
    fireEvent.click(within(panelOf("Informações")).getByRole("checkbox", { name: /Encontros Virtuais/i }));
    fireEvent.click(screen.getByRole("button", { name: "Criar Turma" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.lastCall?.[0].enableVirtualClassroom).toBe(true);
  });

  it("does not show the old schedule text when the class has none saved", () => {
    render(<ClassForm onSubmit={vi.fn()} />);
    expect(screen.queryByLabelText(/Horários dos Encontros/i)).toBeNull();
  });

  it("shows the old schedule text only while it is saved and there are no meetings, and sends it back", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ClassForm onSubmit={onSubmit} initialData={{ scheduleDescription: "Seg 08:20" }} />);
    const text = within(panelOf("Horários")).getByLabelText(/Horários dos Encontros/i) as HTMLInputElement;
    expect(text.value).toBe("Seg 08:20");

    fillRequired();
    fireEvent.click(screen.getByRole("button", { name: "Criar Turma" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.lastCall?.[0].scheduleDescription).toBe("Seg 08:20");

    open("Horários");
    fireEvent.click(screen.getByRole("button", { name: "Segunda-feira" }));
    expect(screen.queryByLabelText(/Horários dos Encontros/i)).toBeNull();
  });
});
