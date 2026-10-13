import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiProblemError } from "@/services/httpClient";
import { ClassForm } from "./ClassForm";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ClassForm", () => {
  it("renders form fields and submits payload", async () => {
    const handleSubmit = vi.fn().mockResolvedValue(undefined);

    render(<ClassForm onSubmit={handleSubmit} />);

    fireEvent.change(screen.getByLabelText(/Nome da Turma/i), {
      target: { value: "Turma A" },
    });
    fireEvent.change(screen.getByLabelText(/Código da Disciplina/i), {
      target: { value: "SO34E" },
    });
    fireEvent.change(screen.getByLabelText(/Semestre Letivo/i), {
      target: { value: "2026/2" },
    });
    fireEvent.change(screen.getByLabelText(/Data de Início/i), {
      target: { value: "2026-10-01" },
    });
    fireEvent.change(screen.getByLabelText(/Data de Término/i), {
      target: { value: "2026-12-01" },
    });

    fireEvent.click(screen.getByText("Criar Turma"));

    expect(handleSubmit).toHaveBeenCalled();
  });

  it("dynamically shows invite link dates when checkbox is enabled", () => {
    render(<ClassForm onSubmit={vi.fn()} />);

    expect(screen.queryByLabelText(/Início da Validade do Link/i)).toBeNull();

    const inviteCheckbox = screen.getByLabelText(/Habilitar Link de Ingresso/i);
    fireEvent.click(inviteCheckbox);

    expect(screen.getByLabelText(/Início da Validade do Link/i)).toBeDefined();
    expect(screen.getByLabelText(/Fim da Validade do Link/i)).toBeDefined();
  });

  it("validates that start date cannot be after end date", async () => {
    const handleSubmit = vi.fn();
    render(<ClassForm onSubmit={handleSubmit} />);

    fireEvent.change(screen.getByLabelText(/Nome da Turma/i), {
      target: { value: "Turma Inválida" },
    });
    fireEvent.change(screen.getByLabelText(/Código da Disciplina/i), {
      target: { value: "SO34E" },
    });
    fireEvent.change(screen.getByLabelText(/Semestre Letivo/i), {
      target: { value: "2026/2" },
    });
    fireEvent.change(screen.getByLabelText(/Data de Início/i), {
      target: { value: "2026-12-01" },
    });
    fireEvent.change(screen.getByLabelText(/Data de Término/i), {
      target: { value: "2026-10-01" },
    });

    fireEvent.click(screen.getByText("Criar Turma"));

    expect(handleSubmit).not.toHaveBeenCalled();
    expect(
      screen.getByText(/A data de início deve ser anterior ou igual à data de término/i)
    ).toBeDefined();
  });
});

function fillRequired() {
  fireEvent.change(screen.getByLabelText(/Nome da Turma/i), { target: { value: "Turma A" } });
  fireEvent.change(screen.getByLabelText(/Código da Disciplina/i), { target: { value: "SO34E" } });
  fireEvent.change(screen.getByLabelText(/Semestre Letivo/i), { target: { value: "2026/2" } });
  fireEvent.change(screen.getByLabelText(/Data de Início/i), { target: { value: "2026-08-01" } });
  fireEvent.change(screen.getByLabelText(/Data de Término/i), { target: { value: "2026-12-01" } });
}

describe("ClassForm (SPEC-041)", () => {
  it("groups the fields in four sections", () => {
    render(<ClassForm onSubmit={vi.fn()} />);
    for (const legend of ["Identificação", "Vigência e encontros", "Conteúdo", "Ingresso"]) {
      expect(screen.getByRole("group", { name: legend })).toBeDefined();
    }
  });

  // CA-10
  it("counts the summary and refuses more than 300 characters next to the field", async () => {
    const handleSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ClassForm onSubmit={handleSubmit} />);
    fillRequired();
    const summary = screen.getByLabelText(/Resumo da disciplina/i);
    fireEvent.change(summary, { target: { value: "Linux na prática" } });
    expect(screen.getByText("16/300")).toBeDefined();

    fireEvent.change(summary, { target: { value: "a".repeat(301) } });
    fireEvent.click(screen.getByRole("button", { name: "Criar Turma" }));

    await waitFor(() => expect(summary.getAttribute("aria-invalid")).toBe("true"));
    const errorId = summary.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(errorId.split(" ").find((id) => id.endsWith("-error")) ?? "")?.textContent).toMatch(/300 caracteres/);
    expect(handleSubmit).not.toHaveBeenCalled();
  });

  it("sends the summary trimmed", async () => {
    const handleSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ClassForm onSubmit={handleSubmit} />);
    fillRequired();
    fireEvent.change(screen.getByLabelText(/Resumo da disciplina/i), { target: { value: "  Linux na prática  " } });
    fireEvent.click(screen.getByRole("button", { name: "Criar Turma" }));
    await waitFor(() => expect(handleSubmit).toHaveBeenCalled());
    expect(handleSubmit.mock.calls[0][0].summary).toBe("Linux na prática");
  });

  // CA-11
  it("edits the syllabus and the guidelines in the formatted editor, without the image button", () => {
    render(<ClassForm onSubmit={vi.fn()} initialData={{ syllabus: "<p>Processos</p>" }} />);
    expect(screen.getByRole("textbox", { name: "Ementa" }).textContent).toContain("Processos");
    expect(screen.getByRole("textbox", { name: "Diretrizes institucionais" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Inserir imagem" })).toBeNull();
  });

  // CA-15
  it("shows each error below its field, marks it invalid and focuses the first one", async () => {
    const handleSubmit = vi.fn();
    render(<ClassForm onSubmit={handleSubmit} />);
    fireEvent.change(screen.getByLabelText(/Semestre Letivo/i), { target: { value: "2026/2" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar Turma" }));

    const name = screen.getByLabelText(/Nome da Turma/i);
    await waitFor(() => expect(name.getAttribute("aria-invalid")).toBe("true"));
    expect(document.activeElement).toBe(name);
    expect(screen.getByLabelText(/Código da Disciplina/i).getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByLabelText(/Semestre Letivo/i).getAttribute("aria-invalid")).not.toBe("true");
    expect(screen.getAllByText("Campo obrigatório.").length).toBeGreaterThanOrEqual(4);
    expect(handleSubmit).not.toHaveBeenCalled();
  });

  it("puts the date range error on the end date", async () => {
    render(<ClassForm onSubmit={vi.fn()} />);
    fillRequired();
    fireEvent.change(screen.getByLabelText(/Data de Término/i), { target: { value: "2026-07-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar Turma" }));
    const end = screen.getByLabelText(/Data de Término/i);
    await waitFor(() => expect(end.getAttribute("aria-invalid")).toBe("true"));
    expect(document.activeElement).toBe(end);
  });

  it("puts a summary error from the server on the summary field", async () => {
    const problem = new ApiProblemError({ type: "invalid-summary", status: 400, field: "summary" }, 400);
    render(<ClassForm onSubmit={vi.fn().mockRejectedValue(problem)} />);
    fillRequired();
    fireEvent.click(screen.getByRole("button", { name: "Criar Turma" }));
    const summary = screen.getByLabelText(/Resumo da disciplina/i);
    await waitFor(() => expect(summary.getAttribute("aria-invalid")).toBe("true"));
  });

  it("shows other server errors in the summary at the top", async () => {
    render(<ClassForm onSubmit={vi.fn().mockRejectedValue(new Error("boom"))} />);
    fillRequired();
    fireEvent.click(screen.getByRole("button", { name: "Criar Turma" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Não foi possível salvar a turma/);
  });

  // CA-16
  it("disables the button and shows the progress label while submitting", () => {
    const { rerender } = render(<ClassForm onSubmit={vi.fn()} isSubmitting />);
    const creating = screen.getByRole("button", { name: "Criando…" });
    expect((creating as HTMLButtonElement).disabled).toBe(true);
    rerender(<ClassForm onSubmit={vi.fn()} isSubmitting submitLabel="Salvar Alterações" submittingLabel="Salvando…" />);
    expect(screen.getByRole("button", { name: "Salvando…" })).toBeDefined();
  });

  it("renders Cancel as a link, not a button inside a link", () => {
    render(<ClassForm onSubmit={vi.fn()} cancelHref="/app/classes" />);
    const cancel = screen.getByRole("link", { name: "Cancelar" });
    expect(cancel.getAttribute("href")).toBe("/app/classes");
    expect(cancel.querySelector("button")).toBeNull();
  });

  // CA-17
  it("shows and sends the dates in local time, without shifting the day", async () => {
    const handleSubmit = vi.fn().mockResolvedValue(undefined);
    const start = new Date(2026, 7, 1).toISOString();
    const end = new Date(2026, 11, 1, 23, 59, 59).toISOString();
    render(
      <ClassForm
        onSubmit={handleSubmit}
        initialData={{ name: "Turma A", courseCode: "SO34E", semester: "2026/2", startDate: start, endDate: end }}
      />,
    );
    expect((screen.getByLabelText(/Data de Início/i) as HTMLInputElement).value).toBe("2026-08-01");
    expect((screen.getByLabelText(/Data de Término/i) as HTMLInputElement).value).toBe("2026-12-01");

    fireEvent.click(screen.getByRole("button", { name: "Criar Turma" }));
    await waitFor(() => expect(handleSubmit).toHaveBeenCalled());
    expect(handleSubmit.mock.calls[0][0].startDate).toBe(start);
    expect(handleSubmit.mock.calls[0][0].endDate).toBe(end);
  });
});
