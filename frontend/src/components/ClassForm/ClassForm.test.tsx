import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiProblemError } from "@/services/httpClient";
import { scheduleService } from "@/services/scheduleService";
import { octoberCalendar } from "@/test/scheduleFixtures";
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
    expect(handleSubmit.mock.lastCall?.[0].summary).toBe("Linux na prática");
  });

  // CA-11
  it("edits the syllabus and the guidelines in the formatted editor, without the image button", () => {
    render(<ClassForm onSubmit={vi.fn()} initialData={{ syllabus: "<p>Processos</p>" }} />);
    fireEvent.click(screen.getByRole("tab", { name: "Conteúdo" }));
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
    expect(handleSubmit.mock.lastCall?.[0].startDate).toBe(start);
    expect(handleSubmit.mock.lastCall?.[0].endDate).toBe(end);
  });
});

describe("ClassForm (SPEC-041, coverage of the remaining paths)", () => {
  it("requires both invite dates and their order when the invite link is on", async () => {
    render(<ClassForm onSubmit={vi.fn()} />);
    fillRequired();
    fireEvent.click(screen.getByLabelText(/Habilitar Link de Ingresso/i));
    fireEvent.click(screen.getByRole("button", { name: "Criar Turma" }));
    const start = screen.getByLabelText(/Início da Validade do Link/i);
    await waitFor(() => expect(start.getAttribute("aria-invalid")).toBe("true"));
    expect(document.activeElement).toBe(start);

    fireEvent.change(start, { target: { value: "2026-10-20T10:00" } });
    fireEvent.change(screen.getByLabelText(/Fim da Validade do Link/i), { target: { value: "2026-10-10T10:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar Turma" }));
    expect(await screen.findByText(/abertura do link deve ser anterior/)).toBeDefined();
  });

  it("sends the schedule, the virtual meetings and the invite window", async () => {
    const handleSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ClassForm onSubmit={handleSubmit} />);
    fillRequired();
    fireEvent.change(screen.getByLabelText(/Horários dos Encontros/i), { target: { value: "Seg 08:20" } });
    fireEvent.click(screen.getByLabelText(/Encontros Virtuais/i));
    fireEvent.click(screen.getByLabelText(/Habilitar Link de Ingresso/i));
    fireEvent.change(screen.getByLabelText(/Início da Validade do Link/i), { target: { value: "2026-10-01T08:00" } });
    fireEvent.change(screen.getByLabelText(/Fim da Validade do Link/i), { target: { value: "2026-10-20T18:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar Turma" }));
    await waitFor(() => expect(handleSubmit).toHaveBeenCalled());
    const payload = handleSubmit.mock.lastCall?.[0];
    expect(payload.scheduleDescription).toBe("Seg 08:20");
    expect(payload.enableVirtualClassroom).toBe(true);
    expect(payload.inviteLinkStart).toBe(new Date(2026, 9, 1, 8, 0).toISOString());
    expect(payload.inviteLinkEnd).toBe(new Date(2026, 9, 20, 18, 0).toISOString());
  });

  it("shows the invite window of a class being edited in local time", () => {
    render(
      <ClassForm
        onSubmit={vi.fn()}
        initialData={{
          enableInviteLink: true,
          inviteLinkStart: new Date(2026, 9, 1, 8, 5).toISOString(),
          inviteLinkEnd: "not a date",
        }}
      />,
    );
    expect((screen.getByLabelText(/Início da Validade do Link/i) as HTMLInputElement).value).toBe("2026-10-01T08:05");
    expect((screen.getByLabelText(/Fim da Validade do Link/i) as HTMLInputElement).value).toBe("");
  });

  it.each([
    ["class-conflict", {}, /Código da Disciplina/i, /já tem uma turma/],
    ["invalid-date-range", {}, /Data de Término/i, /data de início deve ser anterior/],
    ["content-too-long", { field: "syllabus" }, null, /limite é de 20.000/],
  ])("puts the %s problem of the server next to its field", async (type, extra, label, text) => {
    const problem = new ApiProblemError({ type, status: 400, ...extra }, 400);
    render(<ClassForm onSubmit={vi.fn().mockRejectedValue(problem)} />);
    fillRequired();
    fireEvent.click(screen.getByRole("button", { name: "Criar Turma" }));
    expect(await screen.findByText(text)).toBeDefined();
    if (label) expect(screen.getByLabelText(label).getAttribute("aria-invalid")).toBe("true");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it.each([
    ["content-too-long", { field: "other" }, /limite é de 20.000/],
    ["unknown-problem", {}, /Não foi possível salvar a turma/],
    // With the invite link off its date fields are not on screen.
    ["invite-link-dates-required", {}, /Informe a abertura/],
    ["invalid-invite-range", {}, /abertura do link deve ser anterior/],
  ])("shows the %s problem without a field at the top", async (type, extra, text) => {
    const problem = new ApiProblemError({ type, status: 400, ...extra }, 400);
    render(<ClassForm onSubmit={vi.fn().mockRejectedValue(problem)} />);
    fillRequired();
    fireEvent.click(screen.getByRole("button", { name: "Criar Turma" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(text);
  });
});

describe("ClassForm (SPEC-042)", () => {
  // RN-12
  it("chooses the color of the class", async () => {
    const handleSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ClassForm onSubmit={handleSubmit} initialData={{ color: "blue" }} />);
    expect(screen.getByRole("radiogroup", { name: "Cor da turma" })).toBeDefined();
    expect((screen.getByRole("radio", { name: "Azul" }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "Verde" }));
    fillRequired();
    fireEvent.click(screen.getByRole("button", { name: "Criar Turma" }));
    await waitFor(() => expect(handleSubmit).toHaveBeenCalled());
    expect(handleSubmit.mock.lastCall?.[0].color).toBe("green");
  });

  // RN-01, D-13 and CA-02
  it("edits the weekly meetings, hides the old schedule text once there are meetings and sends them", async () => {
    const handleSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ClassForm onSubmit={handleSubmit} initialData={{ scheduleDescription: "Seg 08:20" }} />);
    fireEvent.click(screen.getByRole("tab", { name: "Horários" }));
    expect(screen.getByLabelText(/Horários dos Encontros/i)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Segunda-feira" }));
    expect(screen.queryByLabelText(/Horários dos Encontros/i)).toBeNull();
    fillRequired();
    fireEvent.click(screen.getByRole("button", { name: "Criar Turma" }));
    await waitFor(() => expect(handleSubmit).toHaveBeenCalled());
    expect(handleSubmit.mock.lastCall?.[1]).toEqual([
      { weekday: 1, startTime: "08:20", endTime: "10:20", lessonCount: 2, mode: "IN_PERSON", room: undefined, onlineUrl: undefined },
    ]);
  });

  it("starts from the saved meetings and blocks an invalid one", async () => {
    const handleSubmit = vi.fn();
    render(
      <ClassForm
        onSubmit={handleSubmit}
        initialMeetings={[{ id: "m-1", weekday: 3, startTime: "13:50", endTime: "15:30", lessonCount: 2, mode: "ONLINE", onlineUrl: "x" }]}
      />,
    );
    expect((screen.getByLabelText("Início (Quarta-feira)") as HTMLInputElement).value).toBe("13:50");
    fillRequired();
    fireEvent.click(screen.getByRole("button", { name: "Criar Turma" }));
    expect(await screen.findByText("Informe um link https.")).toBeDefined();
    expect(handleSubmit).not.toHaveBeenCalled();
  });
});

function tab(name: string) {
  return screen.getByRole("tab", { name });
}

describe("ClassForm (SPEC-044)", () => {
  // CA-01
  it("shows the four tabs and opens on Informações", () => {
    render(<ClassForm onSubmit={vi.fn()} />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent?.trim())).toEqual([
      "Informações",
      "Horários",
      "Conteúdo",
      "Ingresso",
    ]);
    expect(tab("Informações").getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel", { name: "Informações" })).toBeDefined();
    expect(screen.getByLabelText(/Nome da Turma/i)).toBeDefined();
  });

  // CA-02
  it("shows only the panel of the selected tab and keeps what was typed in the others", () => {
    render(<ClassForm onSubmit={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/Nome da Turma/i), { target: { value: "Turma A" } });
    fireEvent.click(tab("Horários"));
    expect(tab("Horários").getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel", { name: "Horários" })).toBeDefined();
    expect(screen.queryByRole("tabpanel", { name: "Informações" })).toBeNull();
    fireEvent.click(tab("Informações"));
    expect((screen.getByLabelText(/Nome da Turma/i) as HTMLInputElement).value).toBe("Turma A");
  });

  // CA-03
  it("follows the WAI-ARIA tabs pattern with arrows, Home and End", () => {
    render(<ClassForm onSubmit={vi.fn()} />);
    expect(screen.getByRole("tablist")).toBeDefined();
    const first = tab("Informações");
    expect(first.getAttribute("aria-controls")).toBe(screen.getByRole("tabpanel").id);
    expect(first.getAttribute("tabindex")).toBe("0");
    expect(tab("Horários").getAttribute("tabindex")).toBe("-1");

    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(tab("Horários").getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tab("Horários"));
    fireEvent.keyDown(tab("Horários"), { key: "End" });
    expect(tab("Ingresso").getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(tab("Ingresso"), { key: "ArrowLeft" });
    expect(tab("Conteúdo").getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(tab("Conteúdo"), { key: "Home" });
    expect(tab("Informações").getAttribute("aria-selected")).toBe("true");
  });

  // CA-04
  it("opens the tab of the first invalid field, focuses it and marks every tab with a problem", async () => {
    const handleSubmit = vi.fn();
    render(<ClassForm onSubmit={handleSubmit} />);
    fireEvent.click(tab("Ingresso"));
    fireEvent.click(screen.getByRole("button", { name: "Criar Turma" }));
    const name = screen.getByLabelText(/Nome da Turma/i);
    await waitFor(() => expect(tab("Informações").getAttribute("aria-selected")).toBe("true"));
    expect(document.activeElement).toBe(name);
    expect(tab("Informações").getAttribute("data-invalid")).toBe("true");
    expect(tab("Horários").getAttribute("data-invalid")).not.toBe("true");
    expect(handleSubmit).not.toHaveBeenCalled();
  });

  // CA-04
  it("opens the Horários tab when a meeting is invalid", async () => {
    render(
      <ClassForm
        onSubmit={vi.fn()}
        initialMeetings={[{ id: "m-1", weekday: 3, startTime: "13:50", endTime: "15:30", lessonCount: 2, mode: "ONLINE", onlineUrl: "x" }]}
      />,
    );
    fillRequired();
    fireEvent.click(screen.getByRole("button", { name: "Criar Turma" }));
    await waitFor(() => expect(tab("Horários").getAttribute("aria-selected")).toBe("true"));
    expect(tab("Horários").getAttribute("data-invalid")).toBe("true");
    expect(screen.getByText("Informe um link https.")).toBeDefined();
  });

  // CA-04
  it("opens the Ingresso tab when the invite dates are missing", async () => {
    render(<ClassForm onSubmit={vi.fn()} />);
    fillRequired();
    fireEvent.click(screen.getByLabelText(/Habilitar Link de Ingresso/i));
    fireEvent.click(tab("Horários"));
    fireEvent.click(screen.getByRole("button", { name: "Criar Turma" }));
    await waitFor(() => expect(tab("Ingresso").getAttribute("aria-selected")).toBe("true"));
    expect(document.activeElement).toBe(screen.getByLabelText(/Início da Validade do Link/i));
  });

  // CA-05
  it("opens the Informações tab for a problem of the server about the course code", async () => {
    const problem = new ApiProblemError({ type: "class-conflict", status: 409 }, 409);
    render(<ClassForm onSubmit={vi.fn().mockRejectedValue(problem)} />);
    fillRequired();
    fireEvent.click(tab("Horários"));
    fireEvent.click(screen.getByRole("button", { name: "Criar Turma" }));
    await waitFor(() => expect(tab("Informações").getAttribute("aria-selected")).toBe("true"));
    expect(screen.getByLabelText(/Código da Disciplina/i).getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(screen.getByLabelText(/Código da Disciplina/i));
  });

  // CA-06
  it("sends the data of all the tabs in a single call", async () => {
    const handleSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ClassForm onSubmit={handleSubmit} />);
    fillRequired();
    fireEvent.change(screen.getByLabelText(/Resumo da disciplina/i), { target: { value: "Resumo" } });
    fireEvent.click(tab("Horários"));
    fireEvent.click(screen.getByRole("button", { name: "Segunda-feira" }));
    fireEvent.click(tab("Ingresso"));
    fireEvent.click(screen.getByLabelText(/Habilitar Link de Ingresso/i));
    fireEvent.change(screen.getByLabelText(/Início da Validade do Link/i), { target: { value: "2026-10-10T10:00" } });
    fireEvent.change(screen.getByLabelText(/Fim da Validade do Link/i), { target: { value: "2026-10-20T10:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar Turma" }));
    await waitFor(() => expect(handleSubmit).toHaveBeenCalledTimes(1));
    const [payload, meetings] = handleSubmit.mock.lastCall ?? [];
    expect(payload.name).toBe("Turma A");
    expect(payload.summary).toBe("Resumo");
    expect(payload.enableInviteLink).toBe(true);
    expect(meetings).toHaveLength(1);
  });

  // CA-09 and CA-10
  it("previews the lessons of the week in the calendar of the term, updating without saving", () => {
    const onSubmit = vi.fn();
    const { container } = render(<ClassForm onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText(/Data de Início/i), { target: { value: "2026-10-05" } });
    fireEvent.change(screen.getByLabelText(/Data de Término/i), { target: { value: "2026-10-31" } });
    fireEvent.click(tab("Horários"));
    const dates = () =>
      Array.from(container.querySelectorAll("[data-marker]")).map((m) => m.closest("[data-date]")?.getAttribute("data-date"));
    expect(screen.getByText(/Marque os dias da semana/)).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Segunda-feira" }));
    expect(dates()).toEqual(["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"]);

    fireEvent.click(screen.getByRole("button", { name: "Quarta-feira" }));
    expect(dates()).toHaveLength(8);

    fireEvent.change(screen.getByLabelText(/Data de Término/i), { target: { value: "2026-10-14" } });
    expect(dates()).toEqual(["2026-10-05", "2026-10-07", "2026-10-12", "2026-10-14"]);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  // CA-12
  it("asks for the dates in the preview while the term is not filled in", () => {
    render(<ClassForm onSubmit={vi.fn()} />);
    fireEvent.click(tab("Horários"));
    expect(screen.getByText(/Informe as datas de início e fim da turma/)).toBeDefined();
  });

  // CA-16, CA-19 and CA-22
  it("on a saved class shows one calendar and applies the valid meetings by itself", async () => {
    const calendar = vi.spyOn(scheduleService, "classCalendar").mockResolvedValue(octoberCalendar());
    const onApplyMeetings = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      <ClassForm
        onSubmit={vi.fn()}
        classId="c-1"
        onApplyMeetings={onApplyMeetings}
        initialData={{ startDate: "2026-10-01T03:00:00Z", endDate: "2026-10-31T23:59:59Z" }}
      />,
    );
    fireEvent.click(tab("Horários"));
    expect(await screen.findByRole("heading", { name: "outubro de 2026" })).toBeDefined();
    expect(screen.queryByRole("region", { name: /Prévia/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Aplicar horários ao calendário" })).toBeNull();
    expect(container.querySelector("[data-marker]")).toBeNull();
    expect(onApplyMeetings).not.toHaveBeenCalled();

    const before = calendar.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Terça-feira" }));
    await waitFor(() => expect(onApplyMeetings).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(onApplyMeetings.mock.lastCall?.[0]).toEqual([expect.objectContaining({ weekday: 2, startTime: "08:20", endTime: "10:20" })]);
    await waitFor(() => expect(calendar.mock.calls.length).toBeGreaterThan(before));
    expect(await screen.findByText("Horários aplicados ao calendário.")).toBeDefined();
  });

  // CA-19
  it("does not apply an invalid meeting", async () => {
    vi.spyOn(scheduleService, "classCalendar").mockResolvedValue(octoberCalendar());
    const onApplyMeetings = vi.fn().mockResolvedValue(undefined);
    render(
      <ClassForm
        onSubmit={vi.fn()}
        classId="c-1"
        onApplyMeetings={onApplyMeetings}
        initialData={{ startDate: "2026-10-01T03:00:00Z", endDate: "2026-10-31T23:59:59Z" }}
      />,
    );
    fireEvent.click(tab("Horários"));
    fireEvent.click(screen.getByRole("button", { name: "Quarta-feira" }));
    await waitFor(() => expect(onApplyMeetings).toHaveBeenCalledTimes(1), { timeout: 3000 });
    fireEvent.change(screen.getByLabelText("Modalidade (Quarta-feira)"), { target: { value: "ONLINE" } });
    await new Promise((r) => setTimeout(r, 1200));
    expect(onApplyMeetings).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Informe um link https.")).toBeDefined();
  });

  // CA-16
  it("on a new class shows no apply button", () => {
    render(<ClassForm onSubmit={vi.fn()} />);
    fireEvent.click(tab("Horários"));
    expect(screen.queryByRole("button", { name: "Aplicar horários ao calendário" })).toBeNull();
  });

  // CA-15
  it("on a new class loads the holidays of the term and shows them in the preview", async () => {
    const loadHolidays = vi.fn().mockResolvedValue([{ id: "h-1", date: "2026-10-12", name: "Nossa Senhora Aparecida", scope: "NATIONAL", active: true }]);
    const { container } = render(<ClassForm onSubmit={vi.fn()} loadHolidays={loadHolidays} />);
    fireEvent.change(screen.getByLabelText(/Data de Início/i), { target: { value: "2026-10-05" } });
    fireEvent.change(screen.getByLabelText(/Data de Término/i), { target: { value: "2026-10-31" } });
    fireEvent.click(tab("Horários"));
    fireEvent.click(screen.getByRole("button", { name: "Segunda-feira" }));
    await waitFor(() => expect(container.querySelector('[data-date="2026-10-12"] [data-holiday]')).not.toBeNull());
    expect(loadHolidays).toHaveBeenCalledWith(2026);
  });

  // CA-23: a dot of each color, without the name written
  it("shows a dot for each color, with no color name written, keeping the names for assistive technology", () => {
    const { container } = render(<ClassForm onSubmit={vi.fn()} initialData={{ color: "blue" }} />);
    expect(screen.queryByText("Azul")).toBeNull();
    expect(screen.queryByText("Laranja")).toBeNull();
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(8);
    const blue = screen.getByRole("radio", { name: "Azul" }) as HTMLInputElement;
    expect(blue.checked).toBe(true);
    expect(blue.closest("label")?.getAttribute("title")).toBe("Azul");
    const dots = Array.from(container.querySelectorAll("[data-color]")).map((d) => d.getAttribute("data-color"));
    expect(dots).toEqual(["orange", "blue", "green", "purple", "pink", "teal", "yellow", "red"]);
  });
});
