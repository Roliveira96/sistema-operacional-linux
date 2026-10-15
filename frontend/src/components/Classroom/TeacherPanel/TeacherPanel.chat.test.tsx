import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLiveClassroom } from "@/hooks/useLiveClassroom";
import { classroomService, type AdmissionEntry, type HandRaiseItem, type LiveChatMessage, type LiveSession } from "@/services/classroomService";
import { moduleService } from "@/services/moduleService";
import { TeacherPanel } from "./TeacherPanel";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/hooks/useLiveClassroom", () => ({ useLiveClassroom: vi.fn() }));
vi.mock("@/services/moduleService", () => ({ moduleService: { listModules: vi.fn() } }));
vi.mock("../SlideThumbnails/SlideThumbnails", async () => {
  const React = await import("react");
  return { SlideThumbnails: () => React.createElement("div", { "data-testid": "thumbs" }) };
});

const session: LiveSession = { id: "s-1", classId: "c-1", title: "Permissões", status: "ACTIVE", displayMode: "SLIDES", currentSlide: 1, startedAt: "2026-10-14T10:00:00Z" };
const deck = { id: "d", title: "t", pageCount: 5, downloadUrl: "https://x" };

const ana: AdmissionEntry = { studentId: "u-1", name: "Ana Souza" };
const bruno: AdmissionEntry = { studentId: "u-2", name: "Bruno Lima" };
const carla: AdmissionEntry = { studentId: "u-3", name: "Carla Dias" };

let seq = 0;
const msg = (over: Pick<LiveChatMessage, "scope" | "from" | "text"> & Partial<LiveChatMessage>): LiveChatMessage => ({ id: `m-${++seq}`, createdAt: "2026-10-14T10:00:00Z", ...over });
const fromStudent = (studentId: string, text: string) => msg({ scope: "private", studentId, from: "STUDENT", text });
const fromTeacher = (studentId: string, text: string) => msg({ scope: "private", studentId, from: "TEACHER", text });
const toAll = (text: string) => msg({ scope: "all", from: "TEACHER", text });

const hand = (entry: AdmissionEntry, question = "", requestedAt = "2026-10-14T10:00:00Z"): HandRaiseItem => ({ studentId: entry.studentId, name: entry.name, requestedAt, question });

function live(over: Record<string, unknown> = {}) {
  const value = {
    room: { mode: "SLIDES", slide: 2, moduleId: null, moduleFocusBlockId: null, deck, strokes: [], cursor: null, online: 5, blank: false },
    admissions: { waiting: [], admitted: [ana, bruno, carla] },
    onlineStudents: ["u-1", "u-2"],
    hands: [],
    chat: [],
    startedAt: "2026-10-14T10:00:00Z",
    presenterConnected: true,
    fullscreenRequested: false,
    ready: true,
    ended: false,
    passive: false,
    connected: true,
    canControl: true,
    changeSlide: vi.fn(), switchMode: vi.fn(), moderate: vi.fn(), acceptStudent: vi.fn(), acceptAll: vi.fn(), removeStudent: vi.fn(), focusBlock: vi.fn(),
    sendStageFullscreen: vi.fn(),
    sendChat: vi.fn(() => true),
    ...over,
  };
  vi.mocked(useLiveClassroom).mockReturnValue(value as never);
  return value as typeof value & { sendChat: ReturnType<typeof vi.fn> };
}

const beep = vi.fn();
const element = () => <TeacherPanel classId="c-1" session={session} beep={beep} />;
const panel = () => render(element());
const flush = () => act(async () => void (await Promise.resolve()));

/** The section of the cards and the section of the conversation, which are what these tests look at. */
const online = () => within(screen.getByRole("region", { name: "Alunos online" }));
const conversation = () => within(screen.getByRole("heading", { level: 2, name: "Conversa" }).closest("section")!);
const card = (name: string) => within(online().getByText(name).closest("li")!);
const names = () => online().queryAllByRole("listitem").map((item) => item.querySelector("[data-testid='online-name']")!.textContent);
const field = () => screen.getByRole("textbox", { name: "Mensagem" }) as HTMLTextAreaElement;
const type = (text: string) => fireEvent.change(field(), { target: { value: text } });
const talkTo = (name: string) => fireEvent.click(screen.getByRole("button", { name: `Conversar com ${name}` }));
const counters = () => online().queryAllByText(/^\d+ novas?$/).map((node) => node.textContent);

beforeEach(() => {
  beep.mockClear();
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(new Date("2026-10-14T10:05:00Z"));
  vi.mocked(moduleService.listModules).mockResolvedValue({ items: [], total: 0, page: 1, limit: 100 } as never);
  vi.spyOn(classroomService, "getLiveModule").mockResolvedValue({ moduleId: "m", title: "t", scenario: {}, blocks: [] });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// SPEC-063 CA-01: the section "Alunos online", in the main column, after the summary
describe("TeacherPanel, the online students", () => {
  it("has the section after the summary of the class and before the control of the stage, in the main column", async () => {
    live();
    panel();
    await flush();
    const summary = screen.getByRole("region", { name: "Resumo da aula" });
    const section = screen.getByRole("region", { name: "Alunos online" });
    const stage = screen.getByRole("region", { name: "Controle da aula" });
    expect(summary.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(section.compareDocumentPosition(stage) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(section.parentElement).toBe(summary.parentElement);
    expect(screen.getByRole("complementary").contains(section)).toBe(false);
  });

  it("has a card for each student who is accepted and online, and the button for everybody", async () => {
    live({ onlineStudents: ["u-1", "u-3", "u-9"], admissions: { waiting: [{ studentId: "u-4", name: "Davi Rocha" }], admitted: [ana, bruno, carla] } });
    panel();
    await flush();
    expect(names()).toEqual(["Ana Souza", "Carla Dias"]);
    expect(online().queryByText("Davi Rocha")).toBeNull();
    expect(online().queryByText("Bruno Lima")).toBeNull();
    expect(online().getByRole("button", { name: "Mensagem para todos" })).toBeDefined();
  });

  it("says that nobody is online, and still has the button for everybody", async () => {
    live({ onlineStudents: [] });
    panel();
    await flush();
    expect(online().getByText("Nenhum aluno online.")).toBeDefined();
    expect(online().getByRole("button", { name: "Mensagem para todos" })).toBeDefined();
  });

  it("follows who comes in and who leaves, as the room tells", async () => {
    live({ onlineStudents: ["u-1"] });
    const view = panel();
    await flush();
    expect(names()).toEqual(["Ana Souza"]);
    live({ onlineStudents: ["u-1", "u-2"] });
    view.rerender(element());
    expect(names()).toEqual(["Ana Souza", "Bruno Lima"]);
    live({ onlineStudents: ["u-2"] });
    view.rerender(element());
    expect(names()).toEqual(["Bruno Lima"]);
  });

  it("shows the raised hand and the doubt on the card, as text, and follows the hand up and down", async () => {
    live();
    const view = panel();
    await flush();
    expect(online().queryByText("Mão levantada")).toBeNull();
    live({ hands: [hand(bruno, "<b>x</b> Como uso o chmod?")] });
    view.rerender(element());
    expect(card("Bruno Lima").getByText("Mão levantada")).toBeDefined();
    expect(card("Bruno Lima").getByText("há 5 min")).toBeDefined();
    expect(card("Bruno Lima").getByTestId("online-question").textContent).toBe("<b>x</b> Como uso o chmod?");
    expect(screen.getByRole("region", { name: "Alunos online" }).querySelector("b")).toBeNull();
    expect(names()).toEqual(["Bruno Lima", "Ana Souza"]);
    live({ hands: [] });
    view.rerender(element());
    expect(online().queryByText("Mão levantada")).toBeNull();
    expect(names()).toEqual(["Ana Souza", "Bruno Lima"]);
  });
});

// SPEC-063 CA-07: the conversation, at the top of the side column
describe("TeacherPanel, the conversation", () => {
  it("is the first block of the side column, above the raised hands, and asks to choose a conversation at first", async () => {
    live();
    panel();
    await flush();
    const side = screen.getByRole("complementary");
    const title = within(side).getByRole("heading", { level: 2, name: "Conversa" });
    const hands = within(side).getByRole("heading", { name: "Mãos levantadas" });
    expect(side.firstElementChild!.contains(title)).toBe(true);
    expect(title.compareDocumentPosition(hands) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(conversation().getByText('Escolha um aluno ou "Mensagem para todos".')).toBeDefined();
    expect(screen.queryByRole("textbox", { name: "Mensagem" })).toBeNull();
  });

  it("opens the conversation with the student by his card, with his messages and the ones for everybody, marked", async () => {
    live({
      chat: [fromStudent("u-1", "Não entendi o chmod"), fromStudent("u-2", "Segredo do Bruno"), toAll("Prova na sexta"), fromTeacher("u-1", "Veja o man")],
    });
    panel();
    await flush();
    talkTo("Ana Souza");
    expect(conversation().getByRole("heading", { level: 3, name: "Conversa com Ana Souza" })).toBeDefined();
    const items = conversation().getAllByRole("listitem").map((item) => item.textContent);
    expect(items).toEqual(["Ana SouzaNão entendi o chmod", "VocêPara todosProva na sexta", "VocêVeja o man"]);
    expect(screen.queryByText("Segredo do Bruno")).toBeNull();
    expect(screen.getByRole("button", { name: "Conversar com Ana Souza" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Conversar com Bruno Lima" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("opens the channel for the whole class with the button for everybody, with only the messages for everybody", async () => {
    live({ chat: [fromStudent("u-1", "Não entendi o chmod"), toAll("Prova na sexta"), fromTeacher("u-1", "Veja o man")] });
    panel();
    await flush();
    fireEvent.click(online().getByRole("button", { name: "Mensagem para todos" }));
    expect(conversation().getByRole("heading", { level: 3, name: "Para todos os alunos" })).toBeDefined();
    expect(conversation().getAllByRole("listitem").map((item) => item.textContent)).toEqual(["VocêPara todosProva na sexta"]);
    expect(conversation().queryByRole("button", { name: /Enviar só para/ })).toBeNull();
    expect(online().getByRole("button", { name: "Mensagem para todos" }).getAttribute("aria-pressed")).toBe("true");
    talkTo("Bruno Lima");
    expect(conversation().getByRole("heading", { level: 3, name: "Conversa com Bruno Lima" })).toBeDefined();
    expect(online().getByRole("button", { name: "Mensagem para todos" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("pins the doubt of the raised hand at the top of the conversation, and takes it away when the hand goes down", async () => {
    live({ hands: [hand(ana, "Como uso o chmod?")], chat: [fromStudent("u-1", "Oi")] });
    const view = panel();
    await flush();
    talkTo("Ana Souza");
    expect(conversation().getByText("Dúvida da mão:").parentElement!.textContent).toBe("Dúvida da mão:Como uso o chmod?");
    live({ hands: [], chat: [fromStudent("u-1", "Oi")] });
    view.rerender(element());
    expect(conversation().queryByText("Dúvida da mão:")).toBeNull();
  });

  it("pins no doubt of another student's hand", async () => {
    live({ hands: [hand(bruno, "Dúvida do Bruno")] });
    panel();
    await flush();
    talkTo("Ana Souza");
    expect(conversation().queryByText("Dúvida da mão:")).toBeNull();
    expect(conversation().queryByText("Dúvida do Bruno")).toBeNull();
  });

  it("draws the messages as text, never as HTML", async () => {
    live({ chat: [fromStudent("u-1", "<b>negrito</b>\nlinha 2"), toAll("<img src=x onerror=alert(1)>")] });
    panel();
    await flush();
    talkTo("Ana Souza");
    expect(conversation().getByText("<img src=x onerror=alert(1)>")).toBeDefined();
    expect(conversation().getByRole("log").querySelector("b, img")).toBeNull();
  });

  it("sends in private with Enter to the student of the open conversation", async () => {
    const l = live();
    panel();
    await flush();
    talkTo("Bruno Lima");
    type("Olá, Bruno");
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(l.sendChat).toHaveBeenCalledTimes(1);
    expect(l.sendChat).toHaveBeenCalledWith("Olá, Bruno", { studentId: "u-2" });
  });

  it("sends only to the student with the main button, and to everybody with the other, and says the second went", async () => {
    const l = live();
    panel();
    await flush();
    talkTo("Ana Souza");
    type("Só para você");
    fireEvent.click(conversation().getByRole("button", { name: "Enviar só para Ana Souza" }));
    expect(l.sendChat).toHaveBeenLastCalledWith("Só para você", { studentId: "u-1" });
    expect(screen.queryByText("Mensagem enviada para todos os alunos.")).toBeNull();
    type("Para a turma");
    fireEvent.click(conversation().getByRole("button", { name: "Enviar para todos" }));
    expect(l.sendChat).toHaveBeenLastCalledWith("Para a turma", "all");
    expect(screen.getByText("Mensagem enviada para todos os alunos.").getAttribute("role")).toBe("status");
  });

  it("sends to everybody with Enter in the channel for everybody", async () => {
    const l = live();
    panel();
    await flush();
    fireEvent.click(online().getByRole("button", { name: "Mensagem para todos" }));
    type("Bom dia, turma");
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(l.sendChat).toHaveBeenCalledWith("Bom dia, turma", "all");
  });

  it("clears the field only when the message went", async () => {
    const l = live({ sendChat: vi.fn(() => false) });
    panel();
    await flush();
    talkTo("Ana Souza");
    type("Não saiu");
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(l.sendChat).toHaveBeenCalledTimes(1);
    expect(field().value).toBe("Não saiu");
    l.sendChat.mockReturnValue(true);
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(field().value).toBe("");
  });

  it("does not show the message before the room gives it back, and shows it when it does", async () => {
    live();
    const view = panel();
    await flush();
    talkTo("Ana Souza");
    type("Chegou?");
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(screen.queryByText("Chegou?")).toBeNull();
    live({ chat: [fromTeacher("u-1", "Chegou?")] });
    view.rerender(element());
    expect(conversation().getByText("Chegou?")).toBeDefined();
  });

  it("tells there is no connection and keeps the buttons off", async () => {
    live({ connected: false });
    panel();
    await flush();
    talkTo("Ana Souza");
    expect(conversation().getByText("Sem conexão. Reconectando…")).toBeDefined();
    type("Escrevi sem rede");
    expect((conversation().getByRole("button", { name: "Enviar só para Ana Souza" }) as HTMLButtonElement).disabled).toBe(true);
    expect((conversation().getByRole("button", { name: "Enviar para todos" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps the conversation open, with its history, when the student leaves the list of the online students", async () => {
    const l = live({ chat: [fromStudent("u-1", "Antes de sair")] });
    const view = panel();
    await flush();
    talkTo("Ana Souza");
    live({ chat: [fromStudent("u-1", "Antes de sair")], onlineStudents: ["u-2"], sendChat: l.sendChat });
    view.rerender(element());
    expect(names()).toEqual(["Bruno Lima"]);
    expect(conversation().getByRole("heading", { level: 3, name: "Conversa com Ana Souza" })).toBeDefined();
    expect(conversation().getByText("Antes de sair")).toBeDefined();
  });

  it("keeps the name of the student in the title even when he is no longer in the class", async () => {
    live();
    const view = panel();
    await flush();
    talkTo("Ana Souza");
    live({ admissions: { waiting: [], admitted: [bruno, carla] }, onlineStudents: ["u-2"] });
    view.rerender(element());
    expect(conversation().getByRole("heading", { level: 3, name: "Conversa com Ana Souza" })).toBeDefined();
  });

  it("makes no sound for a new message, which is only the counter (out of scope)", async () => {
    live();
    const view = panel();
    await flush();
    live({ chat: [fromStudent("u-1", "Oi")] });
    view.rerender(element());
    expect(card("Ana Souza").getByText("1 nova")).toBeDefined();
    expect(beep).not.toHaveBeenCalled();
  });
});

// SPEC-063 CA-07: the new messages of each student, which the panel counts while it is open
describe("TeacherPanel, the new messages", () => {
  it("counts the messages of a student that arrive after the panel opened, on his card, in words", async () => {
    const history = fromStudent("u-1", "Do histórico");
    const first = fromStudent("u-2", "Primeira");
    live({ chat: [history] });
    const view = panel();
    await flush();
    expect(counters()).toEqual([]);
    live({ chat: [history, first] });
    view.rerender(element());
    expect(card("Bruno Lima").getByText("1 nova")).toBeDefined();
    live({ chat: [history, first, fromStudent("u-2", "Segunda"), fromStudent("u-1", "Nova da Ana")] });
    view.rerender(element());
    expect(card("Bruno Lima").getByText("2 novas")).toBeDefined();
    expect(card("Ana Souza").getByText("1 nova")).toBeDefined();
  });

  it("does not count twice the same message when the room tells the same list again", async () => {
    const first = fromStudent("u-2", "Primeira");
    live({ chat: [] });
    const view = panel();
    await flush();
    live({ chat: [first] });
    view.rerender(element());
    live({ chat: [first] });
    view.rerender(element());
    live({ chat: [{ ...first }] });
    view.rerender(element());
    expect(counters()).toEqual(["1 nova"]);
  });

  it("counts the history that comes when the panel opens or is reloaded as read: nothing is new", async () => {
    live({ chat: [fromStudent("u-1", "Antiga 1"), fromStudent("u-1", "Antiga 2"), fromStudent("u-2", "Antiga 3")] });
    panel();
    await flush();
    expect(counters()).toEqual([]);
    cleanup();
    live({ chat: [fromStudent("u-1", "Antiga 1"), fromStudent("u-2", "Antiga 3")] });
    panel();
    await flush();
    expect(counters()).toEqual([]);
  });

  it("counts as read the history that comes with the first snapshot, after the room was not ready", async () => {
    const history = [fromStudent("u-1", "Antiga"), fromStudent("u-2", "Antiga")];
    live({ ready: false, chat: [] });
    const view = panel();
    await flush();
    live({ ready: true, chat: history });
    view.rerender(element());
    expect(counters()).toEqual([]);
    live({ ready: true, chat: [...history, fromStudent("u-2", "Nova")] });
    view.rerender(element());
    expect(counters()).toEqual(["1 nova"]);
  });

  it("counts only what the students write: not the teacher's messages, nor the ones for everybody", async () => {
    live();
    const view = panel();
    await flush();
    live({ chat: [fromTeacher("u-1", "Do professor"), toAll("Para todos")] });
    view.rerender(element());
    expect(counters()).toEqual([]);
  });

  it("zeroes the counter of the conversation that is opened, and only of that one", async () => {
    live();
    const view = panel();
    await flush();
    const chat = [fromStudent("u-1", "A1"), fromStudent("u-1", "A2"), fromStudent("u-2", "B1")];
    live({ chat });
    view.rerender(element());
    expect(card("Ana Souza").getByText("2 novas")).toBeDefined();
    expect(card("Bruno Lima").getByText("1 nova")).toBeDefined();
    talkTo("Ana Souza");
    expect(card("Ana Souza").queryByText(/nova/)).toBeNull();
    expect(card("Bruno Lima").getByText("1 nova")).toBeDefined();
  });

  it("counts as seen what arrives while the conversation is open, and it stays seen after the teacher goes to another one", async () => {
    live();
    const view = panel();
    await flush();
    talkTo("Ana Souza");
    const a1 = fromStudent("u-1", "Chegou aberta");
    live({ chat: [a1] });
    view.rerender(element());
    expect(counters()).toEqual([]);
    talkTo("Bruno Lima");
    expect(counters()).toEqual([]);
    const a2 = fromStudent("u-1", "Chegou fechada");
    live({ chat: [a1, a2] });
    view.rerender(element());
    expect(card("Ana Souza").getByText("1 nova")).toBeDefined();
  });

  it("counts the messages of the student again after the teacher leaves his conversation for the channel of the class", async () => {
    live();
    const view = panel();
    await flush();
    talkTo("Ana Souza");
    fireEvent.click(online().getByRole("button", { name: "Mensagem para todos" }));
    live({ chat: [fromStudent("u-1", "Escreveu enquanto eu falava para todos")] });
    view.rerender(element());
    expect(card("Ana Souza").getByText("1 nova")).toBeDefined();
  });

  it("puts the card with new messages above the ones with none", async () => {
    live({ onlineStudents: ["u-1", "u-2", "u-3"] });
    const view = panel();
    await flush();
    expect(names()).toEqual(["Ana Souza", "Bruno Lima", "Carla Dias"]);
    live({ onlineStudents: ["u-1", "u-2", "u-3"], chat: [fromStudent("u-3", "Oi")] });
    view.rerender(element());
    expect(names()).toEqual(["Carla Dias", "Ana Souza", "Bruno Lima"]);
    talkTo("Carla Dias");
    expect(names()).toEqual(["Ana Souza", "Bruno Lima", "Carla Dias"]);
  });
});
