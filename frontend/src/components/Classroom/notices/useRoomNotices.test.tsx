import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { HandRaiseItem, LiveChatMessage } from "@/services/classroomService";
import type { BrowserNotice, NoticeContent, NoticePermission } from "./browserNotice";
import { useRoomNotices, type RoomNoticesInput } from "./useRoomNotices";

const NAMES: Record<string, string> = { "u-1": "Ana Souza", "u-2": "Bruno Lima", "u-3": "Carla Dias" };

/** The access to the browser, as a double. `state` is what the browser says now: tests change it between two lists. */
function browser(initial: { permission?: NoticePermission; inView?: boolean } = {}) {
  const state = { permission: initial.permission ?? ("granted" as NoticePermission), inView: initial.inView ?? false };
  const notice = {
    permission: vi.fn(() => state.permission),
    requestPermission: vi.fn(async () => state.permission),
    inView: vi.fn(() => state.inView),
    show: vi.fn<(content: NoticeContent) => void>(),
  } satisfies BrowserNotice;
  return { notice, state };
}

let seq = 0;
const message = (over: Partial<LiveChatMessage> & Pick<LiveChatMessage, "from" | "text">): LiveChatMessage =>
  ({ id: `m-${++seq}`, scope: "private", studentId: "u-1", createdAt: "2026-10-14T10:00:00Z", ...over }) as LiveChatMessage;
const fromStudent = (studentId: string, text: string, id?: string) => message({ from: "STUDENT", studentId, text, ...(id ? { id } : {}) });
const toStudent = (studentId: string, text: string) => message({ from: "TEACHER", studentId, text });
const toAll = (text: string) => ({ id: `m-${++seq}`, scope: "all", from: "TEACHER", text, createdAt: "2026-10-14T10:00:00Z" }) as LiveChatMessage;
const hand = (studentId: string, question = ""): HandRaiseItem => ({ studentId, name: NAMES[studentId]!, requestedAt: "2026-10-14T10:00:00Z", question });

function setup(role: "teacher" | "student", over: Partial<RoomNoticesInput> = {}, access = browser()) {
  const onOpen = vi.fn();
  const initial: RoomNoticesInput = { role, chat: [], hands: [], ready: true, enabled: true, nameOf: (id) => NAMES[id] ?? "", onOpen, notice: access.notice, ...over };
  const view = renderHook((props: RoomNoticesInput) => useRoomNotices(props), { initialProps: initial });
  let last: Partial<RoomNoticesInput> = {};
  /** The room tells a new list: what changes is given, the rest stays as it was. */
  const give = (next: Partial<RoomNoticesInput>) => {
    last = { ...last, ...next };
    view.rerender({ ...initial, ...last });
  };
  return { ...access, onOpen, give };
}

type Setup = ReturnType<typeof setup>;
const calls = (t: Setup) => t.notice.show.mock.calls.map(([content]) => content);

// SPEC-064 CA-04: what the first list brings is history, and nobody is told about it
describe("useRoomNotices, the first list", () => {
  it("does not notify the hands and the messages that come with the first snapshot, which is what the person finds on entering or reloading", () => {
    const t = setup("teacher", { chat: [fromStudent("u-1", "Antiga")], hands: [hand("u-2", "Velha dúvida")] });
    expect(t.notice.show).not.toHaveBeenCalled();
  });

  it("waits for the room to be ready: the list that comes with the first snapshot is the history, and only what comes after is new", () => {
    const old = fromStudent("u-1", "Antiga");
    const t = setup("teacher", { ready: false, chat: [], hands: [] });
    t.give({ ready: true, chat: [old], hands: [hand("u-2")] });
    expect(t.notice.show).not.toHaveBeenCalled();
    t.give({ chat: [old, fromStudent("u-1", "Nova")] });
    expect(calls(t).map((c) => c.body)).toEqual(["Nova"]);
  });

  it("notifies nothing while the room is not ready, whatever the lists say", () => {
    const t = setup("teacher", { ready: false });
    t.give({ chat: [fromStudent("u-1", "Cedo")], hands: [hand("u-1")] });
    expect(t.notice.show).not.toHaveBeenCalled();
  });

  it("notifies no student of the history of the teacher either", () => {
    const t = setup("student", { chat: [toAll("Antiga"), toStudent("u-1", "Antiga")] });
    expect(t.notice.show).not.toHaveBeenCalled();
  });
});

// SPEC-064 CA-01, CA-02, CA-07
describe("useRoomNotices, the teacher", () => {
  it("notifies a student whose hand goes up, with the name, and with the doubt when there is one", () => {
    const t = setup("teacher");
    t.give({ hands: [hand("u-1", "Como uso o chmod?")] });
    expect(calls(t)).toEqual([expect.objectContaining({ title: "Mão levantada", body: "Ana Souza levantou a mão: Como uso o chmod?", tag: "hand-u-1" })]);
  });

  it("tells a hand with no doubt without the colon", () => {
    const t = setup("teacher");
    t.give({ hands: [hand("u-2", "")] });
    expect(calls(t)).toEqual([expect.objectContaining({ title: "Mão levantada", body: "Bruno Lima levantou a mão", tag: "hand-u-2" })]);
    t.give({ hands: [hand("u-2", ""), { studentId: "u-3", name: "Carla Dias", requestedAt: "2026-10-14T10:01:00Z" }] });
    expect(calls(t)[1]).toEqual(expect.objectContaining({ body: "Carla Dias levantou a mão" }));
  });

  it("uses the name the line of hands gives, which is the one of the student", () => {
    const t = setup("teacher", { nameOf: () => "" });
    t.give({ hands: [{ studentId: "u-9", name: "Davi Rocha", requestedAt: "2026-10-14T10:00:00Z" }] });
    expect(calls(t)[0]!.body).toBe("Davi Rocha levantou a mão");
  });

  it("notifies a message of a student, with his name and the text", () => {
    const t = setup("teacher");
    const written = fromStudent("u-2", "Posso ir ao banheiro?", "m-x1");
    t.give({ chat: [written] });
    expect(calls(t)).toEqual([expect.objectContaining({ title: "Mensagem de Bruno Lima", body: "Posso ir ao banheiro?", tag: "chat-m-x1" })]);
  });

  it("gives the text of the message as it came, with no template and no HTML made of it", () => {
    const t = setup("teacher");
    t.give({ chat: [fromStudent("u-1", "<b>oi</b> {{x}} ${y}")] });
    expect(calls(t)[0]!.body).toBe("<b>oi</b> {{x}} ${y}");
  });

  it("says 'um aluno' when it cannot tell whose the message is", () => {
    const t = setup("teacher", { nameOf: () => "" });
    t.give({ chat: [fromStudent("u-9", "Oi")] });
    expect(calls(t)[0]!.title).toBe("Mensagem de um aluno");
  });

  it("opens the conversation of the student when the notice of his hand is clicked", () => {
    const t = setup("teacher");
    t.give({ hands: [hand("u-3")] });
    expect(t.onOpen).not.toHaveBeenCalled();
    calls(t)[0]!.onClick!();
    expect(t.onOpen).toHaveBeenCalledTimes(1);
    expect(t.onOpen).toHaveBeenCalledWith("u-3");
  });

  it("opens the conversation of the student when the notice of his message is clicked", () => {
    const t = setup("teacher");
    t.give({ chat: [fromStudent("u-2", "Oi")] });
    calls(t)[0]!.onClick!();
    expect(t.onOpen).toHaveBeenCalledTimes(1);
    expect(t.onOpen).toHaveBeenCalledWith("u-2");
  });

  it("does not notify what the teacher himself writes, for one student or for everybody", () => {
    const t = setup("teacher");
    t.give({ chat: [toStudent("u-1", "Veja o man"), toAll("Prova na sexta")] });
    expect(t.notice.show).not.toHaveBeenCalled();
  });

  it("notifies the new messages and leaves the old ones, in the order they came", () => {
    const old = fromStudent("u-1", "Antiga");
    const t = setup("teacher", { chat: [old] });
    t.give({ chat: [old, fromStudent("u-2", "Segunda"), toStudent("u-1", "Resposta"), fromStudent("u-1", "Terceira")] });
    expect(calls(t).map((c) => c.body)).toEqual(["Segunda", "Terceira"]);
  });
});

// SPEC-064 CA-03
describe("useRoomNotices, the student", () => {
  it("notifies a message of the teacher for him alone, with the title 'Professor'", () => {
    const t = setup("student");
    const written = toStudent("u-1", "Veja o man");
    t.give({ chat: [written] });
    expect(calls(t)).toEqual([expect.objectContaining({ title: "Professor", body: "Veja o man", tag: `chat-${written.id}` })]);
  });

  it("notifies a message of the teacher for everybody, with the title 'Professor · para todos'", () => {
    const t = setup("student");
    const written = toAll("Prova na sexta");
    t.give({ chat: [written] });
    expect(calls(t)).toEqual([expect.objectContaining({ title: "Professor · para todos", body: "Prova na sexta", tag: `chat-${written.id}` })]);
  });

  it("does not notify the student of his own messages, which the server gives back to him", () => {
    const t = setup("student");
    t.give({ chat: [fromStudent("u-1", "Minha dúvida")] });
    expect(t.notice.show).not.toHaveBeenCalled();
  });

  it("does not notify the student of the hands of the others, nor of his own", () => {
    const t = setup("student");
    t.give({ hands: [hand("u-2", "Dúvida do Bruno")] });
    t.give({ hands: [hand("u-2", "Dúvida do Bruno"), hand("u-1")] });
    t.give({ hands: [] });
    expect(t.notice.show).not.toHaveBeenCalled();
  });

  it("asks to open the conversation when the notice is clicked", () => {
    const t = setup("student");
    t.give({ chat: [toAll("Atenção")] });
    calls(t)[0]!.onClick!();
    expect(t.onOpen).toHaveBeenCalledTimes(1);
  });
});

// SPEC-064 CA-04: a thing is new once
describe("useRoomNotices, what is new", () => {
  it("does not notify the same message again when the room gives the same list again", () => {
    const written = fromStudent("u-1", "Oi");
    const t = setup("teacher");
    t.give({ chat: [written] });
    t.give({ chat: [written] });
    t.give({ chat: [{ ...written }] });
    expect(t.notice.show).toHaveBeenCalledTimes(1);
  });

  it("does not notify the same student again when he changes the doubt of the hand that is already up", () => {
    const t = setup("teacher");
    t.give({ hands: [hand("u-1", "")] });
    t.give({ hands: [hand("u-1", "Agora com dúvida")] });
    t.give({ hands: [hand("u-1", "Outra dúvida")] });
    expect(t.notice.show).toHaveBeenCalledTimes(1);
  });

  it("does not notify a hand that goes down", () => {
    const t = setup("teacher", { hands: [hand("u-1"), hand("u-2")] });
    t.give({ hands: [hand("u-2")] });
    t.give({ hands: [] });
    expect(t.notice.show).not.toHaveBeenCalled();
  });

  it("notifies a hand that goes down and up again, since it is a new hand", () => {
    const t = setup("teacher");
    t.give({ hands: [hand("u-1")] });
    t.give({ hands: [] });
    t.give({ hands: [hand("u-1")] });
    expect(t.notice.show).toHaveBeenCalledTimes(2);
  });

  it("notifies the new hand of one student and not the hand that was already up", () => {
    const t = setup("teacher", { hands: [hand("u-1")] });
    t.give({ hands: [hand("u-1"), hand("u-2", "Dúvida")] });
    expect(calls(t).map((c) => c.tag)).toEqual(["hand-u-2"]);
  });

  it("notifies the hand and the message that come in the same list", () => {
    const t = setup("teacher");
    t.give({ hands: [hand("u-1")], chat: [fromStudent("u-2", "Oi")] });
    expect(calls(t).map((c) => c.title)).toEqual(["Mão levantada", "Mensagem de Bruno Lima"]);
  });
});

// SPEC-064 CA-04: with the page in view, with the notices off, blocked or unavailable
describe("useRoomNotices, when it does not notify", () => {
  it("does not notify with the page in view and in focus", () => {
    const t = setup("teacher", {}, browser({ inView: true }));
    t.give({ chat: [fromStudent("u-1", "Oi")], hands: [hand("u-2")] });
    expect(t.notice.show).not.toHaveBeenCalled();
  });

  it("takes what came with the page in view as seen: it is not told when the person goes away", () => {
    const t = setup("teacher");
    const seen = fromStudent("u-1", "Eu vi");
    t.state.inView = true;
    t.give({ chat: [seen], hands: [hand("u-2")] });
    t.state.inView = false;
    t.give({ chat: [seen], hands: [hand("u-2")] });
    expect(t.notice.show).not.toHaveBeenCalled();
    t.give({ chat: [seen, fromStudent("u-1", "Não vi")] });
    expect(calls(t).map((c) => c.body)).toEqual(["Não vi"]);
  });

  it("does not notify with the notices off, and does not tell later what came while they were off", () => {
    const t = setup("teacher", { enabled: false });
    const early = fromStudent("u-1", "Chegou desligado");
    t.give({ chat: [early], hands: [hand("u-2")] });
    t.give({ enabled: true });
    expect(t.notice.show).not.toHaveBeenCalled();
    t.give({ chat: [early, fromStudent("u-1", "Chegou ligado")] });
    expect(calls(t).map((c) => c.body)).toEqual(["Chegou ligado"]);
  });

  it.each(["default", "denied", "unsupported"] as const)("does not notify when the permission is %s", (permission) => {
    const t = setup("teacher", {}, browser({ permission }));
    t.give({ chat: [fromStudent("u-1", "Oi")], hands: [hand("u-2")] });
    expect(t.notice.show).not.toHaveBeenCalled();
  });

  it("notifies as soon as the permission is given, only for what comes after", () => {
    const t = setup("teacher", {}, browser({ permission: "default" }));
    const early = fromStudent("u-1", "Sem permissão");
    t.give({ chat: [early] });
    t.state.permission = "granted";
    t.give({ chat: [early, fromStudent("u-1", "Com permissão")] });
    expect(calls(t).map((c) => c.body)).toEqual(["Com permissão"]);
  });

  it("notifies again when the person goes to another window and the page leaves the view", () => {
    const t = setup("teacher", {}, browser({ inView: true }));
    const near = fromStudent("u-1", "À vista");
    t.give({ chat: [near] });
    t.state.inView = false;
    t.give({ chat: [near, fromStudent("u-1", "Longe")] });
    expect(calls(t).map((c) => c.body)).toEqual(["Longe"]);
  });
});

// SPEC-064 CA-04: the room that comes back after a loss of the connection
describe("useRoomNotices, the reconnection", () => {
  it("notifies only the new messages when the snapshot of the reconnection brings the history again with some more", () => {
    const first = fromStudent("u-1", "Um");
    const second = fromStudent("u-2", "Dois");
    const t = setup("teacher", { chat: [first, second] });
    t.give({ chat: [{ ...first }, { ...second }, fromStudent("u-1", "Três, que chegou com a rede fora")] });
    expect(calls(t).map((c) => c.body)).toEqual(["Três, que chegou com a rede fora"]);
  });

  it("does not take the history for new when the list comes empty and then whole again", () => {
    const first = fromStudent("u-1", "Um");
    const second = fromStudent("u-2", "Dois");
    const t = setup("teacher", { chat: [first, second] });
    t.give({ chat: [] });
    t.give({ chat: [first, second] });
    expect(t.notice.show).not.toHaveBeenCalled();
  });

  it("keeps what it had seen if the room stops being ready and is ready again", () => {
    const first = fromStudent("u-1", "Um");
    const t = setup("teacher", { chat: [first] });
    t.give({ ready: false });
    t.give({ ready: true, chat: [first, fromStudent("u-1", "Dois")] });
    expect(calls(t).map((c) => c.body)).toEqual(["Dois"]);
  });

  it("notifies the hand raised while the connection was out, and not the ones that were already up", () => {
    const t = setup("teacher", { hands: [hand("u-1")] });
    t.give({ hands: [hand("u-1"), hand("u-3", "Perdi o começo")] });
    expect(calls(t).map((c) => c.tag)).toEqual(["hand-u-3"]);
  });
});

// SPEC-064 section 6: a flood is told in three notices and a word about the rest
describe("useRoomNotices, many things at once", () => {
  const many = (count: number) => Array.from({ length: count }, (_, i) => hand(`u-${i + 10}`));

  it("shows one notice for each of up to 3 new things in an update", () => {
    const t = setup("teacher");
    t.give({ hands: many(3) });
    expect(calls(t)).toHaveLength(3);
    expect(calls(t).every((c) => c.title === "Mão levantada")).toBe(true);
  });

  it("shows 3 notices and one that says 'e mais N avisos' when there are more", () => {
    const t = setup("teacher");
    t.give({ hands: many(6) });
    const shown = calls(t);
    expect(shown).toHaveLength(4);
    expect(shown.slice(0, 3).map((c) => c.tag)).toEqual(["hand-u-10", "hand-u-11", "hand-u-12"]);
    expect(shown[3]).toEqual(expect.objectContaining({ title: "Aula ao vivo", body: "e mais 3 avisos", tag: "more" }));
  });

  it("says 'e mais 1 aviso' in the singular", () => {
    const t = setup("teacher");
    t.give({ hands: many(4) });
    expect(calls(t)[3]!.body).toBe("e mais 1 aviso");
  });

  it("counts the hands and the messages of the same update together", () => {
    const t = setup("teacher");
    t.give({ hands: [hand("u-1"), hand("u-2")], chat: [fromStudent("u-1", "A"), fromStudent("u-2", "B"), fromStudent("u-3", "C")] });
    const shown = calls(t);
    expect(shown.map((c) => c.tag.split("-")[0])).toEqual(["hand", "hand", "chat", "more"]);
    expect(shown[3]!.body).toBe("e mais 2 avisos");
  });

  it("counts each update by itself: the limit is not for the whole class", () => {
    const t = setup("teacher");
    t.give({ hands: many(3) });
    t.give({ hands: many(6) });
    expect(calls(t)).toHaveLength(3 + 3);
    t.give({ chat: [fromStudent("u-1", "A"), fromStudent("u-1", "B")] });
    expect(calls(t)).toHaveLength(8);
  });

  it("limits the messages of the teacher to the student the same way", () => {
    const t = setup("student");
    t.give({ chat: [toAll("1"), toAll("2"), toAll("3"), toAll("4"), toAll("5")] });
    const shown = calls(t);
    expect(shown.map((c) => c.body)).toEqual(["1", "2", "3", "e mais 2 avisos"]);
  });
});
