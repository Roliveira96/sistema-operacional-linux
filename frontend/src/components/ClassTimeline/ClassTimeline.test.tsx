import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionDiary, Timeline, TimelineEntry } from "@/services/scheduleService";
import { session } from "@/test/scheduleFixtures";
import { ClassTimeline, type ClassTimelineProps } from "./ClassTimeline";

const entry = (id: string, date: string, start: string, end: string, over: Partial<TimelineEntry> = {}): TimelineEntry => ({
  ...session({ id, date, startTime: start, endTime: end }),
  startsAt: `${date}T${start}:00-03:00`,
  endsAt: `${date}T${end}:00-03:00`,
  liveSessionCount: 0,
  commandCount: 0,
  ...over,
});

const timeline = (over: Partial<Timeline> = {}): Timeline => ({
  now: "2026-10-19T09:00:00-03:00",
  current: entry("s-19", "2026-10-19", "08:20", "10:00", { topic: "Permissões de arquivos", hasContent: true }),
  past: [
    entry("s-14", "2026-10-14", "13:50", "15:30", { topic: "Processos", hasContent: true, liveSessionCount: 1, commandCount: 12 }),
    entry("s-12", "2026-10-12", "08:20", "10:00"),
    entry("s-07", "2026-10-07", "13:50", "15:30", { topic: "Histórico do Linux", hasContent: true }),
  ],
  upcoming: [entry("s-21", "2026-10-21", "13:50", "15:30", { topic: "Usuários e grupos", hasContent: true }), entry("s-26", "2026-10-26", "08:20", "10:00")],
  liveSessionId: null,
  ...over,
});

const diaryOf = (e: TimelineEntry): SessionDiary => ({
  session: e,
  content: { topic: e.topic, links: [], teacherNotes: `<p>Notas de ${e.id}</p>` },
  liveSessions: [],
});

// The visibility of the tab, which jsdom keeps always visible.
let visibility: "visible" | "hidden" = "visible";
function showTab(state: "visible" | "hidden") {
  visibility = state;
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  vi.useFakeTimers();
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete (document as { visibilityState?: unknown }).visibilityState;
});

const flush = () => act(async () => void (await vi.advanceTimersByTimeAsync(0)));
const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

function setup(role: "teacher" | "student", over: Partial<Timeline> = {}, extra: Partial<ClassTimelineProps> = {}) {
  const load = vi.fn().mockResolvedValue(timeline(over));
  const loadDiary = vi.fn().mockImplementation(async (e: TimelineEntry) => diaryOf(e));
  const loadCommands = vi.fn().mockResolvedValue([]);
  const onStartLive = vi.fn();
  const props: ClassTimelineProps = {
    classId: "c-1",
    courseCode: "SO34E",
    role,
    load,
    loadDiary,
    loadCommands,
    liveHref: "/app/classes/c-1/live",
    onStartLive,
    ...extra,
  };
  const view = render(<ClassTimeline {...props} />);
  return { ...view, load, loadDiary, loadCommands, onStartLive };
}

const region = () => screen.getByRole("region", { name: "Linha do tempo da turma" });
const block = (name: string) => within(region()).getByRole("region", { name });

// SPEC-073 CA-07 and section 3.1: the timeline of the class under the calendar
describe("ClassTimeline", () => {
  it("shows the three blocks: the current lesson marked Agora, the past ones folded with their commands, and the upcoming ones", async () => {
    const { load } = setup("student");
    await flush();
    expect(load).toHaveBeenCalledTimes(1);

    const current = block("Aula atual");
    expect(within(current).getByText("Agora")).toBeDefined();
    expect(within(current).getByText("Permissões de arquivos")).toBeDefined();
    expect(within(current).getByText(/segunda-feira, 19\/10/)).toBeDefined();
    expect(within(current).getByText(/08:20/)).toBeDefined();
    expect(within(current).getByText("A aula ao vivo ainda não começou.")).toBeDefined();

    const past = block("Aulas passadas");
    const pastItems = within(past).getAllByRole("listitem");
    expect(pastItems).toHaveLength(3);
    expect(pastItems[0]!.textContent).toContain("Processos");
    expect(pastItems[0]!.textContent).toContain("12 comandos");
    expect(pastItems[1]!.textContent).toContain("SO34E");
    expect(pastItems[1]!.textContent).not.toContain("comando");
    expect(within(pastItems[0]!).getByRole("button", { name: "Ver diário" })).toBeDefined();
    expect(within(past).queryByText(/Notas de/)).toBeNull();

    const upcoming = block("Próximas aulas");
    const next = within(upcoming).getAllByRole("listitem");
    expect(next).toHaveLength(2);
    expect(next[0]!.textContent).toContain("Usuários e grupos");
    expect(next[0]!.textContent).toContain("13:50");
    expect(within(next[0]!).getByRole("button", { name: "Ver detalhes" })).toBeDefined();
    expect(next[1]!.textContent).toContain("SO34E");
    expect(within(next[1]!).queryByRole("button", { name: "Ver detalhes" })).toBeNull();
  });

  it("marks the current lesson with the time it starts while it has not started", async () => {
    setup("student", { now: "2026-10-19T08:10:00-03:00" });
    await flush();
    const current = block("Aula atual");
    expect(within(current).getByText("Começa às 08:20")).toBeDefined();
    expect(within(current).queryByText("Agora")).toBeNull();
  });

  it("gives the student the way into the live class, and the teacher the way back or the start", async () => {
    setup("student", { liveSessionId: "live-1" });
    await flush();
    expect(within(block("Aula atual")).getByRole("link", { name: "Entrar na aula ao vivo" }).getAttribute("href")).toBe("/app/classes/c-1/live");
    expect(within(block("Aula atual")).queryByText("A aula ao vivo ainda não começou.")).toBeNull();
    cleanup();

    setup("teacher", { liveSessionId: "live-1" });
    await flush();
    expect(within(block("Aula atual")).getByRole("link", { name: "Voltar para a aula ao vivo" }).getAttribute("href")).toBe("/app/classes/c-1/live");
    expect(within(block("Aula atual")).queryByRole("button", { name: "Iniciar aula ao vivo" })).toBeNull();
    cleanup();

    const { onStartLive } = setup("teacher");
    await flush();
    fireEvent.click(within(block("Aula atual")).getByRole("button", { name: "Iniciar aula ao vivo" }));
    expect(onStartLive).toHaveBeenCalledWith(expect.objectContaining({ id: "s-19" }));
    expect(within(block("Aula atual")).queryByText("A aula ao vivo ainda não começou.")).toBeNull();
  });

  it("says when there is no lesson now, and which one is next", async () => {
    setup("student", { current: null });
    await flush();
    expect(within(block("Aula atual")).getByText("Nenhuma aula agora.")).toBeDefined();
    expect(within(block("Aula atual")).getByText("A próxima é quarta-feira, 21/10 às 13:50.")).toBeDefined();
    cleanup();

    setup("student", { current: null, upcoming: [], past: [] });
    await flush();
    expect(within(block("Aula atual")).getByText("Nenhuma aula agora.")).toBeDefined();
    expect(within(block("Aula atual")).queryByText(/A próxima é/)).toBeNull();
    expect(within(block("Aulas passadas")).getByText("Nenhuma aula passada ainda.")).toBeDefined();
    expect(within(block("Próximas aulas")).getByText("Nenhuma aula marcada.")).toBeDefined();
  });

  it("expands the diary of a past lesson, and of an upcoming one with content, and folds it again", async () => {
    const { loadDiary } = setup("student");
    await flush();
    const past = block("Aulas passadas");
    expect(within(past).getAllByRole("button", { name: "Ver diário" })).toHaveLength(3);
    fireEvent.click(within(past).getAllByRole("button", { name: "Ver diário" })[0]!);
    await flush();
    expect(loadDiary).toHaveBeenCalledWith(expect.objectContaining({ id: "s-14" }));
    expect(within(past).getByText("Notas de s-14")).toBeDefined();
    fireEvent.click(within(past).getByRole("button", { name: "Recolher" }));
    expect(within(past).queryByText("Notas de s-14")).toBeNull();

    const upcoming = block("Próximas aulas");
    fireEvent.click(within(upcoming).getByRole("button", { name: "Ver detalhes" }));
    await flush();
    expect(loadDiary).toHaveBeenCalledWith(expect.objectContaining({ id: "s-21" }));
    expect(within(upcoming).getByText("Notas de s-21")).toBeDefined();
  });

  it("asks again every 60 seconds while the tab is in view, and when it comes back into view", async () => {
    const { load } = setup("student");
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
    await advance(60_000);
    expect(load).toHaveBeenCalledTimes(2);

    showTab("hidden");
    await advance(60_000);
    expect(load).toHaveBeenCalledTimes(2);
    showTab("visible");
    await flush();
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("shows nothing when the timeline cannot be read, and comes back at the next check", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValue(timeline());
    setup("student", {}, { load });
    await flush();
    expect(screen.queryByRole("region", { name: "Linha do tempo da turma" })).toBeNull();
    await advance(60_000);
    expect(region()).toBeDefined();
    expect(within(block("Aula atual")).getByText("Agora")).toBeDefined();
  });

  it("reads the timeline again when asked to", async () => {
    const { load, rerender, load: first } = setup("student");
    await flush();
    expect(first).toHaveBeenCalledTimes(1);
    rerender(
      <ClassTimeline classId="c-1" courseCode="SO34E" role="student" load={load} loadDiary={vi.fn()} loadCommands={vi.fn()} liveHref="/x" reloadKey={1} />,
    );
    await flush();
    expect(load).toHaveBeenCalledTimes(2);
  });
});

// SPEC-073 CA-12, CA-13: every card opens its diary, and the teacher edits the lesson from the card
describe("actions of the cards (SPEC-073 CA-12, CA-13)", () => {
  const names = { diary: "Ver diário", details: "Ver detalhes", content: "Conteúdo da aula", change: "Alterar esta aula" };

  it("gives the teacher the diary and the two edit buttons in every card, even in an upcoming lesson with nothing in it", async () => {
    setup("teacher", {}, { onEditContent: vi.fn(), onEditSession: vi.fn() });
    await flush();

    const current = block("Aula atual");
    expect(within(current).getByRole("button", { name: names.details })).toBeDefined();
    expect(within(current).getByRole("button", { name: names.content })).toBeDefined();
    expect(within(current).getByRole("button", { name: names.change })).toBeDefined();

    const past = block("Aulas passadas");
    expect(within(past).getAllByRole("button", { name: names.diary })).toHaveLength(3);
    expect(within(past).getAllByRole("button", { name: names.content })).toHaveLength(3);
    expect(within(past).getAllByRole("button", { name: names.change })).toHaveLength(3);

    // s-26 has no content, and the teacher still opens it and edits it
    const upcoming = block("Próximas aulas");
    expect(within(upcoming).getAllByRole("button", { name: names.details })).toHaveLength(2);
    expect(within(upcoming).getAllByRole("button", { name: names.content })).toHaveLength(2);
    expect(within(upcoming).getAllByRole("button", { name: names.change })).toHaveLength(2);
  });

  it("calls the handlers with the lesson of the card that was clicked", async () => {
    const onEditContent = vi.fn();
    const onEditSession = vi.fn();
    setup("teacher", {}, { onEditContent, onEditSession });
    await flush();

    const upcoming = block("Próximas aulas");
    fireEvent.click(within(upcoming).getAllByRole("button", { name: names.content })[1]!);
    expect(onEditContent).toHaveBeenCalledTimes(1);
    expect(onEditContent).toHaveBeenCalledWith(expect.objectContaining({ id: "s-26" }));

    const past = block("Aulas passadas");
    fireEvent.click(within(past).getAllByRole("button", { name: names.change })[0]!);
    expect(onEditSession).toHaveBeenCalledTimes(1);
    expect(onEditSession).toHaveBeenCalledWith(expect.objectContaining({ id: "s-14" }));

    fireEvent.click(within(block("Aula atual")).getByRole("button", { name: names.content }));
    expect(onEditContent).toHaveBeenLastCalledWith(expect.objectContaining({ id: "s-19" }));
  });

  it("gives the student the diary where there is something to see, and never the edit buttons", async () => {
    setup("student", {}, { onEditContent: vi.fn(), onEditSession: vi.fn() });
    await flush();

    expect(within(block("Aula atual")).getByRole("button", { name: names.details })).toBeDefined();
    expect(within(block("Aulas passadas")).getAllByRole("button", { name: names.diary })).toHaveLength(3);
    // only s-21 has content: the lesson with none has nothing to open
    expect(within(block("Próximas aulas")).getAllByRole("button", { name: names.details })).toHaveLength(1);

    expect(within(region()).queryByRole("button", { name: names.content })).toBeNull();
    expect(within(region()).queryByRole("button", { name: names.change })).toBeNull();
  });

  it("does not draw an edit button the page gave no handler for", async () => {
    setup("teacher", {}, { onEditContent: vi.fn() });
    await flush();
    expect(within(region()).getAllByRole("button", { name: names.content }).length).toBeGreaterThan(0);
    expect(within(region()).queryByRole("button", { name: names.change })).toBeNull();
  });

  it("says nothing was registered when the teacher opens a lesson that has nothing in it", async () => {
    const empty = vi.fn().mockImplementation(async (e: TimelineEntry) => ({ session: e, content: { links: [] }, liveSessions: [] }));
    setup("teacher", {}, { loadDiary: empty, onEditContent: vi.fn() });
    await flush();

    const upcoming = block("Próximas aulas");
    fireEvent.click(within(upcoming).getAllByRole("button", { name: names.details })[1]!);
    await flush();
    expect(empty).toHaveBeenCalledWith(expect.objectContaining({ id: "s-26" }));
    expect(within(upcoming).getByText("Nada registrado nesta aula ainda.")).toBeDefined();
  });

  it("opens the diary of the current lesson from its card", async () => {
    const { loadDiary } = setup("student");
    await flush();
    const current = block("Aula atual");
    fireEvent.click(within(current).getByRole("button", { name: names.details }));
    await flush();
    expect(loadDiary).toHaveBeenCalledWith(expect.objectContaining({ id: "s-19" }));
    expect(within(current).getByText("Notas de s-19")).toBeDefined();
    fireEvent.click(within(current).getByRole("button", { name: "Recolher" }));
    expect(within(current).queryByText("Notas de s-19")).toBeNull();
  });
});
