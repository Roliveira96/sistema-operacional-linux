import type { ContentBlock } from "./contentService";
import type { ScreenElement } from "@/engine/terminalScreen";
import { httpClient, type HttpClient } from "./httpClient";

// Live classroom API client and socket (SPEC-051, section 5).

export type LiveMode = "SLIDES" | "MODULE";

export interface LiveSession {
  id: string;
  classId: string;
  title: string;
  classSessionId?: string | null;
  status: "ACTIVE" | "FINISHED";
  displayMode: LiveMode;
  currentSlide: number;
  startedAt: string;
  endedAt?: string | null;
}

export interface LiveDeck {
  id: string;
  title: string;
  pageCount: number;
  /** Signed address of the PDF, valid for 15 minutes. */
  downloadUrl: string;
}

/** A stroke or a clear command of the pen on a slide; the points are percentages of the slide, from 0 to 100. */
export interface LiveStroke {
  path?: Array<[number, number]>;
  clear?: boolean;
}

export interface HandRaiseItem {
  studentId: string;
  name: string;
  requestedAt: string;
}

/** The mouse of the teacher on the stage: percentages, of the whole page on the slides and of the stage on the module (SPEC-057). */
export interface LiveCursor {
  x: number;
  y: number;
  laser: boolean;
  visible: boolean;
}

/**
 * The stretch of text the teacher selected (SPEC-057). On the material it is told by block (`data-block`) and by characters in the text of the block;
 * on the terminal, by the number of the terminal and by characters over the text of the last picture of the window. Exactly these fields, no more.
 */
export type StageSelection =
  | { pane: "material"; start: { block: string; offset: number }; end: { block: string; offset: number } }
  | { pane: "terminal"; terminal: number; start: number; end: number };

/**
 * Where the teacher is on the stage (SPEC-057): the scroll of the slide down and sideways and of the material, as fractions of what can be scrolled;
 * the part of the stage the material takes (null: the default of the layout); the zoom, from 1 to 2; and the text he selected (null: none).
 */
export interface StageView {
  slideScroll: number;
  slideScrollX: number;
  materialScroll: number;
  split: number | null;
  zoom: number;
  selection: StageSelection | null;
}

export interface LiveTerminalState {
  /** The last picture of the teacher's terminal window, or null while he has sent none (SPEC-056). */
  screen: ScreenElement | null;
}

/** The whole state of an open room: the answer of "active" and the first message of every connection (RN-07). */
/** Where a student stands in a live class: waiting for the teacher, accepted, or removed (SPEC-054). */
export type AdmissionState = "WAITING" | "ADMITTED" | "REMOVED";

export interface AdmissionEntry {
  studentId: string;
  name: string;
  requestedAt?: string;
}

/** Who waits and who is in the class, as the teacher sees it (SPEC-054 CA-06). */
export interface LiveAdmissions {
  waiting: AdmissionEntry[];
  admitted: AdmissionEntry[];
}

/** The module of the live class: its blocks and the first machine of its terminal (SPEC-054, section 5). */
export interface LiveModuleContent {
  moduleId: string;
  title: string;
  blocks: ContentBlock[];
  scenario: unknown;
  setup?: unknown;
}

export interface LiveSnapshot {
  hasActiveSession: true;
  session: LiveSession;
  displayMode: LiveMode;
  currentSlide: number;
  activeModuleId?: string | null;
  moduleId?: string | null;
  moduleFocusBlockId?: string | null;
  /** The teacher keeps the stage blank (SPEC-055 CA-17). */
  stageBlank?: boolean;
  /** Where the teacher is on the stage (SPEC-057). */
  stageView?: StageView;
  /** Only the panel of the teacher gets these (SPEC-055 RN-05). */
  admissions?: LiveAdmissions;
  startedAt?: string;
  presenterConnected?: boolean;
  activeDeck: LiveDeck | null;
  recentDrawings: LiveStroke[];
  terminal: LiveTerminalState;
  handRaises: HandRaiseItem[];
  onlineCount: number;
}

export type ActiveRoom = { hasActiveSession: false } | LiveSnapshot;

export interface LiveSessionSummary {
  id: string;
  title: string;
  status: "ACTIVE" | "FINISHED";
  startedAt: string;
  endedAt?: string | null;
  durationMinutes?: number | null;
  classSessionId?: string | null;
  hasNotes?: boolean;
}

/** A presentation of the class, as the list gives it (SPEC-053 CA-13). */
export interface DeckSummary {
  id: string;
  title: string;
  pageCount: number;
  createdAt: string;
}

export interface StartSessionInput {
  title: string;
  classSessionId?: string;
  deckId?: string;
  initialModuleId?: string;
}

export interface LiveNote {
  sessionId: string;
  content: string;
  updatedAt: string;
}

/** Live classroom REST client (SPEC-051, sections 5.1 to 5.7). */
export function createClassroomService(client: HttpClient = httpClient) {
  const live = (classId: string) => `/classes/${classId}/live`;
  return {
    startSession: (classId: string, input: StartSessionInput) => client.post<LiveSession>(`${live(classId)}/start`, input),
    endSession: (classId: string, sessionId: string) =>
      client.post<{ id: string; status: "FINISHED"; endedAt: string }>(`${live(classId)}/sessions/${sessionId}/end`),
    uploadDeck: (classId: string, file: File, title: string, pageCount: number) => {
      const form = new FormData();
      form.set("file", file);
      form.set("title", title);
      form.set("pageCount", String(pageCount));
      return client.post<LiveDeck>(`${live(classId)}/decks`, form);
    },
    listDecks: async (classId: string) => (await client.get<{ decks: DeckSummary[] }>(`${live(classId)}/decks`)).decks,
    getActive: (classId: string) => client.get<ActiveRoom>(`${live(classId)}/active`),
    getLiveModule: (classId: string) => client.get<LiveModuleContent>(`${live(classId)}/module`),
    listSessions: async (classId: string) =>
      (await client.get<{ sessions: LiveSessionSummary[] }>(`${live(classId)}/sessions`)).sessions,
    saveNotes: (classId: string, sessionId: string, content: string) =>
      client.put<{ sessionId: string; savedLength: number; updatedAt: string }>(`${live(classId)}/sessions/${sessionId}/notes`, { content }),
    getNotes: (classId: string, sessionId: string) => client.get<LiveNote>(`${live(classId)}/sessions/${sessionId}/notes`),
  };
}

export type ClassroomService = ReturnType<typeof createClassroomService>;
export const classroomService = createClassroomService();

// ---- Real time (section 5.8) ----

/** A message of the socket: the name (`live:...`) and its data. */
export interface LiveMessage {
  type: string;
  data: unknown;
}

export interface LiveSocketHandlers {
  onOpen(): void;
  onMessage(message: LiveMessage): void;
  onClose(): void;
}

export interface LiveSocket {
  send(type: string, data: unknown): void;
  close(): void;
}

/** The window of the teacher a connection belongs to (SPEC-055 RN-01). */
export type LiveView = "panel" | "presenter";

/** The address of the socket of a class: the same origin as the page, under /api/v1; the teacher says which window it is. */
export function liveSocketUrl(classId: string, where: { protocol: string; host: string }, view?: LiveView): string {
  const scheme = where.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${where.host}/api/v1/classes/${classId}/live/ws${view ? `?view=${view}` : ""}`;
}

/** Opens the socket of the class. A message that is not JSON is ignored (the server is not trusted blindly either). */
export function openLiveSocket(
  classId: string,
  handlers: LiveSocketHandlers,
  create: (url: string) => WebSocket = (url) => new WebSocket(url),
  view?: LiveView,
): LiveSocket {
  const socket = create(liveSocketUrl(classId, window.location, view));
  socket.onopen = () => handlers.onOpen();
  socket.onclose = () => handlers.onClose();
  socket.onmessage = (event) => {
    try {
      const message = JSON.parse(String(event.data)) as LiveMessage;
      if (typeof message.type === "string") handlers.onMessage(message);
    } catch {
      /* not a message of the room */
    }
  };
  return {
    send(type, data) {
      if (socket.readyState === 1) socket.send(JSON.stringify({ type, data }));
    },
    close: () => socket.close(),
  };
}
