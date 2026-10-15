import { readFileSync } from "node:fs";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLiveClassroom } from "@/hooks/useLiveClassroom";
import { classroomService, type LiveModuleContent, type LiveSession } from "@/services/classroomService";
import { moduleService } from "@/services/moduleService";
import { TeacherPanel } from "./TeacherPanel";

const styleOf = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const css = styleOf("./TeacherPanel.module.scss");

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/hooks/useLiveClassroom", () => ({ useLiveClassroom: vi.fn() }));
vi.mock("@/services/moduleService", () => ({ moduleService: { listModules: vi.fn() } }));
vi.mock("../SlideThumbnails/SlideThumbnails", async () => {
  const React = await import("react");
  type P = { current: number; onSelect(n: number): void };
  return {
    SlideThumbnails: (p: P) =>
      React.createElement("div", { "data-testid": "thumbs", "data-current": p.current }, React.createElement("button", { onClick: () => p.onSelect(4) }, "mock-thumb-4")),
  };
});

const session: LiveSession = { id: "s-1", classId: "c-1", title: "Permissões", status: "ACTIVE", displayMode: "SLIDES", currentSlide: 1, startedAt: "2026-10-14T10:00:00Z" };
const deck = { id: "d", title: "t", pageCount: 5, downloadUrl: "https://x" };
const module_: LiveModuleContent = {
  moduleId: "m-1",
  title: "Permissões de arquivos",
  scenario: {},
  blocks: [
    { id: "b-1", type: "TEXT", position: 0, payload: { html: "Primeiro" } },
    { id: "b-2", type: "COMMAND", position: 1, payload: { steps: [] } },
  ],
};

const actions = () => ({
  changeSlide: vi.fn(), switchMode: vi.fn(), moderate: vi.fn(), acceptStudent: vi.fn(), acceptAll: vi.fn(), removeStudent: vi.fn(), focusBlock: vi.fn(),
  raiseHand: vi.fn(), lowerHand: vi.fn(), sendChat: vi.fn(() => true), selectDeck: vi.fn(),
});

function live(over: Record<string, unknown> = {}, room: Record<string, unknown> = {}) {
  const value = {
    room: { mode: "SLIDES", slide: 2, moduleId: null, moduleFocusBlockId: null, deck, strokes: [], cursor: null, online: 5, blank: false, ...room },
    admissions: { waiting: [], admitted: [] },
    onlineStudents: [],
    hands: [],
    chat: [],
    startedAt: "2026-10-14T10:00:00Z",
    presenterConnected: false,
    ready: true,
    ended: false,
    passive: false,
    connected: true,
    canControl: true,
    ...actions(),
    ...over,
  };
  vi.mocked(useLiveClassroom).mockReturnValue(value as never);
  return value as ReturnType<typeof actions> & typeof value;
}

const props = () => ({ classId: "c-1", session, beep: vi.fn() });

beforeEach(() => {
  push.mockClear();
  localStorage.clear();
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(new Date("2026-10-14T11:05:30Z"));
  vi.mocked(moduleService.listModules).mockResolvedValue({ items: [{ id: "m-1", title: "Permissões de arquivos" }, { id: "m-2", title: "Processos" }], total: 2, page: 1, limit: 100 } as never);
  vi.spyOn(classroomService, "getLiveModule").mockResolvedValue(module_);
  vi.spyOn(classroomService, "listDecks").mockResolvedValue([{ id: "d-2", title: "Esquema", pageCount: 1, kind: "IMAGE", createdAt: "2026-10-15T10:00:00Z" }]);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const flush = () => act(async () => void (await Promise.resolve()));

// SPEC-055 CA-01: the panel of the teacher
describe("TeacherPanel", () => {
  it("connects as the panel of the teacher", () => {
    live();
    render(<TeacherPanel {...props()} />);
    expect(vi.mocked(useLiveClassroom).mock.calls[0]![0]).toMatchObject({ classId: "c-1", role: "teacher", view: "panel" });
  });

  it("shows the title, the time of the class since the start, and the summary", async () => {
    live({ admissions: { waiting: [{ studentId: "u-1", name: "Ana" }], admitted: [{ studentId: "u-2", name: "Bruno" }, { studentId: "u-3", name: "Carla" }] }, hands: [{ studentId: "u-2", name: "Bruno", requestedAt: "x" }], presenterConnected: true });
    render(<TeacherPanel {...props()} />);
    await flush();
    expect(screen.getByRole("heading", { level: 1, name: "Permissões" })).toBeDefined();
    expect(screen.getByRole("timer", { name: "Tempo de aula" }).textContent).toBe("1:05:30");
    const summary = within(screen.getByRole("region", { name: "Resumo da aula" }));
    expect(summary.getByText("Na aula").nextElementSibling?.textContent).toBe("2");
    expect(summary.getByText("Esperando").nextElementSibling?.textContent).toBe("1");
    expect(summary.getByText("Pediram a palavra").nextElementSibling?.textContent).toBe("1");
    expect(summary.getByText("Janela de apresentação").nextElementSibling?.textContent).toBe("Conectada");
  });

  it("keeps the time going while the class is on", async () => {
    live();
    render(<TeacherPanel {...props()} />);
    await flush();
    act(() => void vi.advanceTimersByTime(30_000));
    expect(screen.getByRole("timer", { name: "Tempo de aula" }).textContent).toBe("1:06:00");
  });

  it("tells the presenter window is closed", async () => {
    live({ presenterConnected: false });
    render(<TeacherPanel {...props()} />);
    await flush();
    expect(within(screen.getByRole("region", { name: "Resumo da aula" })).getByText("Fechada")).toBeDefined();
  });

  // CA-14: the three steps, the next one on top
  describe("the steps", () => {
    const steps = () => within(screen.getByRole("list", { name: "Passo a passo da aula" }));
    const item = (name: RegExp) => steps().getByText(name).closest("li")!;

    it("starts with the presentation window as the next step", async () => {
      live();
      render(<TeacherPanel {...props()} />);
      await flush();
      expect(steps().getAllByRole("listitem")).toHaveLength(3);
      expect(item(/Abrir a janela de apresentação/).getAttribute("aria-current")).toBe("step");
      expect(item(/Abrir a janela de apresentação/).textContent).toContain("Próximo passo");
      expect(item(/Aceitar os alunos/).getAttribute("aria-current")).toBeNull();
      expect(item(/Apresentar/).getAttribute("aria-current")).toBeNull();
    });

    it("marks the window as done when it connects, and moves to the students who wait", async () => {
      live({ presenterConnected: true, admissions: { waiting: [{ studentId: "u-1", name: "Ana" }, { studentId: "u-4", name: "Davi" }], admitted: [] } });
      render(<TeacherPanel {...props()} />);
      await flush();
      expect(item(/Abrir a janela de apresentação/).textContent).toContain("Feito");
      expect(item(/Aceitar os alunos/).getAttribute("aria-current")).toBe("step");
      expect(item(/Aceitar os alunos/).textContent).toContain("2 alunos esperando");
    });

    it("accepts all who wait from the step", async () => {
      const l = live({ presenterConnected: true, admissions: { waiting: [{ studentId: "u-1", name: "Ana" }], admitted: [] } });
      render(<TeacherPanel {...props()} />);
      await flush();
      fireEvent.click(within(item(/Aceitar os alunos/)).getByRole("button", { name: "Aceitar o aluno que espera" }));
      expect(l.acceptAll).toHaveBeenCalledTimes(1);
    });

    it("leaves Present as the next step when the window is open and nobody waits, and shows what is on the stage", async () => {
      live({ presenterConnected: true });
      render(<TeacherPanel {...props()} />);
      await flush();
      expect(item(/Aceitar os alunos/).textContent).toContain("Feito");
      expect(item(/Apresentar/).getAttribute("aria-current")).toBe("step");
      expect(item(/Apresentar/).textContent).toContain("Lâmina 2 de 5 na tela");
    });
  });

  // CA-02
  describe("the presentation window", () => {
    it("opens it in another window of the browser, and brings it to the front when it is already open", async () => {
      live();
      const popup = { closed: false, focus: vi.fn() };
      const open = vi.spyOn(window, "open").mockReturnValue(popup as never);
      render(<TeacherPanel {...props()} />);
      await flush();
      fireEvent.click(screen.getByRole("button", { name: "Abrir janela de apresentação" }));
      expect(open).toHaveBeenCalledTimes(1);
      expect(open.mock.calls[0]![0]).toBe(`${window.location.origin}/app/classes/c-1/live/present`);
      fireEvent.click(screen.getByRole("button", { name: "Abrir janela de apresentação" }));
      expect(open).toHaveBeenCalledTimes(1);
      expect(popup.focus).toHaveBeenCalledTimes(1);
      popup.closed = true;
      fireEvent.click(screen.getByRole("button", { name: "Abrir janela de apresentação" }));
      expect(open).toHaveBeenCalledTimes(2);
    });

    it("shows the address when the browser blocks the window", async () => {
      live();
      vi.spyOn(window, "open").mockReturnValue(null);
      render(<TeacherPanel {...props()} />);
      await flush();
      fireEvent.click(screen.getByRole("button", { name: "Abrir janela de apresentação" }));
      expect(screen.getByRole("alert").textContent).toContain(`${window.location.origin}/app/classes/c-1/live/present`);
    });

    // CA-09 and the plain-words errors
    it("tells, with the way to fix it, that the window was closed after it had been open", async () => {
      live({ presenterConnected: true });
      const view = render(<TeacherPanel {...props()} />);
      await flush();
      expect(screen.queryByText("A janela de apresentação foi fechada.")).toBeNull();
      live({ presenterConnected: false });
      view.rerender(<TeacherPanel {...props()} />);
      expect(screen.getByText("A janela de apresentação foi fechada.")).toBeDefined();
      const open = vi.spyOn(window, "open").mockReturnValue({ closed: false, focus: vi.fn() } as never);
      fireEvent.click(screen.getByRole("button", { name: "Abrir de novo" }));
      expect(open).toHaveBeenCalledTimes(1);
    });

    // SPEC-070 CA-08: with no presenter window the class sees the waiting screen, and the panel says so, from the start and after a close
    it("says that the class sees the waiting screen while the window is not connected, and takes it off when it connects", async () => {
      live({ presenterConnected: false });
      const view = render(<TeacherPanel {...props()} />);
      await flush();
      const notice = "Sem a janela de apresentação, a turma vê a tela de espera. Abra a janela de apresentação para continuar a aula.";
      expect(screen.getByText(notice)).toBeDefined(); // before the window was ever opened
      expect(screen.getByRole("button", { name: "Abrir janela de apresentação" })).toBeDefined();

      live({ presenterConnected: true });
      view.rerender(<TeacherPanel {...props()} />);
      expect(screen.queryByText(notice)).toBeNull();

      live({ presenterConnected: false });
      view.rerender(<TeacherPanel {...props()} />);
      expect(screen.getByText(notice)).toBeDefined();
      expect(screen.getByRole("button", { name: "Abrir de novo" })).toBeDefined();
    });
  });

  // SPEC-068: the files of the class, with the class going on, and the choice of what is on the stage
  it("gives the files of the class, and projects one on the stage of the room", async () => {
    const l = live();
    render(<TeacherPanel {...props()} />);
    await flush();
    expect(screen.getByRole("region", { name: "Arquivos da aula" })).toBeDefined();
    fireEvent.click(await screen.findByRole("button", { name: "Projetar Esquema" }));
    expect(l.selectDeck).toHaveBeenCalledWith("d-2");
  });

  // CA-03: the waiting room, with the accept-all button on top (CA-19)
  it("gives the waiting room to accept, accept all, decline and remove, and the hands to lower", async () => {
    const l = live({
      admissions: { waiting: [{ studentId: "u-2", name: "Ana", requestedAt: "2026-10-14T11:04:00Z" }], admitted: [{ studentId: "u-3", name: "Bruno" }] },
      hands: [{ studentId: "u-3", name: "Bruno", requestedAt: "x" }],
    });
    render(<TeacherPanel {...props()} />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Aceitar Ana" }));
    expect(l.acceptStudent).toHaveBeenCalledWith("u-2");
    fireEvent.click(screen.getByRole("button", { name: "Aceitar todos" }));
    expect(l.acceptAll).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Recusar Ana" }));
    expect(l.removeStudent).toHaveBeenCalledWith("u-2");
    fireEvent.click(screen.getByRole("button", { name: "Remover Bruno da aula" }));
    expect(l.removeStudent).toHaveBeenLastCalledWith("u-3");
    fireEvent.click(screen.getByRole("button", { name: "Baixar a mão de Bruno" }));
    expect(l.moderate).toHaveBeenCalledWith("u-3");
    fireEvent.click(screen.getByRole("button", { name: "Baixar todas" }));
    expect(l.moderate).toHaveBeenLastCalledWith(undefined);
  });

  it("says what to do when nobody waits", async () => {
    live();
    render(<TeacherPanel {...props()} />);
    await flush();
    expect(screen.getByText("Nenhum aluno esperando. Compartilhe o aviso da aula com a turma.")).toBeDefined();
  });

  // CA-19: the notice and the short sound
  describe("who arrives", () => {
    it("notices a student who enters the waiting room, with a short sound, and not the ones who were already there", async () => {
      const beep = vi.fn();
      live({ admissions: { waiting: [{ studentId: "u-1", name: "Ana" }], admitted: [] } });
      const view = render(<TeacherPanel {...props()} beep={beep} />);
      await flush();
      expect(beep).not.toHaveBeenCalled();
      live({ admissions: { waiting: [{ studentId: "u-1", name: "Ana" }, { studentId: "u-2", name: "Bruno" }], admitted: [] } });
      view.rerender(<TeacherPanel {...props()} beep={beep} />);
      expect(beep).toHaveBeenCalledTimes(1);
      expect(screen.getByText("Novo estudante na sala de espera: Bruno")).toBeDefined();
    });

    it("can turn the sound off, and remembers it", async () => {
      const beep = vi.fn();
      live({ admissions: { waiting: [], admitted: [] } });
      const view = render(<TeacherPanel {...props()} beep={beep} />);
      await flush();
      const toggle = screen.getByRole("button", { name: "Som do aviso" });
      expect(toggle.getAttribute("aria-pressed")).toBe("true");
      fireEvent.click(toggle);
      expect(screen.getByRole("button", { name: "Som do aviso" }).getAttribute("aria-pressed")).toBe("false");
      live({ admissions: { waiting: [{ studentId: "u-2", name: "Bruno" }], admitted: [] } });
      view.rerender(<TeacherPanel {...props()} beep={beep} />);
      expect(beep).not.toHaveBeenCalled();
      expect(screen.getByText("Novo estudante na sala de espera: Bruno")).toBeDefined();
      cleanup();
      live();
      render(<TeacherPanel {...props()} beep={beep} />);
      expect(screen.getByRole("button", { name: "Som do aviso" }).getAttribute("aria-pressed")).toBe("false");
    });
  });

  // SPEC-062 CA-08: the sound of a hand that goes up
  describe("the hands that go up", () => {
    const ana = { studentId: "u-1", name: "Ana", requestedAt: "2026-10-14T11:00:00Z" };
    const bruno = { studentId: "u-2", name: "Bruno", requestedAt: "2026-10-14T11:01:00Z" };
    const clara = { studentId: "u-3", name: "Clara", requestedAt: "2026-10-14T11:02:00Z" };

    it("plays the sound of the hand, once, when a student who was not in the line puts the hand up, and not for the hands that were already up", async () => {
      const beep = vi.fn();
      live({ hands: [ana] });
      const view = render(<TeacherPanel {...props()} beep={beep} />);
      await flush();
      expect(beep).not.toHaveBeenCalled();
      live({ hands: [ana, bruno] });
      view.rerender(<TeacherPanel {...props()} beep={beep} />);
      expect(beep).toHaveBeenCalledTimes(1);
      expect(beep).toHaveBeenCalledWith("hand");
      live({ hands: [ana, bruno, clara] });
      view.rerender(<TeacherPanel {...props()} beep={beep} />);
      expect(beep).toHaveBeenCalledTimes(2);
    });

    it("plays once when two hands go up in the same update", async () => {
      const beep = vi.fn();
      live({ hands: [] });
      const view = render(<TeacherPanel {...props()} beep={beep} />);
      await flush();
      live({ hands: [ana, bruno] });
      view.rerender(<TeacherPanel {...props()} beep={beep} />);
      expect(beep).toHaveBeenCalledTimes(1);
    });

    it("does not play for the hands the first snapshot brings, after the room was not ready", async () => {
      const beep = vi.fn();
      live({ hands: [], ready: false });
      const view = render(<TeacherPanel {...props()} beep={beep} />);
      await flush();
      live({ hands: [ana, bruno], ready: true });
      view.rerender(<TeacherPanel {...props()} beep={beep} />);
      expect(beep).not.toHaveBeenCalled();
    });

    it("does not play when the same student only changes the doubt, nor when a hand goes down", async () => {
      const beep = vi.fn();
      live({ hands: [ana, bruno] });
      const view = render(<TeacherPanel {...props()} beep={beep} />);
      await flush();
      live({ hands: [{ ...ana, question: "Como uso o chmod?" }, bruno] });
      view.rerender(<TeacherPanel {...props()} beep={beep} />);
      live({ hands: [bruno] });
      view.rerender(<TeacherPanel {...props()} beep={beep} />);
      expect(beep).not.toHaveBeenCalled();
    });

    it("plays again for a student who put the hand down and up again", async () => {
      const beep = vi.fn();
      live({ hands: [ana] });
      const view = render(<TeacherPanel {...props()} beep={beep} />);
      await flush();
      live({ hands: [] });
      view.rerender(<TeacherPanel {...props()} beep={beep} />);
      live({ hands: [ana] });
      view.rerender(<TeacherPanel {...props()} beep={beep} />);
      expect(beep).toHaveBeenCalledTimes(1);
    });

    it("is silent with the sound of the notice off, and the hand is still on the screen", async () => {
      const beep = vi.fn();
      live({ hands: [] });
      const view = render(<TeacherPanel {...props()} beep={beep} />);
      await flush();
      fireEvent.click(screen.getByRole("button", { name: "Som do aviso" }));
      live({ hands: [ana] });
      view.rerender(<TeacherPanel {...props()} beep={beep} />);
      expect(beep).not.toHaveBeenCalled();
      expect(screen.getAllByText("Ana").length).toBeGreaterThan(0);
    });

    it("keeps the sound of the waiting room as it was", async () => {
      const beep = vi.fn();
      live({ admissions: { waiting: [], admitted: [] } });
      const view = render(<TeacherPanel {...props()} beep={beep} />);
      await flush();
      live({ admissions: { waiting: [{ studentId: "u-9", name: "Davi" }], admitted: [] } });
      view.rerender(<TeacherPanel {...props()} beep={beep} />);
      expect(beep).toHaveBeenCalledTimes(1);
      expect(beep).toHaveBeenCalledWith("arrival");
    });
  });

  // CA-03 and CA-06: the control of the slides and of the mode
  describe("the control of the stage", () => {
    it("moves through the slides, with the thumbnails, Previous, Next and the number", async () => {
      const l = live();
      render(<TeacherPanel {...props()} />);
      await flush();
      expect(screen.getByTestId("thumbs").getAttribute("data-current")).toBe("2");
      fireEvent.click(screen.getByRole("button", { name: "mock-thumb-4" }));
      expect(l.changeSlide).toHaveBeenLastCalledWith(4);
      fireEvent.click(screen.getByRole("button", { name: "Próxima lâmina" }));
      expect(l.changeSlide).toHaveBeenLastCalledWith(3);
      fireEvent.click(screen.getByRole("button", { name: "Lâmina anterior" }));
      expect(l.changeSlide).toHaveBeenLastCalledWith(1);
      fireEvent.change(screen.getByRole("spinbutton", { name: "Ir para a lâmina" }), { target: { value: "5" } });
      expect(l.changeSlide).toHaveBeenLastCalledWith(5);
      fireEvent.change(screen.getByRole("spinbutton", { name: "Ir para a lâmina" }), { target: { value: "99" } });
      expect(l.changeSlide).toHaveBeenLastCalledWith(5);
    });

    it("says when the class has no presentation", async () => {
      live({}, { deck: null });
      render(<TeacherPanel {...props()} />);
      await flush();
      expect(screen.getByText("Esta aula não tem apresentação.")).toBeDefined();
      expect(screen.queryByTestId("thumbs")).toBeNull();
    });

    it("switches the mode for everybody, and to the module only with one in the room or chosen", async () => {
      const l = live();
      render(<TeacherPanel {...props()} />);
      await flush();
      fireEvent.click(screen.getByRole("radio", { name: "Módulo de Ensino" }));
      expect(l.switchMode).not.toHaveBeenCalled();
      expect(screen.getByRole("alert").textContent).toBe("Escolha um módulo para mostrar à turma.");
      fireEvent.change(screen.getByRole("combobox", { name: "Módulo da aula" }), { target: { value: "m-2" } });
      fireEvent.click(screen.getByRole("button", { name: "Mostrar o módulo para a turma" }));
      expect(l.switchMode).toHaveBeenLastCalledWith("MODULE", "m-2");
      fireEvent.click(screen.getByRole("radio", { name: "Lâminas" }));
      expect(l.switchMode).toHaveBeenLastCalledWith("SLIDES");
    });

    it("lets the teacher choose the block in focus, and leave it to follow his reading", async () => {
      const l = live({}, { mode: "MODULE", moduleId: "m-1", deck: null });
      render(<TeacherPanel {...props()} />);
      await flush();
      const select = await screen.findByRole("combobox", { name: "Bloco em foco" });
      await waitFor(() => expect(within(select).getAllByRole("option")).toHaveLength(3));
      fireEvent.change(select, { target: { value: "b-2" } });
      expect(l.focusBlock).toHaveBeenCalledWith("b-2");
      expect(screen.getByText("Módulo na tela: Permissões de arquivos")).toBeDefined();
    });
  });

  // CA-15: the class born from the calendar opens on what it has
  describe("a class that comes ready", () => {
    it("opens on the module when there is no presentation", async () => {
      const l = live({}, { mode: "SLIDES", moduleId: "m-1", deck: null });
      render(<TeacherPanel {...props()} />);
      await flush();
      expect(l.switchMode).toHaveBeenCalledWith("MODULE", "m-1");
    });

    it("stays on the slides when there is a presentation, and offers the big button to go to the module, and back", async () => {
      const l = live({}, { mode: "SLIDES", moduleId: "m-1" });
      const view = render(<TeacherPanel {...props()} />);
      await flush();
      expect(l.switchMode).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Ir para o módulo" }));
      expect(l.switchMode).toHaveBeenLastCalledWith("MODULE", "m-1");
      const inModule = live({}, { mode: "MODULE", moduleId: "m-1" });
      view.rerender(<TeacherPanel {...props()} />);
      expect(screen.queryByRole("button", { name: "Ir para o módulo" })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Ir para as lâminas" }));
      expect(inModule.switchMode).toHaveBeenLastCalledWith("SLIDES");
    });

    it("offers no swap when the class has only one of the two", async () => {
      live({}, { mode: "SLIDES", moduleId: null });
      render(<TeacherPanel {...props()} />);
      await flush();
      expect(screen.queryByRole("button", { name: "Ir para o módulo" })).toBeNull();
    });

    it("chooses the stage only once, at the start", async () => {
      const l = live({}, { mode: "SLIDES", moduleId: "m-1", deck: null });
      const view = render(<TeacherPanel {...props()} />);
      await flush();
      view.rerender(<TeacherPanel {...props()} />);
      expect(l.switchMode).toHaveBeenCalledTimes(1);
    });
  });

  // CA-20 and CA-10: no surprise when ending
  describe("ending the class", () => {
    it("asks, with how long it went and how many took part, and only ends if the teacher confirms", async () => {
      live({ admissions: { waiting: [], admitted: [{ studentId: "a", name: "A" }, { studentId: "b", name: "B" }, { studentId: "c", name: "C" }] } });
      const end = vi.spyOn(classroomService, "endSession").mockResolvedValue({ id: "s-1", status: "FINISHED", endedAt: "x" });
      const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
      render(<TeacherPanel {...props()} />);
      await flush();
      fireEvent.click(screen.getByRole("button", { name: "Encerrar aula" }));
      expect(confirm.mock.calls[0]![0]).toContain("1 h 05 min");
      expect(confirm.mock.calls[0]![0]).toContain("3 alunos");
      expect(end).not.toHaveBeenCalled();
      confirm.mockReturnValue(true);
      fireEvent.click(screen.getByRole("button", { name: "Encerrar aula" }));
      await act(async () => void (await Promise.resolve()));
      expect(end).toHaveBeenCalledWith("c-1", "s-1");
      await act(async () => void (await Promise.resolve()));
      expect(push).toHaveBeenCalledWith("/app/classes/c-1");
    });

    it("says in plain words when it could not end", async () => {
      live();
      vi.spyOn(classroomService, "endSession").mockRejectedValue(new Error("x"));
      vi.spyOn(window, "confirm").mockReturnValue(true);
      render(<TeacherPanel {...props()} />);
      await flush();
      fireEvent.click(screen.getByRole("button", { name: "Encerrar aula" }));
      await flush();
      await flush();
      expect(screen.getByRole("alert").textContent).toBe("Não foi possível encerrar a aula. Tente de novo.");
      expect(push).not.toHaveBeenCalled();
    });

    it("tells everybody the class ended, with the way back", async () => {
      live({ ended: true });
      render(<TeacherPanel {...props()} />);
      expect(screen.getByText("A aula foi encerrada.")).toBeDefined();
      expect(screen.getByRole("link", { name: "Voltar para a turma" }).getAttribute("href")).toBe("/app/classes/c-1");
    });
  });

  it("tells when it is connecting, when the connection dropped, and when another panel took the control", async () => {
    live({ ready: false, connected: false });
    const view = render(<TeacherPanel {...props()} />);
    expect(screen.getByRole("status").textContent).toBe("Conectando à sala…");
    live({ ready: true, connected: false });
    view.rerender(<TeacherPanel {...props()} />);
    expect(screen.getByText("Conexão perdida. Tentando de novo…")).toBeDefined();
    live({ passive: true, canControl: false });
    view.rerender(<TeacherPanel {...props()} />);
    expect(screen.getByText("Outro painel assumiu o controle da aula. Este só acompanha.")).toBeDefined();
  });

  // CA-11: what no longer exists
  it("has no split screen, no 'My screen', no 'Class screen', no private slide and no broadcast switch", async () => {
    live({}, { mode: "MODULE", moduleId: "m-1" });
    render(<TeacherPanel {...props()} />);
    await flush();
    for (const text of [/Minha tela/, /Tela da turma/, /Mostrar para a turma/, /Seguir a turma/, /Transmitir o terminal/]) {
      expect(screen.queryByText(text)).toBeNull();
    }
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("uses only the color tokens", () => {
    expect(css.length).toBeGreaterThan(0);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\brgba?\(/);
  });
});
