"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { ScreenElement } from "@/engine/terminalScreen";
import {
  openLiveSocket,
  type AdmissionState,
  type HandRaiseItem,
  type LiveAdmissions,
  type LiveCursor,
  type LiveDeck,
  type LiveMessage,
  type LiveMode,
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
  admission: null,
  admissions: { waiting: [], admitted: [] },
  startedAt: null,
  presenterConnected: false,
  ready: false,
  ended: false,
  passive: false,
};

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
    case "live:presence":
      return {
        ...state,
        presenterConnected: typeof data.presenterConnected === "boolean" ? data.presenterConnected : state.presenterConnected,
        room: { ...state.room, online: Number(data.online) || 0 },
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
    /** The picture of the presenter window's terminal, at every change; the server does not echo it, and the teacher has the real terminal. */
    sendTerminalScreen: (screen: ScreenElement) => {
      if (!onStage) return;
      lastScreen.current = screen;
      sendOnly("live:terminal:screen", { screen });
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
    lowerHand: () => {
      sendOnly("live:hand:lower", {});
      dispatch({ kind: "local", message: { type: "live:hand:lower", data: {} } });
    },
    /** Asks the students to go full screen, or stops asking; either window of the teacher does it, and the server tells the other (SPEC-059). */
    sendStageFullscreen: (enabled: boolean) => emit("live:stage:fullscreen", { enabled }),
  };
}
