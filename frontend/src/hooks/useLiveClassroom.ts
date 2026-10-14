"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { ScreenElement } from "@/engine/terminalScreen";
import {
  openLiveSocket,
  type AdmissionState,
  type HandRaiseItem,
  type LiveAdmissions,
  type LiveDeck,
  type LiveMessage,
  type LiveMode,
  type LiveSnapshot,
  type LiveSocket,
  type LiveSocketHandlers,
  type LiveStroke,
  type LiveView,
} from "@/services/classroomService";

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
  cursor: { x: number; y: number; laser: boolean; visible: boolean } | null;
  online: number;
}

export interface LiveTerminal {
  /** The last picture of the teacher's terminal window, which the student's copy draws; null until one comes (SPEC-056). */
  screen: ScreenElement | null;
}

interface State {
  room: LiveRoomState;
  terminal: LiveTerminal;
  hands: HandRaiseItem[];
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
  hands: [],
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
        hands: s.handRaises ?? [],
      };
    }
    case "live:slide:change":
      return { ...state, room: { ...state.room, slide: Number(data.slide) || 1, strokes: [] } };
    case "live:cursor:move":
      return { ...state, room: { ...state.room, cursor: { x: Number(data.x), y: Number(data.y), laser: Boolean(data.laser), visible: data.visible !== false } } };
    case "live:canvas:draw": {
      if (data.clear) return { ...state, room: { ...state.room, strokes: [] } };
      const strokes = [...state.room.strokes, data as LiveStroke].slice(-MAX_STROKES);
      return { ...state, room: { ...state.room, strokes } };
    }
    case "live:mode:switch":
      return {
        ...state,
        room: { ...state.room, mode: data.mode as LiveMode, moduleId: (data.moduleId as string | undefined) ?? null, moduleFocusBlockId: null },
      };
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

  return {
    ...state,
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
    raiseHand: () => sendOnly("live:hand:raise", {}),
    lowerHand: () => sendOnly("live:hand:lower", {}),
  };
}
