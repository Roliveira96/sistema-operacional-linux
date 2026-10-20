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

/** What a presentation is: a PDF, whose pages are the slides, or one image (SPEC-068). */
export type DeckKind = "PDF" | "IMAGE";

export interface LiveDeck {
  id: string;
  title: string;
  pageCount: number;
  /** A presentation that does not say its kind is a PDF. */
  kind?: DeckKind;
  /** Signed address of the file, valid for 15 minutes. */
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
  /** The doubt that came with the hand, empty with none (SPEC-058). Only the panel of the teacher gets it: the students and the presentation window do not. */
  question?: string;
}

/** The hand of the student himself and his doubt, which the room gives back at every connection so his screen can show them again (SPEC-058 CA-07). */
export interface MyHand {
  raised: boolean;
  question: string;
}

/** The longest doubt that goes with a hand, in characters and not in bytes, as the server takes it (SPEC-058). */
export const HAND_QUESTION_MAX = 300;

/** The longest text of a message of the class chat, in characters (SPEC-063). */
export const CHAT_MAX = 500;

/**
 * A message of the class chat (SPEC-063): for everybody, or in the private conversation of a student, whoever wrote it. `studentId` is the owner of
 * the conversation and only a private message has it.
 */
export interface LiveChatMessage {
  id: string;
  scope: "all" | "private";
  studentId?: string;
  from: "TEACHER" | "STUDENT";
  text: string;
  createdAt: string;
}

/** Where the teacher's message goes: to the whole class, or only to one student. */
export type ChatTarget = "all" | { studentId: string };

/** The level of an exercise, which gives its points (SPEC-065). */
export type ExerciseDifficulty = "EASY" | "MEDIUM" | "HARD";

/** One line of the scoreboard of a round: who finished, how long it took and what it was worth. */
export interface ExerciseScoreRow {
  studentId: string;
  name: string;
  elapsedSeconds: number;
  points: number;
}

/** The result of a round, which the teacher shows to the students or hides again (SPEC-065). */
export interface ExerciseResultBody {
  runId: string;
  visible: boolean;
  completed: number;
  participants: number;
  scoreboard: ExerciseScoreRow[];
}

/** What a student made of the round, which only he and the panel are told. */
export interface ExerciseMyResult {
  completedAt: string;
  elapsedSeconds: number;
  points: number;
}

/** What the panel knows of a student in the round: how far he is, his last command, and how he ended it when he did. */
export interface ExerciseProgressEntry {
  studentId: string;
  name?: string;
  met: number;
  total: number;
  last: string;
  at: string;
  completedAt?: string;
  elapsedSeconds?: number;
  points?: number;
  attempts?: number;
  /** SPEC-071: how many commands he ran and when the last one came (RN-09, RN-10). */
  commands?: number;
  lastCommandAt?: string;
  /** SPEC-071 RN-08: IN_PROGRESS, COMPLETED or NOT_COMPLETED. */
  status?: "IN_PROGRESS" | "COMPLETED" | "NOT_COMPLETED";
  /** He raised his hand during the round. */
  helpRequested?: boolean;
  /** The teacher took over his terminal in the round, so he gets no points (RN-07). */
  takenOver?: boolean;
}

/** The round of a practical exercise of the live class, as the room tells it (SPEC-065). There is one at a time; the last one stays until the next. */
export interface LiveExercise {
  runId: string;
  blockId: string;
  /** The position of the exercise among the `items` of the block. */
  index: number;
  title: string;
  difficulty: ExerciseDifficulty;
  durationSeconds: number;
  startedAt: string;
  endsAt: string;
  /** SPEC-071 section 3.1: running, paused, ended (the students still in the area, the terminal locked) and closed (the class went back to the lesson). */
  status: "RUNNING" | "PAUSED" | "ENDED" | "CLOSED";
  /** The seconds of the pauses that ended. */
  pausedSeconds?: number;
  /** When the class went back to the lesson. */
  closedAt?: string;
  endedBy?: "TIMER" | "TEACHER" | "SESSION";
  endedAt?: string;
  resultVisible: boolean;
  /** The scoreboard, only while the teacher shows the result. */
  result?: ExerciseResultBody;
  /** The student's own result; null while he has none. */
  myResult?: ExerciseMyResult | null;
  /** The time of the server minus the time of this browser, when the room last told it: add it to `Date.now()` to count the time left by the clock of the server. */
  skewMs: number;
}

/** What the server says of the state a student sent: it never says which conditions are missing. */
export interface ExerciseVerdict {
  passed: boolean;
  completedAt?: string;
  elapsedSeconds?: number;
  points?: number;
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
 * the part of the stage the material takes (null: the default of the layout); the zoom, from 1 to 2; the text he selected (null: none); and whether
 * he asked the students to go full screen (SPEC-059).
 */
export interface StageView {
  slideScroll: number;
  slideScrollX: number;
  materialScroll: number;
  split: number | null;
  zoom: number;
  selection: StageSelection | null;
  /** Where the teacher has the history of each terminal, by number ("1" to "3"), as a fraction of what can be scrolled; a terminal that is not in it is at the end. */
  terminalScroll: Record<string, number>;
  /** The teacher asked the students to go full screen (SPEC-059); absent is the same as off. */
  fullscreen?: boolean;
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
  /** Only the student gets this: his own hand and doubt (SPEC-058). */
  myHand?: MyHand;
  /** Only the panel of the teacher gets these (SPEC-055 RN-05). */
  admissions?: LiveAdmissions;
  startedAt?: string;
  presenterConnected?: boolean;
  activeDeck: LiveDeck | null;
  recentDrawings: LiveStroke[];
  terminal: LiveTerminalState;
  handRaises: HandRaiseItem[];
  onlineCount: number;
  /** The history of the chat for who is asking: the student's own conversation and the messages for everybody, or all of them for the panel (SPEC-063). */
  chat?: LiveChatMessage[];
  /** Only the panel gets this: the admitted students who are in the room (SPEC-063). */
  onlineStudents?: string[];
  /** The round of the practical exercise, with the extras of who is asking (SPEC-065): null when the class had none. Read by the hook, which checks its shape. */
  exercise?: Record<string, unknown> | null;
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
  kind?: DeckKind;
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

/** An atomic Markdown note block of the student for a live class session (SPEC-071). */
export interface LiveNoteBlock {
  id: string;
  contentMarkdown: string;
  createdAt: string;
  updatedAt: string;
}

export interface NoteImageUploadMeta {
  fileName?: string;
  width?: number;
  height?: number;
}

export interface NoteImageCreated {
  imageId: string;
  accessUrl: string;
}

/** An open room of a class of the student: what the notice of the live class needs (SPEC-067 section 5). */
export interface MyLiveRoom {
  classId: string;
  className: string;
  sessionId: string;
  title: string;
  startedAt: string;
}

/** A command the teacher ran in the presentation window of a live classroom, as the server kept it (SPEC-073). */
export interface LiveTerminalCommand {
  terminal: number;
  command: string;
  /** null when the command was interrupted and had no exit status. */
  exitStatus: number | null;
  output: string;
  outputTruncated: boolean;
  ranAt: string;
}

/** Live classroom REST client (SPEC-051, sections 5.1 to 5.7; SPEC-071, sections 5.1 to 5.5). */
export function createClassroomService(client: HttpClient = httpClient) {
  const live = (classId: string) => `/classes/${classId}/live`;
  return {
    startSession: (classId: string, input: StartSessionInput) => client.post<LiveSession>(`${live(classId)}/start`, input),
    endSession: (classId: string, sessionId: string) =>
      client.post<{ id: string; status: "FINISHED"; endedAt: string }>(`${live(classId)}/sessions/${sessionId}/end`),
    /** A PDF goes with the number of pages the browser read; an image has none to send (SPEC-068). */
    uploadDeck: (classId: string, file: File, title: string, pageCount?: number) => {
      const form = new FormData();
      form.set("file", file);
      form.set("title", title);
      if (pageCount !== undefined) form.set("pageCount", String(pageCount));
      return client.post<LiveDeck>(`${live(classId)}/decks`, form);
    },
    listDecks: async (classId: string) => (await client.get<{ decks: DeckSummary[] }>(`${live(classId)}/decks`)).decks,
    /** Makes a presentation of the class out of a file material of a lesson, to be projected (SPEC-074 RN-08); the same one if it already is. */
    projectMaterial: (classId: string, materialId: string) => client.post<LiveDeck>(`${live(classId)}/decks/from-material`, { materialId }),
    getActive: (classId: string) => client.get<ActiveRoom>(`${live(classId)}/active`),
    /** The open rooms of the classes where the student is enrolled, the newest first (SPEC-067). */
    listMyLive: async () => (await client.get<{ items: MyLiveRoom[] }>("/me/live")).items,
    getLiveModule: (classId: string) => client.get<LiveModuleContent>(`${live(classId)}/module`),
    listSessions: async (classId: string) =>
      (await client.get<{ sessions: LiveSessionSummary[] }>(`${live(classId)}/sessions`)).sessions,
    saveNotes: (classId: string, sessionId: string, content: string) =>
      client.put<{ sessionId: string; savedLength: number; updatedAt: string }>(`${live(classId)}/sessions/${sessionId}/notes`, { content }),
    getNotes: (classId: string, sessionId: string) => client.get<LiveNote>(`${live(classId)}/sessions/${sessionId}/notes`),
    /** The commands the teacher ran in a live classroom, in the order they ran (SPEC-073). */
    listCommands: async (classId: string, sessionId: string) =>
      (await client.get<{ sessionId: string; commands: LiveTerminalCommand[] }>(`${live(classId)}/sessions/${sessionId}/commands`)).commands,
    listNoteBlocks: async (classId: string, sessionId: string) =>
      (await client.get<{ items: LiveNoteBlock[] }>(`${live(classId)}/sessions/${sessionId}/note-blocks`)).items,
    createNoteBlock: (classId: string, sessionId: string, contentMarkdown: string) =>
      client.post<LiveNoteBlock>(`${live(classId)}/sessions/${sessionId}/note-blocks`, { contentMarkdown }),
    updateNoteBlock: (classId: string, sessionId: string, blockId: string, contentMarkdown: string) =>
      client.patch<LiveNoteBlock>(`${live(classId)}/sessions/${sessionId}/note-blocks/${blockId}`, { contentMarkdown }),
    deleteNoteBlock: (classId: string, sessionId: string, blockId: string) =>
      client.delete<void>(`${live(classId)}/sessions/${sessionId}/note-blocks/${blockId}`),
    uploadNoteImage: (classId: string, sessionId: string, blob: Blob, meta?: NoteImageUploadMeta) => {
      const form = new FormData();
      const fileName = meta?.fileName ?? (blob.type === "image/webp" ? "captura.webp" : "captura.avif");
      const file = blob instanceof File && blob.name === fileName ? blob : new File([blob], fileName, { type: blob.type });
      form.set("file", file);
      if (meta?.width !== undefined) form.set("width", String(meta.width));
      if (meta?.height !== undefined) form.set("height", String(meta.height));
      return client.post<NoteImageCreated>(`${live(classId)}/sessions/${sessionId}/note-images`, form);
    },
    /** Sends the state of the machine of the student for the server to check against the conditions of the exercise (SPEC-065). */
    submitExercise: (classId: string, runId: string, snapshot: unknown) =>
      client.post<ExerciseVerdict>(`${live(classId)}/exercise/submit`, { runId, snapshot }),
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
