import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionContent } from "@/services/scheduleService";
import { octoberCalendar } from "@/test/scheduleFixtures";
import { ClassCalendar, type ClassCalendarProps } from "./ClassCalendar";

afterEach(() => cleanup());

const today = new Date(2026, 9, 13);

function setup(overrides: Partial<ClassCalendarProps> = {}) {
  const props: ClassCalendarProps = {
    load: vi.fn().mockResolvedValue(octoberCalendar()),
    initialMonth: new Date(2026, 9, 1),
    today,
    ...overrides,
  };
  render(<ClassCalendar {...props} />);
  return props;
}

function dayButton(name: RegExp) {
  return screen.getByRole("button", { name });
}

// SPEC-042, section 3.1.2.
describe("ClassCalendar", () => {
  // CA-10
  it("shows the month with navigation, legend, milestones, holidays, sessions, events and periods", async () => {
    const props = setup();
    expect(await screen.findByRole("heading", { name: "outubro de 2026" })).toBeDefined();
    expect(props.load).toHaveBeenCalledWith("2026-09-27", "2026-10-31");
    expect(screen.getByRole("list", { name: "Legenda" })).toBeDefined();

    const first = dayButton(/^quinta-feira, 1 de outubro/);
    expect(first.getAttribute("aria-label")).toContain("início da turma");
    expect(dayButton(/^sábado, 31 de outubro/).getAttribute("aria-label")).toContain("término da turma");
    expect(dayButton(/^segunda-feira, 12 de outubro/).getAttribute("aria-label")).toContain("feriado: Nossa Senhora Aparecida");
    const nineteen = dayButton(/^segunda-feira, 19 de outubro/);
    expect(nineteen.getAttribute("aria-label")).toContain("1 aula cancelada");
    expect(within(nineteen).getByText("SO34E").closest("[data-status]")?.getAttribute("data-status")).toBe("CANCELED");
    expect(dayButton(/^quarta-feira, 21 de outubro/).getAttribute("aria-label")).toContain("online");
    expect(dayButton(/^quinta-feira, 22 de outubro/).getAttribute("aria-label")).toContain("evento: Palestra: o kernel");
    expect(dayButton(/^terça-feira, 27 de outubro/).getAttribute("aria-label")).toContain("Semana online");
    expect(dayButton(/^terça-feira, 13 de outubro/).getAttribute("aria-current")).toBe("date");

    fireEvent.click(screen.getByRole("button", { name: "Próximo mês" }));
    expect(await screen.findByRole("heading", { name: "novembro de 2026" })).toBeDefined();
    expect(props.load).toHaveBeenLastCalledWith("2026-11-01", "2026-12-05");
    fireEvent.click(screen.getByRole("button", { name: "Hoje" }));
    expect(await screen.findByRole("heading", { name: "outubro de 2026" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Mês anterior" }));
    expect(await screen.findByRole("heading", { name: "setembro de 2026" })).toBeDefined();
  });

  // CA-11
  it("shows the indicators of the month", async () => {
    setup();
    const indicators = await screen.findByRole("list", { name: "Indicadores do mês" });
    expect(within(indicators).getByText("Aulas no mês").parentElement?.textContent).toContain("5");
    expect(within(indicators).getByText("Feriados no mês").parentElement?.textContent).toContain("1");
    expect(within(indicators).getByText("Horas-aula por semana").parentElement?.textContent).toContain("4");
  });

  // CA-10: the day panel
  it("opens the panel of a day with its sessions, events and periods, and the actions of the teacher", async () => {
    const props = setup({ editable: true, onEditSession: vi.fn(), onAddSession: vi.fn(), onAddEvent: vi.fn(), onEditEvent: vi.fn(), onDeletePeriod: vi.fn() });
    fireEvent.click(await screen.findByRole("button", { name: /^segunda-feira, 19 de outubro/ }));
    const panel = screen.getByRole("region", { name: "segunda-feira, 19 de outubro de 2026" });
    expect(within(panel).getByText("Cancelada")).toBeDefined();
    expect(within(panel).getByText("Recesso")).toBeDefined();
    fireEvent.click(within(panel).getByRole("button", { name: "Alterar esta aula" }));
    expect(props.onEditSession).toHaveBeenCalledWith(expect.objectContaining({ id: "s-19" }));
    fireEvent.click(within(panel).getByRole("button", { name: "Incluir aula avulsa" }));
    expect(props.onAddSession).toHaveBeenCalledWith("2026-10-19");
    fireEvent.click(within(panel).getByRole("button", { name: "Incluir evento" }));
    expect(props.onAddEvent).toHaveBeenCalledWith("2026-10-19");

    fireEvent.click(screen.getByRole("button", { name: /^quinta-feira, 22 de outubro/ }));
    const eventPanel = screen.getByRole("region", { name: "quinta-feira, 22 de outubro de 2026" });
    expect(within(eventPanel).getByText("Palestra: o kernel")).toBeDefined();
    fireEvent.click(within(eventPanel).getByRole("button", { name: "Editar evento" }));
    expect(props.onEditEvent).toHaveBeenCalledWith(expect.objectContaining({ id: "e-1" }));

    fireEvent.click(screen.getByRole("button", { name: /^terça-feira, 27 de outubro/ }));
    fireEvent.click(within(screen.getByRole("region", { name: "terça-feira, 27 de outubro de 2026" })).getByRole("button", { name: "Desfazer período" }));
    expect(props.onDeletePeriod).toHaveBeenCalledWith(expect.objectContaining({ id: "p-1" }));
  });

  // CA-08, CA-20: the period selection by mouse and keyboard
  it("selects a period with two clicks and moves between days with the arrows", async () => {
    const onSelectPeriod = vi.fn();
    setup({ editable: true, onSelectPeriod });
    await screen.findByRole("heading", { name: "outubro de 2026" });
    fireEvent.click(screen.getByRole("button", { name: "Selecionar período" }));
    expect(screen.getByText("Escolha o primeiro dia do período.")).toBeDefined();
    fireEvent.click(dayButton(/^segunda-feira, 19 de outubro/));
    expect(screen.getByText("Escolha o último dia do período.")).toBeDefined();
    fireEvent.click(dayButton(/^sexta-feira, 23 de outubro/));
    expect(onSelectPeriod).toHaveBeenCalledWith("2026-10-19", "2026-10-23");
    expect(screen.queryByText("Escolha o último dia do período.")).toBeNull();

    const nineteen = dayButton(/^segunda-feira, 19 de outubro/);
    nineteen.focus();
    fireEvent.keyDown(nineteen, { key: "ArrowRight" });
    expect(document.activeElement).toBe(dayButton(/^terça-feira, 20 de outubro/));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(dayButton(/^terça-feira, 27 de outubro/));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(nineteen);

    fireEvent.click(screen.getByRole("button", { name: "Selecionar período" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar seleção" }));
    expect(screen.queryByText("Escolha o primeiro dia do período.")).toBeNull();
  });

  // CA-12
  it("is read-only for a student", async () => {
    setup({ editable: false });
    fireEvent.click(await screen.findByRole("button", { name: /^segunda-feira, 19 de outubro/ }));
    expect(screen.queryByRole("button", { name: "Alterar esta aula" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Incluir evento" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Selecionar período" })).toBeNull();
  });

  it("filters by class in the general calendar and links each class", async () => {
    const data = octoberCalendar();
    data.classes.push({ id: "c-2", name: "Redes", courseCode: "RC21", color: "blue", startDate: "2026-10-01", endDate: "2026-10-31" });
    data.sessions.push({ ...data.sessions[0]!, id: "s-r", classId: "c-2", date: "2026-10-15", meetingId: "m-9" });
    data.meetings.push({ id: "m-9", classId: "c-2", weekday: 4, startTime: "19:00", endTime: "22:30", lessonCount: 4, mode: "IN_PERSON" });
    setup({ load: vi.fn().mockResolvedValue(data), showClassFilter: true, classHref: (id) => `/app/classes/${id}?tab=schedule` });
    const filter = await screen.findByLabelText("Turma");
    expect(within(screen.getByRole("list", { name: "Indicadores do mês" })).getByText("Horas-aula por semana").parentElement?.textContent).toContain("8");
    fireEvent.change(filter, { target: { value: "c-2" } });
    expect(within(dayButton(/^quinta-feira, 15 de outubro/)).getByText("RC21")).toBeDefined();
    expect(within(dayButton(/^quarta-feira, 14 de outubro/)).queryByText("SO34E")).toBeNull();
    fireEvent.click(dayButton(/^quinta-feira, 15 de outubro/));
    expect(screen.getByRole("link", { name: "Abrir a agenda de Redes" }).getAttribute("href")).toBe("/app/classes/c-2?tab=schedule");
  });

  it("explains a class without meetings and an error, and tries again", async () => {
    const empty = { ...octoberCalendar(), sessions: [], meetings: [], events: [], periods: [] };
    setup({ load: vi.fn().mockResolvedValue(empty), editable: true, settingsHref: "/app/classes/c-1/settings" });
    expect(await screen.findByText("Esta turma ainda não tem encontros semanais.")).toBeDefined();
    expect(screen.getByRole("link", { name: "Cadastrar encontros" }).getAttribute("href")).toBe("/app/classes/c-1/settings");
    cleanup();

    const load = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(octoberCalendar());
    setup({ load });
    fireEvent.click(await screen.findByRole("button", { name: "Tentar de novo" }));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("heading", { name: "outubro de 2026" })).toBeDefined();
  });

  it("loads again when the reload key changes", async () => {
    const load = vi.fn().mockResolvedValue(octoberCalendar());
    const { rerender } = render(<ClassCalendar load={load} initialMonth={new Date(2026, 9, 1)} today={today} reloadKey={0} />);
    await screen.findByRole("heading", { name: "outubro de 2026" });
    rerender(<ClassCalendar load={load} initialMonth={new Date(2026, 9, 1)} today={today} reloadKey={1} />);
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  });

  // SPEC-044 CA-20: an action only shows when its handler is given
  it("hides the event and period actions when there is no handler for them", async () => {
    setup({ editable: true, onEditSession: vi.fn(), onAddSession: vi.fn() });
    fireEvent.click(await screen.findByRole("button", { name: /^segunda-feira, 19 de outubro/ }));
    const panel = screen.getByRole("region", { name: "segunda-feira, 19 de outubro de 2026" });
    expect(within(panel).getByRole("button", { name: "Incluir aula avulsa" })).toBeDefined();
    expect(within(panel).queryByRole("button", { name: "Incluir evento" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Selecionar período" })).toBeNull();
  });

  // SPEC-044 CA-21: the day of a holiday is marked, to be highlighted in red
  it("marks the cell of a holiday day", async () => {
    setup();
    expect((await screen.findByRole("button", { name: /^segunda-feira, 12 de outubro/ })).getAttribute("data-on-holiday")).toBe("true");
    expect(dayButton(/^terça-feira, 13 de outubro/).getAttribute("data-on-holiday")).toBeNull();
  });

  // SPEC-053, section 3.1: the content of each lesson
  describe("content of a lesson (SPEC-053)", () => {
    const content: SessionContent = {
      topic: "Permissões de arquivos",
      description: "<p>Veremos <strong>chmod</strong>.</p>",
      module: { id: "m-1", title: "Linux na prática" },
      deck: { id: "d-1", title: "Slides 1", pageCount: 12, downloadUrl: "https://minio/d-1.pdf" },
      links: [{ name: "Meet", url: "https://meet.google.com/abc", position: 0 }],
    };
    const withContent = () => {
      const data = octoberCalendar();
      data.sessions = data.sessions.map((x) => (x.id === "s-26" ? { ...x, topic: "Permissões de arquivos", hasContent: true } : x));
      return data;
    };
    const monday26 = () => dayButton(/^segunda-feira, 26 de outubro/);

    // CA-10
    it("shows the topic in the mark of the day, in place of the code of the course", async () => {
      setup({ load: vi.fn().mockResolvedValue(withContent()) });
      await screen.findByRole("heading", { name: "outubro de 2026" });
      expect(within(monday26()).getByText("Permissões de arquivos")).toBeDefined();
      expect(within(monday26()).queryByText("SO34E")).toBeNull();
      expect(within(dayButton(/^quarta-feira, 28 de outubro/)).getByText("SO34E")).toBeDefined();
    });

    // CA-10
    it("shows the content to whoever reads the lesson: topic, description, links, module and presentation", async () => {
      const loadContent = vi.fn().mockResolvedValue(content);
      setup({ load: vi.fn().mockResolvedValue(withContent()), loadContent });
      await screen.findByRole("heading", { name: "outubro de 2026" });
      fireEvent.click(monday26());
      const panel = screen.getByRole("region", { name: "segunda-feira, 26 de outubro de 2026" });
      expect(await within(panel).findByText(/Veremos/)).toBeDefined();
      expect(loadContent).toHaveBeenCalledWith(expect.objectContaining({ id: "s-26" }));
      expect(within(panel).getByText("chmod")).toBeDefined();
      expect(within(panel).getByRole("heading", { level: 4, name: "Permissões de arquivos" })).toBeDefined();
      const meet = within(panel).getByRole("link", { name: "Meet" });
      expect(meet.getAttribute("href")).toBe("https://meet.google.com/abc");
      expect(meet.getAttribute("target")).toBe("_blank");
      expect(meet.getAttribute("rel")).toBe("noopener noreferrer");
      expect(within(panel).getByRole("link", { name: "Linux na prática" }).getAttribute("href")).toBe("/app/modules/m-1");
      const deck = within(panel).getByRole("link", { name: "Ver apresentação" });
      expect(deck.getAttribute("href")).toBe("https://minio/d-1.pdf");
      expect(deck.getAttribute("rel")).toBe("noopener noreferrer");
      expect(within(panel).queryByRole("button", { name: "Conteúdo da aula" })).toBeNull();
      expect(within(panel).queryByRole("button", { name: "Iniciar aula ao vivo" })).toBeNull();
    });

    it("does not load the content of a lesson that has none", async () => {
      const loadContent = vi.fn();
      setup({ loadContent });
      fireEvent.click(await screen.findByRole("button", { name: /^segunda-feira, 19 de outubro/ }));
      expect(loadContent).not.toHaveBeenCalled();
    });

    it("tells when the content cannot be loaded", async () => {
      setup({ load: vi.fn().mockResolvedValue(withContent()), loadContent: vi.fn().mockRejectedValue(new Error("down")) });
      fireEvent.click(await screen.findByRole("button", { name: /^segunda-feira, 26 de outubro/ }));
      expect(await screen.findByText("Não foi possível carregar o conteúdo da aula.")).toBeDefined();
    });

    // CA-09 and CA-11
    it("gives the teacher the buttons Conteúdo da aula and Iniciar aula ao vivo, tied to the lesson", async () => {
      const onEditContent = vi.fn();
      const onStartLive = vi.fn();
      setup({ editable: true, onEditSession: vi.fn(), onEditContent, onStartLive });
      fireEvent.click(await screen.findByRole("button", { name: /^segunda-feira, 19 de outubro/ }));
      const panel = screen.getByRole("region", { name: "segunda-feira, 19 de outubro de 2026" });
      fireEvent.click(within(panel).getByRole("button", { name: "Conteúdo da aula" }));
      expect(onEditContent).toHaveBeenCalledWith(expect.objectContaining({ id: "s-19" }));
      fireEvent.click(screen.getByRole("button", { name: /^quarta-feira, 21 de outubro/ }));
      fireEvent.click(within(screen.getByRole("region", { name: "quarta-feira, 21 de outubro de 2026" })).getByRole("button", { name: "Iniciar aula ao vivo" }));
      expect(onStartLive).toHaveBeenCalledWith(expect.objectContaining({ id: "s-21" }), "Sistemas Operacionais");
    });

    it("does not offer to start a live class for a canceled lesson, but still lets the content be edited", async () => {
      setup({ editable: true, onEditContent: vi.fn(), onStartLive: vi.fn() });
      fireEvent.click(await screen.findByRole("button", { name: /^segunda-feira, 19 de outubro/ }));
      const panel = screen.getByRole("region", { name: "segunda-feira, 19 de outubro de 2026" });
      expect(within(panel).getByText("Cancelada")).toBeDefined();
      expect(within(panel).queryByRole("button", { name: "Iniciar aula ao vivo" })).toBeNull();
      expect(within(panel).getByRole("button", { name: "Conteúdo da aula" })).toBeDefined();
    });

    it("hides each button when its action is not given or the calendar is read-only", async () => {
      setup({ editable: true, onEditContent: vi.fn() });
      fireEvent.click(await screen.findByRole("button", { name: /^quarta-feira, 21 de outubro/ }));
      const panel = screen.getByRole("region", { name: "quarta-feira, 21 de outubro de 2026" });
      expect(within(panel).getByRole("button", { name: "Conteúdo da aula" })).toBeDefined();
      expect(within(panel).queryByRole("button", { name: "Iniciar aula ao vivo" })).toBeNull();
      cleanup();
      setup({ editable: false, onEditContent: vi.fn(), onStartLive: vi.fn() });
      fireEvent.click(await screen.findByRole("button", { name: /^quarta-feira, 21 de outubro/ }));
      expect(screen.queryByRole("button", { name: "Conteúdo da aula" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Iniciar aula ao vivo" })).toBeNull();
    });
  });
});
