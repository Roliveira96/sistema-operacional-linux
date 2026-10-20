"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { ScreenElement } from "@/engine/terminalScreen";
import type { CommandRun } from "@/engine/terminalWindow";
import {
  openLiveSocket,
  type AdmissionState,
  type ChatTarget,
  CHAT_MAX,
  type ExerciseDifficulty,
  type ExerciseMyResult,
  type ExerciseProgressEntry,
  type ExerciseResultBody,
  type LiveExercise,
  type HandRaiseItem,
  type LiveAdmissions,
  type LiveCursor,
  type LiveDeck,
  type LiveMessage,
  type LiveMode,
  type LiveChatMessage,
  type LiveSnapshot,
  type LiveSocket,
  type LiveSocketHandlers,
  type LiveStroke,
  type LiveView,
  type MyHand,
  type StageSelection,
  type StageView,
} from "@/services/classroomService";
import { clampZoom } from "@/components/Classroom/FixedStage/stage";

export interface LiveRoomState {
  mode: LiveMode;
  slide: number;
  moduleId: string | null;
  /** The block of the module the teacher put in focus (SPEC-054). */
  moduleFocusBlockId: string | null;
  /** The stage is kept blank by the teacher, for everybody (SPEC-055 CA-17). */
  blank: boolean;
  deck: LiveDeck | null;
  strokes: LiveStroke[];
  cursor: LiveCursor | null;
  online: number;
}

export interface LiveTerminal {
  /** The last picture of the teacher's terminal window, which the student's copy draws; null until one comes (SPEC-056). */
  screen: ScreenElement | null;
}

interface State {
  room: LiveRoomState;
  terminal: LiveTerminal;
  /** Where the teacher is: the scroll of the slide and of the material and the divider (SPEC-057). */
  stageView: StageView;
  /** The teacher asked the students to go full screen (SPEC-059). It is kept apart from the view, which is what the teacher has on his own screen. */
  fullscreen: boolean;
  hands: HandRaiseItem[];
  /** The student's own hand and doubt, as the room gave them and as he changed them since; null for the teacher and until the room says (SPEC-058). */
  myHand: MyHand | null;
  /** The messages of the class chat the room gave this screen, oldest first (SPEC-063). */
  chat: LiveChatMessage[];
  /** The admitted students who are in the room: only the panel is told (SPEC-063). */
  onlineStudents: string[];
  /** The round of the practical exercise: the one running or the last one (SPEC-065). */
  exercise: LiveExercise | null;
  /** How far each student is in the round, by the id of the student: only the panel is told. */
  exerciseProgress: Record<string, ExerciseProgressEntry>;
  /** The last picture of the terminal of the student the teacher watches: only the panel gets it. */
  watchedScreen: { studentId: string; screen: ScreenElement } | null;
  /** The teacher watches this student's terminal, so he sends its picture: only the student is told. */
  watchedByTeacher: boolean;
  /** The student the panel watches, null for nobody. */
  watching: string | null;
  /** SPEC-071: the teacher has the terminal of this student now, with his name (only the student is told). */
  takenOver: boolean;
  takeoverTeacher: string | null;
  /** SPEC-071: the student whose terminal the panel took over, null for nobody. */
  takeover: string | null;
  /** Where the student stands; null until the server says (SPEC-054 CA-01). */
  admission: AdmissionState | null;
  admissions: LiveAdmissions;
  /** When the class began, as the panel is told. */
  startedAt: string | null;
  /** Whether the presentation window of the teacher is connected, as the panel is told (SPEC-055 RN-05). */
  presenterConnected: boolean;
  ready: boolean;
  ended: boolean;
  passive: boolean;
}

const initial: State = {
  room: { mode: "SLIDES", slide: 1, moduleId: null, moduleFocusBlockId: null, blank: false, deck: null, strokes: [], cursor: null, online: 0 },
  terminal: { screen: null },
  stageView: { slideScroll: 0, slideScrollX: 0, materialScroll: 0, split: null, zoom: 1, selection: null, terminalScroll: {} },
  fullscreen: false,
  hands: [],
  myHand: null,
  chat: [],
  onlineStudents: [],
  exercise: null,
  exerciseProgress: {},
  watchedScreen: null,
  watchedByTeacher: false,
  watching: null,
  takenOver: false,
  takeoverTeacher: null,
  takeover: null,
  admission: null,
  admissions: { waiting: [], admitted: [] },
  startedAt: null,
  presenterConnected: false,
  ready: false,
  ended: false,
  passive: false,
};

/** The most messages of the chat kept on screen, so a long class does not grow without end (the room gives up to 500 to the panel). */
const MAX_CHAT = 500;

/** A message of the chat as the room tells it, and nothing that has not its shape; null for anything else. The message for everybody has no owner. */
function readChatMessage(value: unknown): LiveChatMessage | null {
  if (!record(value)) return null;
  const { id, scope, studentId, from, text, createdAt } = value;
  if (typeof id !== "string" || id === "" || typeof text !== "string" || typeof createdAt !== "string") return null;
  if (from !== "TEACHER" && from !== "STUDENT") return null;
  if (scope === "all") return { id, scope, from, text, createdAt };
  if (scope === "private" && typeof studentId === "string" && studentId !== "") return { id, scope, studentId, from, text, createdAt };
  return null;
}

/** The history of a snapshot: the valid messages, in the order the room gave them, without repeating an id. */
function readChat(value: unknown): LiveChatMessage[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const messages: LiveChatMessage[] = [];
  for (const item of value) {
    const message = readChatMessage(item);
    if (message && !seen.has(message.id)) {
      seen.add(message.id);
      messages.push(message);
    }
  }
  return messages.slice(-MAX_CHAT);
}

/** The ids of the online students, as a list of texts. */
const readOnline = (value: unknown): string[] => (Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : []);

const DIFFICULTIES: ReadonlySet<unknown> = new Set<ExerciseDifficulty>(["EASY", "MEDIUM", "HARD"]);
const ENDED_BY: ReadonlySet<unknown> = new Set(["TIMER", "TEACHER", "SESSION"]);
const STATUSES: ReadonlySet<unknown> = new Set(["RUNNING", "PAUSED", "ENDED", "CLOSED"]);
const PARTICIPANT: ReadonlySet<unknown> = new Set(["IN_PROGRESS", "COMPLETED", "NOT_COMPLETED"]);
const text = (value: unknown): value is string => typeof value === "string" && value !== "";
const when = (value: unknown): value is string => typeof value === "string" && !Number.isNaN(Date.parse(value));
const whole = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;

function readMyResult(value: unknown): ExerciseMyResult | null {
  if (!record(value) || !when(value.completedAt) || !finite(value.elapsedSeconds) || !finite(value.points)) return null;
  return { completedAt: value.completedAt, elapsedSeconds: value.elapsedSeconds, points: value.points };
}

/** The result of a round as the room tells it: the scoreboard of whoever finished, with nothing that has not its shape. */
function readResult(value: unknown): ExerciseResultBody | null {
  if (!record(value) || !text(value.runId) || typeof value.visible !== "boolean" || !whole(value.completed) || !whole(value.participants)) return null;
  const rows = Array.isArray(value.scoreboard) ? value.scoreboard : [];
  const scoreboard = rows.flatMap((row) =>
    record(row) && text(row.studentId) && typeof row.name === "string" && finite(row.elapsedSeconds) && finite(row.points)
      ? [{ studentId: row.studentId, name: row.name, elapsedSeconds: row.elapsedSeconds, points: row.points }]
      : [],
  );
  return { runId: value.runId, visible: value.visible, completed: value.completed, participants: value.participants, scoreboard };
}

/** The progress of one student, as the panel is told: how many conditions he meets out of how many, never more than the total. */
function readProgress(value: unknown): ExerciseProgressEntry | null {
  if (!record(value) || !text(value.studentId) || !whole(value.met) || !whole(value.total) || value.met > value.total || value.total > 100) return null;
  const entry: ExerciseProgressEntry = { studentId: value.studentId, met: value.met, total: value.total, last: typeof value.last === "string" ? value.last : "", at: typeof value.at === "string" ? value.at : "" };
  if (typeof value.name === "string") entry.name = value.name;
  if (when(value.completedAt)) entry.completedAt = value.completedAt;
  if (finite(value.elapsedSeconds)) entry.elapsedSeconds = value.elapsedSeconds;
  if (finite(value.points)) entry.points = value.points;
  if (finite(value.attempts)) entry.attempts = value.attempts;
  if (whole(value.commands)) entry.commands = value.commands;
  if (when(value.lastCommandAt)) entry.lastCommandAt = value.lastCommandAt;
  if (PARTICIPANT.has(value.status)) entry.status = value.status as ExerciseProgressEntry["status"];
  if (typeof value.helpRequested === "boolean") entry.helpRequested = value.helpRequested;
  if (typeof value.takenOver === "boolean") entry.takenOver = value.takenOver;
  return entry;
}

/** The student the panel took over, from the snapshot: the one whose takeover is on. */
function readTakeover(value: unknown): string | null {
  const list = record(value) && Array.isArray(value.progress) ? value.progress : [];
  const on = list.find((item: unknown) => record(item) && item.takeoverOn === true && text(item.studentId)) as Record<string, unknown> | undefined;
  return on ? (on.studentId as string) : null;
}

/** The round of the exercise, in the form of the snapshot and of the start: null for anything that has not the shape of one (SPEC-065). */
function readExercise(value: unknown): LiveExercise | null {
  if (!record(value) || !text(value.runId) || !text(value.blockId) || !whole(value.index) || !text(value.title) || !DIFFICULTIES.has(value.difficulty)) return null;
  if (!finite(value.durationSeconds) || value.durationSeconds <= 0 || !when(value.startedAt) || !when(value.endsAt)) return null;
  const exercise: LiveExercise = {
    runId: value.runId,
    blockId: value.blockId,
    index: value.index,
    title: value.title,
    difficulty: value.difficulty as ExerciseDifficulty,
    durationSeconds: value.durationSeconds,
    startedAt: value.startedAt,
    endsAt: value.endsAt,
    status: STATUSES.has(value.status) ? (value.status as LiveExercise["status"]) : "RUNNING",
    resultVisible: value.resultVisible === true,
    skewMs: when(value.now) ? Date.parse(value.now) - Date.now() : 0,
  };
  if (ENDED_BY.has(value.endedBy)) exercise.endedBy = value.endedBy as LiveExercise["endedBy"];
  if (when(value.endedAt)) exercise.endedAt = value.endedAt;
  if (whole(value.pausedSeconds)) exercise.pausedSeconds = value.pausedSeconds;
  if (when(value.closedAt)) exercise.closedAt = value.closedAt;
  if (exercise.resultVisible) {
    const result = readResult(value.result);
    if (result) exercise.result = result;
  }
  if ("myResult" in value) exercise.myResult = readMyResult(value.myResult);
  return exercise;
}

/** The progress that comes with the snapshot of the panel, by student. */
function readProgressList(value: unknown): Record<string, ExerciseProgressEntry> {
  const list = record(value) && Array.isArray(value.progress) ? value.progress : [];
  const progress: Record<string, ExerciseProgressEntry> = {};
  for (const item of list) {
    const entry = readProgress(item);
    if (entry) progress[entry.studentId] = entry;
  }
  return progress;
}

/** The most strokes kept on screen, so a long class does not grow without end. */
const MAX_STROKES = 500;

/** The scroll and the divider go out at most this often (SPEC-057 section 3.1). */
const STAGE_SEND_MS = 100;
/** The part of the stage the material can take (SPEC-057 section 5). */
const SPLIT_MIN = 0.2;
const SPLIT_MAX = 0.8;

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const unit = (value: unknown) => (finite(value) ? Math.min(1, Math.max(0, value)) : 0);
const ratio = (value: unknown) => (finite(value) ? Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, value)) : null);
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** The longest id of a block, and the biggest offset, as the server takes them (SPEC-057 section 3.2). */
const MAX_BLOCK_ID = 128;
const MAX_OFFSET = 1_000_000;
const offset = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= MAX_OFFSET;

function readPoint(value: unknown): { block: string; offset: number } | null {
  if (!record(value) || typeof value.block !== "string" || value.block.length < 1 || value.block.length > MAX_BLOCK_ID || !offset(value.offset)) return null;
  return { block: value.block, offset: value.offset };
}

/**
 * The selection of the teacher as the server tells it, in exactly one of its two forms; null for anything else, which is never taken for a
 * selection (clearing is another message).
 */
function readSelection(value: unknown): StageSelection | null {
  if (!record(value)) return null;
  if (value.pane === "material") {
    const start = readPoint(value.start);
    const end = readPoint(value.end);
    return start && end ? { pane: "material", start, end } : null;
  }
  if (value.pane === "terminal") {
    const terminal = value.terminal;
    if (!Number.isInteger(terminal) || (terminal as number) < 1 || (terminal as number) > 3) return null;
    if (!offset(value.start) || !offset(value.end) || value.start > value.end) return null;
    return { pane: "terminal", terminal: terminal as number, start: value.start, end: value.end };
  }
  return null;
}

/** The terminals the stage has (SPEC-057 CA-23). */
const isTerminal = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 3;

/** Where the teacher has each terminal: the places of terminals 1 to 3 and nothing else; a terminal that is not in it is at the end. */
function readTerminalScroll(value: unknown): Record<string, number> {
  const places: Record<string, number> = {};
  if (!record(value)) return places;
  for (const key of ["1", "2", "3"]) if (finite(value[key])) places[key] = unit(value[key]);
  return places;
}

/** The hand of the student as a snapshot tells it; null when it tells none, and a hand that is down when it tells nonsense. */
function readMyHand(value: unknown): MyHand | null {
  if (!record(value)) return null;
  return { raised: value.raised === true, question: typeof value.question === "string" ? value.question : "" };
}

/** The view of a snapshot; a server that tells none, or tells nonsense, leaves the stage at its start. */
function readStageView(view: Partial<StageView> | null | undefined): StageView {
  return {
    slideScroll: unit(view?.slideScroll),
    slideScrollX: unit(view?.slideScrollX),
    materialScroll: unit(view?.materialScroll),
    split: ratio(view?.split),
    zoom: finite(view?.zoom) ? clampZoom(view.zoom) : 1,
    selection: readSelection(view?.selection),
    terminalScroll: readTerminalScroll(view?.terminalScroll),
  };
}

type Action = { kind: "message"; message: LiveMessage } | { kind: "local"; message: LiveMessage };

function apply(state: State, message: LiveMessage): State {
  const data = (message.data ?? {}) as Record<string, unknown>;
  switch (message.type) {
    case "live:snapshot": {
      const s = message.data as LiveSnapshot;
      return {
        ...state,
        ready: true,
        admission: "ADMITTED",
        admissions: s.admissions ?? state.admissions,
        startedAt: s.startedAt ?? s.session?.startedAt ?? state.startedAt,
        presenterConnected: s.presenterConnected ?? state.presenterConnected,
        room: {
          mode: s.displayMode,
          slide: s.currentSlide,
          moduleId: s.moduleId ?? s.activeModuleId ?? null,
          moduleFocusBlockId: s.moduleFocusBlockId ?? null,
          blank: s.stageBlank ?? false,
          deck: s.activeDeck ?? null,
          strokes: s.recentDrawings ?? [],
          cursor: null,
          online: s.onlineCount ?? 0,
        },
        terminal: { screen: s.terminal?.screen ?? null },
        stageView: readStageView(s.stageView),
        fullscreen: s.stageView?.fullscreen === true,
        hands: s.handRaises ?? [],
        myHand: readMyHand(s.myHand),
        chat: readChat(s.chat),
        onlineStudents: readOnline(s.onlineStudents),
        exercise: readExercise(s.exercise),
        exerciseProgress: readProgressList(s.exercise),
        // A new connection starts with nobody watched: the server tells the student again if the teacher still does.
        watchedScreen: null,
        watchedByTeacher: false,
        watching: null,
        takenOver: record(s.exercise) && s.exercise.takenOver === true,
        takeoverTeacher: null,
        takeover: readTakeover(s.exercise),
      };
    }
    // The server tells no restart: a new slide starts at the top, and a new module (SPEC-057 CA-05).
    case "live:slide:change":
      return { ...state, room: { ...state.room, slide: Number(data.slide) || 1, strokes: [] }, stageView: { ...state.stageView, slideScroll: 0, slideScrollX: 0 } };
    case "live:stage:scroll": {
      if (!finite(data.y)) return state;
      if (data.pane === "terminal") {
        // Each terminal has its own place; a terminal the stage does not have changes nothing.
        if (!isTerminal(data.terminal)) return state;
        return { ...state, stageView: { ...state.stageView, terminalScroll: { ...state.stageView.terminalScroll, [String(data.terminal)]: unit(data.y) } } };
      }
      if (data.pane === "material") return { ...state, stageView: { ...state.stageView, materialScroll: unit(data.y) } };
      if (data.pane !== "slide" || (data.x !== undefined && !finite(data.x))) return state;
      // The slide is also scrolled sideways, with the zoom; a message with no sideways place says the page is at the left.
      return { ...state, stageView: { ...state.stageView, slideScroll: unit(data.y), slideScrollX: unit(data.x) } };
    }
    case "live:stage:zoom":
      return finite(data.zoom) ? { ...state, stageView: { ...state.stageView, zoom: clampZoom(data.zoom) } } : state;
    case "live:stage:selection": {
      if (data.clear === true) return { ...state, stageView: { ...state.stageView, selection: null } };
      const selection = readSelection(data);
      return selection ? { ...state, stageView: { ...state.stageView, selection } } : state;
    }
    // The request for the full screen of the students is on or off, as the teacher left it; only a boolean says which (SPEC-059).
    case "live:stage:fullscreen":
      return typeof data.enabled === "boolean" ? { ...state, fullscreen: data.enabled } : state;
    case "live:stage:split": {
      const split = ratio(data.ratio);
      return split === null ? state : { ...state, stageView: { ...state.stageView, split } };
    }
    case "live:cursor:move":
      return { ...state, room: { ...state.room, cursor: { x: Number(data.x), y: Number(data.y), laser: Boolean(data.laser), visible: data.visible !== false } } };
    case "live:canvas:draw": {
      if (data.clear) return { ...state, room: { ...state.room, strokes: [] } };
      const strokes = [...state.room.strokes, data as LiveStroke].slice(-MAX_STROKES);
      return { ...state, room: { ...state.room, strokes } };
    }
    // The teacher chose the presentation of the stage (SPEC-068): it starts at the first slide, in the slides mode, with nothing drawn.
    case "live:deck:changed": {
      const deck = data.activeDeck as LiveDeck | undefined;
      if (!deck || typeof deck !== "object") return state;
      return {
        ...state,
        room: { ...state.room, deck, mode: (data.displayMode as LiveMode) ?? "SLIDES", slide: Number(data.currentSlide) || 1, strokes: [], cursor: null },
        stageView: { ...state.stageView, slideScroll: 0, slideScrollX: 0 },
      };
    }
    case "live:mode:switch": {
      // Going back to the slides says no module, but the room keeps its module (the snapshot says so), and so does the scroll of its material: the
      // server restarts that scroll only when the module is another one (SPEC-057).
      const moduleId = (data.moduleId as string | undefined) ?? (data.mode === "SLIDES" ? state.room.moduleId : null);
      return {
        ...state,
        // The pointer is a percentage of the page on the slides and of the stage on the module, so the old one means nothing in the new mode.
        room: { ...state.room, mode: data.mode as LiveMode, moduleId, moduleFocusBlockId: null, cursor: null },
        // The server tells nothing when it clears the selection: it does so with the scroll of the material, when the module is another one.
        // The new module has new terminals, which start at the end.
        stageView: moduleId === state.room.moduleId ? state.stageView : { ...state.stageView, materialScroll: 0, selection: null, terminalScroll: {} },
      };
    }
    case "live:module:focus":
      return { ...state, room: { ...state.room, moduleFocusBlockId: (data.blockId as string | undefined) ?? null } };
    case "live:stage:blank":
      return { ...state, room: { ...state.room, blank: Boolean(data.blank) } };
    case "live:presenter:state":
      return { ...state, presenterConnected: Boolean(data.connected) };
    case "live:admission:state":
      return { ...state, admission: data.status as AdmissionState };
    case "live:admission:queue":
      return {
        ...state,
        admissions: { waiting: (data.waiting as LiveAdmissions["waiting"]) ?? [], admitted: (data.admitted as LiveAdmissions["admitted"]) ?? [] },
      };
    case "live:terminal:screen":
      // Only a tree is taken; anything else leaves the screen as it was.
      return typeof data.screen === "object" && data.screen !== null && !Array.isArray(data.screen)
        ? { ...state, terminal: { screen: data.screen as ScreenElement } }
        : state;
    case "live:hand:queue":
      return { ...state, hands: (data.queue as HandRaiseItem[]) ?? [] };
    // What the student sends about his own hand, which the server does not echo: his screen keeps it (SPEC-058).
    case "live:hand:raise":
      return { ...state, myHand: { raised: true, question: typeof data.question === "string" ? data.question : "" } };
    case "live:hand:lower":
      return { ...state, myHand: { raised: false, question: "" } };
    // A message of the chat is added once, however many times the room tells it (SPEC-063).
    case "live:chat:message": {
      const incoming = readChatMessage(data);
      if (!incoming || state.chat.some((m) => m.id === incoming.id)) return state;
      return { ...state, chat: [...state.chat, incoming].slice(-MAX_CHAT) };
    }
    // The round of the practical exercise (SPEC-065): a new one clears what the last one left, and what names another round changes nothing.
    case "live:exercise:started": {
      const exercise = readExercise({ ...data, status: "RUNNING", resultVisible: false, myResult: null });
      return exercise ? { ...state, exercise, exerciseProgress: {}, watchedScreen: null, watchedByTeacher: false, watching: null, takenOver: false, takeover: null } : state;
    }
    case "live:exercise:ended": {
      if (!state.exercise || data.runId !== state.exercise.runId) return state;
      const ended: LiveExercise = { ...state.exercise, status: "ENDED", skewMs: when(data.now) ? Date.parse(data.now) - Date.now() : state.exercise.skewMs };
      if (ENDED_BY.has(data.by)) ended.endedBy = data.by as LiveExercise["endedBy"];
      if (when(data.endedAt)) ended.endedAt = data.endedAt;
      return { ...state, exercise: ended, watchedScreen: null, watchedByTeacher: false, watching: null, takenOver: false, takeover: null };
    }
    // SPEC-071: the pause, more time and going back to the lesson. What names another round changes nothing.
    case "live:exercise:paused": {
      if (!state.exercise || data.runId !== state.exercise.runId || typeof data.paused !== "boolean" || !when(data.endsAt)) return state;
      const next: LiveExercise = { ...state.exercise, status: data.paused ? "PAUSED" : "RUNNING", endsAt: data.endsAt, skewMs: when(data.now) ? Date.parse(data.now) - Date.now() : state.exercise.skewMs };
      if (whole(data.pausedSeconds)) next.pausedSeconds = data.pausedSeconds;
      return { ...state, exercise: next, ...(data.paused ? { takenOver: false, takeover: null } : {}) };
    }
    case "live:exercise:extended": {
      if (!state.exercise || data.runId !== state.exercise.runId || !when(data.endsAt) || !finite(data.durationSeconds)) return state;
      const next: LiveExercise = { ...state.exercise, endsAt: data.endsAt, durationSeconds: data.durationSeconds, skewMs: when(data.now) ? Date.parse(data.now) - Date.now() : state.exercise.skewMs };
      if (data.reopened === true) {
        next.status = "RUNNING";
        next.resultVisible = false;
        delete next.endedBy;
        delete next.endedAt;
        delete next.result;
      }
      return { ...state, exercise: next };
    }
    case "live:exercise:closed": {
      if (!state.exercise || data.runId !== state.exercise.runId) return state;
      const next: LiveExercise = { ...state.exercise, status: "CLOSED" };
      if (when(data.closedAt)) next.closedAt = data.closedAt;
      return { ...state, exercise: next, watchedScreen: null, watchedByTeacher: false, watching: null, takenOver: false, takeover: null };
    }
    // The takeover: the student is told {on, teacherName}, the panel {studentId, on}.
    case "live:exercise:takeover": {
      if (typeof data.on !== "boolean") return state;
      if (!text(data.studentId)) return { ...state, takenOver: data.on, takeoverTeacher: data.on && typeof data.teacherName === "string" ? data.teacherName : state.takeoverTeacher };
      if (!data.on) return { ...state, takeover: state.takeover === data.studentId ? null : state.takeover };
      const before = state.exerciseProgress[data.studentId];
      const marked: ExerciseProgressEntry = { met: 0, total: 0, last: "", at: "", ...before, studentId: data.studentId, takenOver: true };
      return { ...state, takeover: data.studentId, exerciseProgress: { ...state.exerciseProgress, [data.studentId]: marked } };
    }
    case "live:exercise:result": {
      if (!state.exercise || data.runId !== state.exercise.runId) return state;
      const result = readResult(data);
      if (!result) return state;
      const next: LiveExercise = { ...state.exercise, resultVisible: result.visible };
      if (result.visible) next.result = result;
      else delete next.result;
      return { ...state, exercise: next };
    }
    case "live:exercise:progress": {
      const entry = readProgress(data);
      if (!entry || !state.exercise || data.runId !== state.exercise.runId) return state;
      return { ...state, exerciseProgress: { ...state.exerciseProgress, [entry.studentId]: { ...state.exerciseProgress[entry.studentId], ...entry } } };
    }
    case "live:exercise:done": {
      if (!state.exercise || data.runId !== state.exercise.runId || !text(data.studentId) || !when(data.completedAt) || !finite(data.elapsedSeconds) || !finite(data.points)) return state;
      const before = state.exerciseProgress[data.studentId];
      const entry: ExerciseProgressEntry = {
        met: 0,
        total: 0,
        last: "",
        at: data.completedAt,
        ...before,
        studentId: data.studentId,
        completedAt: data.completedAt,
        elapsedSeconds: data.elapsedSeconds,
        points: data.points,
      };
      if (typeof data.name === "string") entry.name = data.name;
      if (finite(data.attempts)) entry.attempts = data.attempts;
      return { ...state, exerciseProgress: { ...state.exerciseProgress, [data.studentId]: entry } };
    }
    // The picture of the student the panel watches; a late one of the student it watched before is dropped.
    case "live:exercise:screen":
      return text(data.studentId) && data.studentId === state.watching && record(data.screen) ? { ...state, watchedScreen: { studentId: data.studentId, screen: data.screen as unknown as ScreenElement } } : state;
    case "live:exercise:watch":
      return { ...state, watchedByTeacher: data.on === true };
    // What the panel does when it chooses a student to watch, which the server does not echo.
    case "live:exercise:watching":
      return { ...state, watching: text(data.studentId) ? data.studentId : null, watchedScreen: null };
    case "live:presence":
      return {
        ...state,
        presenterConnected: typeof data.presenterConnected === "boolean" ? data.presenterConnected : state.presenterConnected,
        room: { ...state.room, online: Number(data.online) || 0 },
        // Only the panel is told who is online; the others' presence has no list, and it changes nothing.
        onlineStudents: Array.isArray(data.onlineStudents) ? readOnline(data.onlineStudents) : state.onlineStudents,
      };
    case "live:control:revoked":
      return { ...state, passive: true };
    case "live:ended":
      return { ...state, ended: true };
    default:
      return state;
  }
}

const reducer = (state: State, action: Action): State => apply(state, action.message);

/** Sends a value at once, then at most every `STAGE_SEND_MS` with the last one, and never what the room already has (SPEC-057 section 3.1). */
interface Pace<T> {
  push(value: T): void;
  /** The room is known to be at `value` (a new slide starts at the top): what was waiting is dropped, and `value` is not told again. */
  reset(value: T): void;
  cancel(): void;
}

/** The selection as the server takes it: the fields of its form and nothing else. */
function selectionMessage(selection: StageSelection): StageSelection {
  return selection.pane === "material"
    ? { pane: "material", start: { block: selection.start.block, offset: selection.start.offset }, end: { block: selection.end.block, offset: selection.end.offset } }
    : { pane: "terminal", terminal: selection.terminal, start: selection.start, end: selection.end };
}

function createPace<T>(send: (value: T) => void, same: (a: T, b: T) => boolean = Object.is): Pace<T> {
  let sent: { value: T } | null = null;
  let last = -Infinity;
  let pending: { value: T } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    timer = undefined;
    if (!pending || (sent && same(pending.value, sent.value))) return;
    sent = pending;
    last = Date.now();
    send(pending.value);
  };
  return {
    push(value) {
      pending = { value };
      const wait = last + STAGE_SEND_MS - Date.now();
      if (wait > 0) {
        timer ??= setTimeout(flush, wait);
        return;
      }
      clearTimeout(timer);
      flush();
    },
    reset(value) {
      clearTimeout(timer);
      timer = undefined;
      sent = { value };
      pending = { value };
    },
    cancel() {
      clearTimeout(timer);
      timer = undefined;
    },
  };
}

type Connect = (classId: string, handlers: LiveSocketHandlers, view?: LiveView) => LiveSocket;

const connectToServer: Connect = (classId, handlers, view) => openLiveSocket(classId, handlers, undefined, view);

/** The first wait before trying again, and the longest. */
const RETRY_FIRST_MS = 1000;
const RETRY_MAX_MS = 10_000;

/** A key of the teacher on the terminal of the student, or a text he pasted (SPEC-071 section 3.3). */
export type TakeoverKey = { key: string; ctrl?: boolean; alt?: boolean; shift?: boolean } | { paste: string };

/** The most characters of a paste of the teacher (SPEC-071 section 3.3). */
const PASTE_MAX = 2000;

/** A key of the teacher as the room gives it, with nothing that has not its shape; null for anything else. */
function readTakeoverKey(value: unknown): TakeoverKey | null {
  if (!record(value)) return null;
  if (typeof value.paste === "string" && value.paste !== "") return { paste: value.paste };
  if (!text(value.key)) return null;
  return { key: value.key, ctrl: value.ctrl === true, alt: value.alt === true, shift: value.shift === true };
}

export interface UseLiveClassroomOptions {
  classId: string;
  /** The teacher (and the administrator) controls the room; a student only follows it. */
  role: "teacher" | "student";
  /** The window of the teacher: the panel (the default) or the presentation. A student has none (SPEC-055 RN-01). */
  view?: LiveView;
  connect?: Connect;
}

/**
 * The connection with the live classroom and its state: it reconnects by itself and, at every connection, the first message brings the
 * whole state of the room (SPEC-051 RN-07). What the teacher sends is also applied to his own screen, because the server does not echo it.
 */
export function useLiveClassroom({ classId, role, view, connect = connectToServer }: UseLiveClassroomOptions) {
  const kind = role === "teacher" ? (view ?? "panel") : undefined;
  const [state, dispatch] = useReducer(reducer, initial);
  const [connected, setConnected] = useState(false);
  const socket = useRef<LiveSocket | null>(null);
  const finished = useRef(false);
  // The last picture the presenter window told: the server keeps it in memory only and a message sent while the socket is not open is lost, so it
  // is told again at every connection (SPEC-056 section 4).
  const lastScreen = useRef<ScreenElement | null>(null);
  // Who listens to the keys of the teacher (the terminal of the student taken over); they are not state, they go to the terminal as they come (SPEC-071).
  const keyListeners = useRef(new Set<(key: TakeoverKey) => void>());

  useEffect(() => {
    finished.current = state.ended;
  }, [state.ended]);

  useEffect(() => {
    // The connections of one run of this effect belong to it: once the run is over (the screen went away, or React mounted it twice in
    // development), whatever its connections still say or do is ignored, so an old connection cannot take the control from the new one
    // nor reopen a connection by itself.
    let active = true;
    let wait = RETRY_FIRST_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const open = () => {
      socket.current = connect(classId, {
        onOpen: () => {
          if (!active) return;
          wait = RETRY_FIRST_MS;
          if (kind === "presenter" && lastScreen.current) socket.current?.send("live:terminal:screen", { screen: lastScreen.current });
          setConnected(true);
        },
        onMessage: (message) => {
          if (!active) return;
          if (message.type === "live:ended") finished.current = true;
          if (message.type === "live:exercise:key") {
            const key = readTakeoverKey(message.data);
            if (key) keyListeners.current.forEach((listener) => listener(key));
            return;
          }
          dispatch({ kind: "message", message });
        },
        onClose: () => {
          if (!active) return;
          setConnected(false);
          if (finished.current) return;
          timer = setTimeout(open, wait);
          wait = Math.min(wait * 2, RETRY_MAX_MS);
        },
      }, kind);
    };
    open();
    return () => {
      active = false;
      clearTimeout(timer);
      socket.current?.close();
    };
  }, [classId, connect, kind]);

  const canControl = role === "teacher" && !state.passive;
  // Who sends what (SPEC-055 RN-02): the stage is the presentation window's, the waiting room and the hands are the panel's.
  const onStage = canControl && kind === "presenter";
  const onPanel = canControl && kind === "panel";
  const emit = useCallback(
    (type: string, data: unknown) => {
      if (!canControl) return;
      socket.current?.send(type, data);
      dispatch({ kind: "local", message: { type, data } });
    },
    [canControl],
  );
  const sendOnly = useCallback((type: string, data: unknown) => socket.current?.send(type, data), []);
  const onTakeoverKey = useCallback((listener: (key: TakeoverKey) => void) => {
    keyListeners.current.add(listener);
    return () => void keyListeners.current.delete(listener);
  }, []);

  // The scroll of the slide, the scroll of the material, the divider and the selection, each at its own pace (SPEC-057). What goes out is sent by the
  // latest render, so a window that lost the control sends nothing even if a position was waiting.
  const deliver = useRef<(type: string, data: unknown) => void>(() => undefined);
  useEffect(() => {
    deliver.current = (type, data) => {
      if (onStage) socket.current?.send(type, data);
    };
  });
  const paces = useRef<{
    slide: Pace<readonly [number, number]>;
    material: Pace<number>;
    split: Pace<number>;
    selection: Pace<StageSelection | null>;
    terminals: Record<1 | 2 | 3, Pace<number>>;
  } | null>(null);
  useEffect(() => {
    const made = {
      // The sideways place goes only when the page is not at the left: a message with none says so, and the material has none.
      slide: createPace<readonly [number, number]>(
        ([y, x]) => deliver.current("live:stage:scroll", x > 0 ? { pane: "slide", y, x } : { pane: "slide", y }),
        (a, b) => a[0] === b[0] && a[1] === b[1],
      ),
      material: createPace<number>((y) => deliver.current("live:stage:scroll", { pane: "material", y })),
      // Each terminal has its own pace and its own place, and the history is at the end until the teacher scrolls it.
      terminals: {
        1: createPace<number>((y) => deliver.current("live:stage:scroll", { pane: "terminal", terminal: 1, y })),
        2: createPace<number>((y) => deliver.current("live:stage:scroll", { pane: "terminal", terminal: 2, y })),
        3: createPace<number>((y) => deliver.current("live:stage:scroll", { pane: "terminal", terminal: 3, y })),
      },
      split: createPace<number>((ratio) => deliver.current("live:stage:split", { ratio })),
      // Only the fields of the contract go out, and clearing is its own form.
      selection: createPace<StageSelection | null>(
        (selection) => deliver.current("live:stage:selection", selection === null ? { clear: true } : selectionMessage(selection)),
        (a, b) => JSON.stringify(a) === JSON.stringify(b),
      ),
    };
    paces.current = made;
    return () => [made.slide, made.material, made.split, made.selection, ...Object.values(made.terminals)].forEach((pace) => pace.cancel());
  }, []);
  // The server brings the scroll back to 0 at a new slide, and the scroll of the material and the selection at a new module, and so does the client:
  // a position or a selection of the old one never goes to the new.
  useEffect(() => paces.current?.slide.reset([0, 0]), [state.room.slide]);
  useEffect(() => {
    paces.current?.material.reset(0);
    paces.current?.selection.reset(null);
    for (const pace of Object.values(paces.current?.terminals ?? {})) pace.reset(1);
  }, [state.room.moduleId]);

  return {
    ...state,
    // Only the panel is told how far each student is, whatever a message says.
    exerciseProgress: kind === "panel" ? state.exerciseProgress : {},
    /** How many hands are up, for the header of the module. */
    handCount: state.hands.length,
    /** The teacher asked the students to go full screen (SPEC-059). */
    fullscreenRequested: state.fullscreen,
    connected,
    canControl,
    changeSlide: (slide: number) => emit("live:slide:change", { slide }),
    moveCursor: (x: number, y: number, laser: boolean, visible = true) => onStage && emit("live:cursor:move", { x, y, laser, visible }),
    draw: (path: Array<[number, number]>) => onStage && emit("live:canvas:draw", { path }),
    clearDrawings: () => onStage && emit("live:canvas:draw", { clear: true }),
    setBlank: (blank: boolean) => onStage && emit("live:stage:blank", { blank }),
    switchMode: (mode: LiveMode, moduleId?: string) => emit("live:mode:switch", moduleId ? { mode, moduleId } : { mode }),
    /** The panel asks for a presentation of the class to be put on the stage; the server says which one is there, and tells everybody (SPEC-068). */
    selectDeck: (deckId: string) => {
      if (onPanel) sendOnly("live:deck:select", { deckId });
    },
    /** The picture of the presenter window's terminal, at every change; the server does not echo it, and the teacher has the real terminal. */
    sendTerminalScreen: (screen: ScreenElement) => {
      if (!onStage) return;
      lastScreen.current = screen;
      sendOnly("live:terminal:screen", { screen });
    },
    /** A command the presenter window ran, for the diary of the lesson; the server keeps it and echoes nothing (SPEC-073). */
    sendTerminalCommand: (run: CommandRun) => {
      if (onStage) sendOnly("live:terminal:command", run);
    },
    /**
     * Where the teacher scrolled the slide (down and sideways) or the material (down), as fractions of what can be scrolled; only the presenter window
     * tells it (SPEC-057).
     */
    sendStageScroll: (pane: "slide" | "material", y: number, x = 0) => {
      if (!onStage) return;
      if (pane === "slide") paces.current?.slide.push([unit(y), unit(x)]);
      else paces.current?.material.push(unit(y));
    },
    /** The zoom of the teacher, from 1 to 2; it is also applied to his own stage. Only the presenter window changes it (SPEC-057). */
    sendStageZoom: (zoom: number) => onStage && emit("live:stage:zoom", { zoom: clampZoom(zoom) }),
    /** Where the teacher scrolled the history of a terminal (1 to 3), as a fraction of what can be scrolled; 1 is the end. Only the presenter window tells it (SPEC-057). */
    sendTerminalScroll: (terminal: number, y: number) => {
      if (onStage && isTerminal(terminal)) paces.current?.terminals[terminal as 1 | 2 | 3].push(unit(y));
    },
    /** The text the teacher selected, or null when he cleared it; the server does not echo it, and the teacher has the real selection (SPEC-057). */
    sendStageSelection: (selection: StageSelection | null) => {
      if (onStage) paces.current?.selection.push(selection);
    },
    /** The part of the stage the material takes, from 0.2 to 0.8; only the presenter window tells it (SPEC-057). */
    sendStageSplit: (value: number) => {
      const split = ratio(value);
      if (onStage && split !== null) paces.current?.split.push(split);
    },
    moderate: (studentId?: string) => {
      if (onPanel) sendOnly("live:hand:moderate", studentId ? { studentId } : { all: true });
    },
    focusBlock: (blockId: string) => emit("live:module:focus", { blockId }),
    acceptStudent: (studentId: string) => {
      if (onPanel) sendOnly("live:admission:accept", { studentId });
    },
    acceptAll: () => {
      if (onPanel) sendOnly("live:admission:accept-all", {});
    },
    removeStudent: (studentId: string) => {
      if (onPanel) sendOnly("live:admission:remove", { studentId });
    },
    /** A student removed from the class asks to come in again. */
    requestEntry: () => sendOnly("live:admission:request", {}),
    /**
     * Raises the hand with one call and, when there is a doubt, with it; with the hand already up it only changes the doubt, and with no text it takes
     * the doubt away (SPEC-058). The text goes trimmed, as the server keeps it.
     */
    raiseHand: (question = "") => {
      const text = question.trim();
      sendOnly("live:hand:raise", text ? { question: text } : {});
      dispatch({ kind: "local", message: { type: "live:hand:raise", data: { question: text } } });
    },
    /** The teacher starts the round of a practical exercise of a block, for the minutes he says (the room takes 5 when none is told); only the panel does (SPEC-065). */
    startExercise: (blockId: string, index: number, minutes?: number) => {
      if (onPanel) sendOnly("live:exercise:start", minutes === undefined ? { blockId, index } : { blockId, index, minutes });
    },
    /** The teacher ends the round before the time. */
    endExercise: () => {
      if (onPanel) sendOnly("live:exercise:end", {});
    },
    /** The teacher shows the result of the ended round to the students, or hides it again. */
    revealExercise: (visible: boolean) => {
      if (onPanel) sendOnly("live:exercise:reveal", { visible });
    },
    /** The teacher watches the terminal of one student, or of nobody (null). */
    watchStudent: (studentId: string | null) => {
      if (!onPanel) return;
      sendOnly("live:exercise:watch", { studentId });
      dispatch({ kind: "local", message: { type: "live:exercise:watching", data: { studentId } } });
    },
    /**
     * How far the student is: the conditions he meets out of the ones the exercise has, his last command and, when told, how many commands he ran (SPEC-071);
     * says whether it went (SPEC-065).
     */
    sendExerciseProgress: ({ runId, met, total, last = "", commands }: { runId: string; met: number; total: number; last?: string; commands?: number }): boolean => {
      if (role !== "student" || !connected || !whole(met) || !whole(total) || met > total || total > 100) return false;
      const body: Record<string, unknown> = { runId, met, total, last: Array.from(last.replace(/\p{Cc}/gu, "")).slice(0, 200).join("") };
      if (commands !== undefined && whole(commands)) body.commands = Math.min(commands, 10_000);
      sendOnly("live:exercise:progress", body);
      return true;
    },
    /** The teacher pauses the round, or resumes it; only the panel does (SPEC-071 RN-01). */
    pauseExercise: (paused: boolean) => {
      if (onPanel) sendOnly("live:exercise:pause", { paused });
    },
    /** The teacher gives the round more minutes, also to the round that ended (RN-02). */
    extendExercise: (minutes: number) => {
      if (onPanel) sendOnly("live:exercise:extend", { minutes });
    },
    /** The teacher goes back to the lesson (RN-04). */
    closeExercise: () => {
      if (onPanel) sendOnly("live:exercise:close", {});
    },
    /** The teacher takes over the terminal of the student, or gives it back (RN-05, RN-06). */
    takeoverStudent: (studentId: string, on: boolean) => {
      if (onPanel) sendOnly("live:exercise:takeover", { studentId, on });
    },
    /** A key of the teacher for the terminal he took over. */
    sendTakeoverKey: (studentId: string, key: { key: string; ctrl?: boolean; alt?: boolean; shift?: boolean }) => {
      if (onPanel && key.key !== "") sendOnly("live:exercise:key", { studentId, key: key.key, ctrl: key.ctrl === true, alt: key.alt === true, shift: key.shift === true });
    },
    /** A text the teacher pasted on the terminal he took over: from 1 to 2,000 characters. */
    sendTakeoverPaste: (studentId: string, text: string) => {
      const length = Array.from(text).length;
      if (onPanel && length > 0 && length <= PASTE_MAX) sendOnly("live:exercise:key", { studentId, paste: text });
    },
    /** Listens to the keys of the teacher on the terminal of this student; gives what stops listening. The same function at every render. */
    onTakeoverKey,
    /** The picture of the terminal of the student, which goes out only while the teacher watches him. */
    sendExerciseScreen: (runId: string, screen: ScreenElement): boolean => {
      if (role !== "student" || !connected || !state.watchedByTeacher) return false;
      sendOnly("live:exercise:screen", { runId, screen });
      return true;
    },
    /**
     * Sends a message of the class chat and says whether it went (SPEC-063). The student writes to the teacher and names no one; the teacher writes from the panel,
     * to everybody or to one student, and has to say which. Nothing goes empty, over the limit or with the connection down, and nothing is shown before the room
     * gives the message back.
     */
    sendChat: (text: string, to?: ChatTarget): boolean => {
      const body = text.trim();
      if (!connected || body === "" || Array.from(body).length > CHAT_MAX) return false;
      if (role === "student") {
        sendOnly("live:chat:send", { text: body });
        return true;
      }
      if (!onPanel || !to) return false;
      sendOnly("live:chat:send", to === "all" ? { text: body, to: "all" } : { text: body, studentId: to.studentId });
      return true;
    },
    lowerHand: () => {
      sendOnly("live:hand:lower", {});
      dispatch({ kind: "local", message: { type: "live:hand:lower", data: {} } });
    },
    /** Asks the students to go full screen, or stops asking; either window of the teacher does it, and the server tells the other (SPEC-059). */
    sendStageFullscreen: (enabled: boolean) => emit("live:stage:fullscreen", { enabled }),
  };
}
