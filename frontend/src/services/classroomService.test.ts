import { describe, expect, it, vi } from "vitest";
import { createClassroomService, liveSocketUrl, openLiveSocket } from "./classroomService";
import type { HttpClient } from "./httpClient";

// SPEC-051, section 5
describe("classroomService", () => {
  const client: HttpClient = { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() };
  const service = createClassroomService(client);

  it("starts or reopens the class (5.1)", async () => {
    vi.mocked(client.post).mockResolvedValueOnce({ id: "s-1", status: "ACTIVE" });
    const session = await service.startSession("c-1", { title: "Aula 5", deckId: "d-1", classSessionId: "cs-1" });
    expect(client.post).toHaveBeenCalledWith("/classes/c-1/live/start", { title: "Aula 5", deckId: "d-1", classSessionId: "cs-1" });
    expect(session.id).toBe("s-1");
  });

  it("ends the class (5.2)", async () => {
    vi.mocked(client.post).mockResolvedValueOnce({ id: "s-1", status: "FINISHED" });
    await service.endSession("c-1", "s-1");
    expect(client.post).toHaveBeenCalledWith("/classes/c-1/live/sessions/s-1/end");
  });

  it("uploads a deck as multipart with the page count read by the browser (5.3)", async () => {
    vi.mocked(client.post).mockResolvedValueOnce({ id: "d-1", title: "Slides", pageCount: 12, downloadUrl: "https://minio/x" });
    const file = new File(["%PDF-1.7"], "slides.pdf", { type: "application/pdf" });
    const deck = await service.uploadDeck("c-1", file, "Slides", 12);
    const [path, body] = vi.mocked(client.post).mock.calls.at(-1)!;
    expect(path).toBe("/classes/c-1/live/decks");
    const form = body as FormData;
    expect(form.get("title")).toBe("Slides");
    expect(form.get("pageCount")).toBe("12");
    expect((form.get("file") as File).name).toBe("slides.pdf");
    expect(deck.pageCount).toBe(12);
  });

  it("reads the active class (5.4), with or without a room", async () => {
    vi.mocked(client.get).mockResolvedValueOnce({ hasActiveSession: false });
    expect(await service.getActive("c-1")).toEqual({ hasActiveSession: false });
    expect(client.get).toHaveBeenCalledWith("/classes/c-1/live/active");
  });

  // SPEC-053 CA-13: the presentations of the class, the most recent first
  it("lists the presentations of the class", async () => {
    const decks = [{ id: "d-2", title: "Slides 2", pageCount: 8, createdAt: "2026-10-02" }, { id: "d-1", title: "Slides 1", pageCount: 12, createdAt: "2026-10-01" }];
    vi.mocked(client.get).mockResolvedValueOnce({ decks });
    expect(await service.listDecks("c-1")).toEqual(decks);
    expect(client.get).toHaveBeenCalledWith("/classes/c-1/live/decks");
  });

  it("lists the classes (5.5)", async () => {
    vi.mocked(client.get).mockResolvedValueOnce({ sessions: [{ id: "s-1", title: "Aula 5", status: "FINISHED" }] });
    expect(await service.listSessions("c-1")).toEqual([{ id: "s-1", title: "Aula 5", status: "FINISHED" }]);
    expect(client.get).toHaveBeenCalledWith("/classes/c-1/live/sessions");
  });

  it("saves and reads the notes (5.6, 5.7)", async () => {
    vi.mocked(client.put).mockResolvedValueOnce({ sessionId: "s-1", savedLength: 3, updatedAt: "x" });
    await service.saveNotes("c-1", "s-1", "abc");
    expect(client.put).toHaveBeenCalledWith("/classes/c-1/live/sessions/s-1/notes", { content: "abc" });
    vi.mocked(client.get).mockResolvedValueOnce({ sessionId: "s-1", content: "abc", updatedAt: "x" });
    expect((await service.getNotes("c-1", "s-1")).content).toBe("abc");
    expect(client.get).toHaveBeenLastCalledWith("/classes/c-1/live/sessions/s-1/notes");
  });

  // SPEC-065: the conference of the exercise of the live class, on the server
  it("sends the state of the machine of the student to be conferred, and gives back the verdict", async () => {
    vi.mocked(client.post).mockResolvedValueOnce({ passed: true, completedAt: "2026-10-14T10:01:00Z", elapsedSeconds: 60, points: 12 });
    const snapshot = { formato: "exame-so/maquina", versao: 1 };
    const verdict = await service.submitExercise("c-1", "r-1", snapshot);
    expect(client.post).toHaveBeenCalledWith("/classes/c-1/live/exercise/submit", { runId: "r-1", snapshot });
    expect(verdict).toEqual({ passed: true, completedAt: "2026-10-14T10:01:00Z", elapsedSeconds: 60, points: 12 });
  });
});

class FakeSocket {
  static last: FakeSocket;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public url: string) {
    FakeSocket.last = this;
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.onclose?.();
  }
}

// SPEC-051, section 5.8
describe("live socket", () => {
  it("builds the address from the page, on the same origin", () => {
    expect(liveSocketUrl("c-1", { protocol: "http:", host: "localhost:3010" })).toBe("ws://localhost:3010/api/v1/classes/c-1/live/ws");
    expect(liveSocketUrl("c-1", { protocol: "https:", host: "aulas.exemplo.br" })).toBe("wss://aulas.exemplo.br/api/v1/classes/c-1/live/ws");
  });

  // SPEC-055 RN-01: the window of the teacher goes in the address
  it("tells the window of the teacher in the address, and only when there is one", () => {
    const where = { protocol: "http:", host: "localhost:3010" };
    expect(liveSocketUrl("c-1", where, "presenter")).toBe("ws://localhost:3010/api/v1/classes/c-1/live/ws?view=presenter");
    expect(liveSocketUrl("c-1", where, "panel")).toBe("ws://localhost:3010/api/v1/classes/c-1/live/ws?view=panel");
    expect(liveSocketUrl("c-1", where)).toBe("ws://localhost:3010/api/v1/classes/c-1/live/ws");
    openLiveSocket("c-1", { onOpen: vi.fn(), onMessage: vi.fn(), onClose: vi.fn() }, (url) => new FakeSocket(url) as unknown as WebSocket, "presenter");
    expect(FakeSocket.last.url).toContain("/live/ws?view=presenter");
  });

  it("sends and receives messages as { type, data }", () => {
    const handlers = { onOpen: vi.fn(), onMessage: vi.fn(), onClose: vi.fn() };
    const socket = openLiveSocket("c-1", handlers, (url) => new FakeSocket(url) as unknown as WebSocket);
    const raw = FakeSocket.last;
    raw.onopen?.();
    expect(handlers.onOpen).toHaveBeenCalled();

    raw.readyState = 1;
    socket.send("live:slide:change", { slide: 3 });
    expect(JSON.parse(raw.sent[0]!)).toEqual({ type: "live:slide:change", data: { slide: 3 } });

    raw.onmessage?.({ data: JSON.stringify({ type: "live:presence", data: { online: 4 } }) });
    expect(handlers.onMessage).toHaveBeenCalledWith({ type: "live:presence", data: { online: 4 } });

    raw.onmessage?.({ data: "not json" });
    expect(handlers.onMessage).toHaveBeenCalledTimes(1);

    socket.close();
    expect(handlers.onClose).toHaveBeenCalled();
  });

  it("does not send while the connection is not open", () => {
    const socket = openLiveSocket("c-1", { onOpen: vi.fn(), onMessage: vi.fn(), onClose: vi.fn() }, (url) => new FakeSocket(url) as unknown as WebSocket);
    socket.send("live:hand:raise", {});
    expect(FakeSocket.last.sent).toEqual([]);
  });

  // SPEC-054, section 5: the module of the room, for the teacher and for the admitted student
  it("reads the module of the room, with its blocks and the first machine of its terminal", async () => {
    const http: HttpClient = { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() };
    const module_ = { moduleId: "m-1", title: "Permissões", blocks: [], scenario: { n: 1 } };
    vi.mocked(http.get).mockResolvedValueOnce(module_);
    expect(await createClassroomService(http).getLiveModule("c-1")).toEqual(module_);
    expect(http.get).toHaveBeenCalledWith("/classes/c-1/live/module");
  });
});

// SPEC-067 section 5: the open rooms of the classes of the student
describe("classroomService, the live classes of the student", () => {
  const http: HttpClient = { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() };

  // CA-01
  it("lists the open rooms of the classes of the student", async () => {
    const items = [{ classId: "c-1", className: "Turma A", sessionId: "s-1", title: "Aula 1", startedAt: "2026-10-15T19:00:00Z" }];
    vi.mocked(http.get).mockResolvedValueOnce({ items });
    expect(await createClassroomService(http).listMyLive()).toEqual(items);
    expect(http.get).toHaveBeenCalledWith("/me/live");
  });

  // CA-02
  it("gives an empty list when no class is live", async () => {
    vi.mocked(http.get).mockResolvedValueOnce({ items: [] });
    expect(await createClassroomService(http).listMyLive()).toEqual([]);
  });
});

// SPEC-068 section 5: an image is sent with no page count, and the list tells the kind
describe("classroomService, files sent with the class going on", () => {
  const http: HttpClient = { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() };

  it("uploads an image with no page count", async () => {
    vi.mocked(http.post).mockResolvedValueOnce({ id: "d-2", title: "Esquema", pageCount: 1, kind: "IMAGE", downloadUrl: "https://minio/e.png" });
    const file = new File(["x"], "esquema.png", { type: "image/png" });
    const deck = await createClassroomService(http).uploadDeck("c-1", file, "Esquema");
    const [path, body] = vi.mocked(http.post).mock.calls.at(-1)!;
    expect(path).toBe("/classes/c-1/live/decks");
    const form = body as FormData;
    expect(form.get("title")).toBe("Esquema");
    expect(form.has("pageCount")).toBe(false);
    expect((form.get("file") as File).name).toBe("esquema.png");
    expect(deck.kind).toBe("IMAGE");
  });

  it("lists the presentations with their kind", async () => {
    const decks = [{ id: "d-2", title: "Esquema", pageCount: 1, kind: "IMAGE", createdAt: "2026-10-15" }];
    vi.mocked(http.get).mockResolvedValueOnce({ decks });
    expect(await createClassroomService(http).listDecks("c-1")).toEqual(decks);
  });
});
