import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LiveTerminalCommand } from "@/services/classroomService";
import type { SessionDiary as Diary } from "@/services/scheduleService";
import { session } from "@/test/scheduleFixtures";
import { SessionDiary } from "./SessionDiary";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const lesson = session({ id: "s-26", date: "2026-10-26", topic: "Permissões de arquivos", hasContent: true });

const diary = (over: Partial<Diary> = {}): Diary => ({
  session: { ...lesson, startsAt: "2026-10-26T08:20:00-03:00", endsAt: "2026-10-26T10:00:00-03:00", liveSessionCount: 1, commandCount: 2 },
  content: {
    topic: "Permissões de arquivos",
    description: "<p>Veremos <strong>chmod</strong>.</p>",
    links: [{ name: "Meet", url: "https://meet.google.com/abc", position: 0 }],
    teacherNotes: "<p>Vimos chmod e chown.</p>",
    teacherPrivateNotes: "<p>Rever o fork.</p>",
  },
  liveSessions: [
    { id: "live-1", title: "Aula de segunda", status: "FINISHED", startedAt: "2026-10-26T08:25:00-03:00", endedAt: "2026-10-26T10:00:00-03:00", durationMinutes: 95, commandCount: 2 },
  ],
  ...over,
});

const commands: LiveTerminalCommand[] = [
  { terminal: 1, command: "ls -la", exitStatus: 0, output: "total 0\n", outputTruncated: false, ranAt: "2026-10-26T11:30:00Z" },
  { terminal: 2, command: "cat x", exitStatus: 1, output: "cat: x: No such file or directory", outputTruncated: true, ranAt: "2026-10-26T11:31:00Z" },
  { terminal: 1, command: "sleep 100", exitStatus: null, output: "", outputTruncated: false, ranAt: "2026-10-26T11:32:00Z" },
];

function setup(over: Partial<Diary> = {}, role: "teacher" | "student" = "student", showContent = true) {
  const load = vi.fn().mockResolvedValue(diary(over));
  const loadCommands = vi.fn().mockResolvedValue(commands);
  render(<SessionDiary classId="c-1" session={lesson} role={role} load={load} loadCommands={loadCommands} showContent={showContent} />);
  return { load, loadCommands };
}

// SPEC-071 CA-08 and section 3.1: the diary of the lesson
describe("SessionDiary", () => {
  it("shows the student the public notes, the content and the live classes, and never the private notes", async () => {
    const { load } = setup();
    expect(await screen.findByRole("heading", { name: "Anotações da aula" })).toBeDefined();
    expect(load).toHaveBeenCalledWith(expect.objectContaining({ id: "s-26" }));
    expect(screen.getByText("Vimos chmod e chown.")).toBeDefined();
    expect(screen.queryByRole("heading", { name: "Anotações privadas" })).toBeNull();
    expect(screen.queryByText("Rever o fork.")).toBeNull();
    expect(screen.queryByText("Só você vê")).toBeNull();

    expect(screen.getByRole("heading", { level: 4, name: "Permissões de arquivos" })).toBeDefined();
    expect(screen.getByText("chmod")).toBeDefined();
    const meet = screen.getByRole("link", { name: "Meet" });
    expect(meet.getAttribute("href")).toBe("https://meet.google.com/abc");
    expect(meet.getAttribute("rel")).toBe("noopener noreferrer");

    expect(screen.getByRole("heading", { name: "Aulas ao vivo desta aula" })).toBeDefined();
    expect(screen.getByText("Aula de segunda")).toBeDefined();
    expect(screen.getByText(/95 min/)).toBeDefined();
    expect(screen.getByRole("button", { name: "Ver comandos (2)" })).toBeDefined();
  });

  it("shows the teacher the private notes, marked as his alone", async () => {
    setup({}, "teacher");
    expect(await screen.findByRole("heading", { name: "Anotações privadas" })).toBeDefined();
    expect(screen.getByText("Só você vê")).toBeDefined();
    expect(screen.getByText("Rever o fork.")).toBeDefined();
    expect(screen.getByText("Vimos chmod e chown.")).toBeDefined();
  });

  it("leaves out what the lesson does not have, and the content when asked to", async () => {
    setup({ content: { links: [] }, liveSessions: [] });
    await waitFor(() => expect(screen.queryByText("Carregando o diário…")).toBeNull());
    expect(screen.queryByRole("heading", { name: "Anotações da aula" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Aulas ao vivo desta aula" })).toBeNull();
    expect(screen.queryByRole("heading", { level: 4 })).toBeNull();
    cleanup();

    setup({}, "teacher", false);
    expect(await screen.findByRole("heading", { name: "Anotações da aula" })).toBeDefined();
    expect(screen.queryByText("chmod")).toBeNull();
    expect(screen.queryByRole("link", { name: "Meet" })).toBeNull();
  });

  it("loads the commands of a live class when it is expanded, in order, with the terminal, the status and the output", async () => {
    const { loadCommands } = setup();
    fireEvent.click(await screen.findByRole("button", { name: "Ver comandos (2)" }));
    expect(loadCommands).toHaveBeenCalledWith("live-1");
    const list = await screen.findByRole("list", { name: "Comandos de Aula de segunda" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]!.textContent).toContain("ls -la");
    expect(items[0]!.textContent).toContain("Terminal 1");
    expect(items[0]!.textContent).toContain("ok");
    expect(items[1]!.textContent).toContain("cat x");
    expect(items[1]!.textContent).toContain("Terminal 2");
    expect(items[1]!.textContent).toContain("erro 1");
    expect(items[2]!.textContent).toContain("sleep 100");
    expect(items[2]!.textContent).toContain("interrompido");

    // the output is folded; the one that was cut says so
    expect(within(items[1]!).queryByText(/No such file/)).toBeNull();
    fireEvent.click(within(items[1]!).getByRole("button", { name: "Ver saída" }));
    expect(within(items[1]!).getByText(/cat: x: No such file or directory/)).toBeDefined();
    expect(within(items[1]!).getByText("(saída cortada em 4.000 caracteres)")).toBeDefined();
    fireEvent.click(within(items[1]!).getByRole("button", { name: "Ocultar saída" }));
    expect(within(items[1]!).queryByText(/No such file/)).toBeNull();
    expect(within(items[2]!).queryByRole("button", { name: "Ver saída" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Ocultar comandos" }));
    expect(screen.queryByRole("list", { name: "Comandos de Aula de segunda" })).toBeNull();
  });

  it("copies the line of a command", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Ver comandos (2)" }));
    const list = await screen.findByRole("list", { name: "Comandos de Aula de segunda" });
    fireEvent.click(within(within(list).getAllByRole("listitem")[0]!).getByRole("button", { name: "Copiar" }));
    expect(writeText).toHaveBeenCalledWith("ls -la");
    expect(await screen.findByText("Copiado")).toBeDefined();
  });

  it("tells when the diary or the commands cannot be loaded", async () => {
    const load = vi.fn().mockRejectedValue(new Error("down"));
    render(<SessionDiary classId="c-1" session={lesson} role="student" load={load} loadCommands={vi.fn()} />);
    expect(await screen.findByText("Não foi possível carregar o diário da aula.")).toBeDefined();
    cleanup();

    const loadCommands = vi.fn().mockRejectedValue(new Error("down"));
    render(<SessionDiary classId="c-1" session={lesson} role="student" load={vi.fn().mockResolvedValue(diary())} loadCommands={loadCommands} />);
    fireEvent.click(await screen.findByRole("button", { name: "Ver comandos (2)" }));
    expect(await screen.findByText("Não foi possível carregar os comandos.")).toBeDefined();
  });

  it("says a live class is still going on, and that it has no commands yet", async () => {
    setup({ liveSessions: [{ id: "live-2", title: "Agora", status: "ACTIVE", startedAt: "2026-10-26T08:25:00-03:00", endedAt: null, durationMinutes: 0, commandCount: 0 }] });
    expect(await screen.findByText("Em andamento")).toBeDefined();
    expect(screen.getByText("Nenhum comando nesta aula.")).toBeDefined();
    expect(screen.queryByRole("button", { name: /Ver comandos/ })).toBeNull();
  });
});
