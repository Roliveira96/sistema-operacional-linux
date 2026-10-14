"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { TerminalCommandEvent, TerminalInputEvent } from "@/engine/terminalWindow";
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
} from "@/services/classroomService";

export interface LiveRoomState {
  mode: LiveMode;
  slide: number;
  moduleId: string | null;
  /** The block of the module the teacher put in focus (SPEC-054). */
  moduleFocusBlockId: string | null;
  /** Whether the teacher sends his terminal to the class; off until he says (SPEC-054 CA-10). */
  terminalBroadcast: boolean;
  deck: LiveDeck | null;
  strokes: LiveStroke[];
  cursor: { x: number; y: number; laser: boolean } | null;
  online: number;
}

export interface LiveTerminal {
  input: TerminalInputEvent | null;
  entries: TerminalCommandEvent[];
  state: unknown;
  /** Grows at every command, so a screen that mirrors it knows when to apply the machine. */
  revision: number;
}

interface State {
  room: LiveRoomState;
  terminal: LiveTerminal;
  hands: HandRaiseItem[];
  /** Where the student stands; null until the server says (SPEC-054 CA-01). */
  admission: AdmissionState | null;
  admissions: LiveAdmissions;
  ready: boolean;
  ended: boolean;
  passive: boolean;
}

const initial: State = {
  room: { mode: "SLIDES", slide: 1, moduleId: null, moduleFocusBlockId: null, terminalBroadcast: false, deck: null, strokes: [], cursor: null, online: 0 },
  terminal: { input: null, entries: [], state: null, revision: 0 },
  hands: [],
  admission: null,
  admissions: { waiting: [], admitted: [] },
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
        room: {
          mode: s.displayMode,
          slide: s.currentSlide,
          moduleId: s.moduleId ?? s.activeModuleId ?? null,
          moduleFocusBlockId: s.moduleFocusBlockId ?? null,
          terminalBroadcast: s.terminalBroadcast ?? false,
          deck: s.activeDeck ?? null,
          strokes: s.recentDrawings ?? [],
          cursor: null,
          online: s.onlineCount ?? 0,
        },
        terminal: {
          input: s.terminal?.input ?? null,
          entries: s.terminal?.entries ?? [],
          state: s.terminal?.state ?? null,
          revision: state.terminal.revision + 1,
        },
        hands: s.handRaises ?? [],
      };
    }
    case "live:slide:change":
      return { ...state, room: { ...state.room, slide: Number(data.slide) || 1, strokes: [] } };
    case "live:cursor:move":
      return { ...state, room: { ...state.room, cursor: { x: Number(data.x), y: Number(data.y), laser: Boolean(data.laser) } } };
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
    case "live:terminal:broadcast":
      return { ...state, room: { ...state.room, terminalBroadcast: Boolean(data.enabled) } };
    case "live:admission:state":
      return { ...state, admission: data.status as AdmissionState };
    case "live:admission:queue":
      return {
        ...state,
        admissions: { waiting: (data.waiting as LiveAdmissions["waiting"]) ?? [], admitted: (data.admitted as LiveAdmissions["admitted"]) ?? [] },
      };
    case "live:terminal:input":
      return { ...state, terminal: { ...state.terminal, input: data as unknown as TerminalInputEvent } };
    case "live:terminal:sync": {
      const entry = data as unknown as TerminalCommandEvent;
      return {
        ...state,
        terminal: { input: null, entries: [...state.terminal.entries, entry].slice(-200), state: entry.state, revision: state.terminal.revision + 1 },
      };
    }
    case "live:hand:queue":
      return { ...state, hands: (data.queue as HandRaiseItem[]) ?? [] };
    case "live:presence":
      return { ...state, room: { ...state.room, online: Number(data.online) || 0 } };
    case "live:control:revoked":
      return { ...state, passive: true };
    case "live:ended":
      return { ...state, ended: true };
    default:
      return state;
  }
}

const reducer = (state: State, action: Action): State => apply(state, action.message);

type Connect = (classId: string, handlers: LiveSocketHandlers) => LiveSocket;

/** The first wait before trying again, and the longest. */
const RETRY_FIRST_MS = 1000;
const RETRY_MAX_MS = 10_000;

export interface UseLiveClassroomOptions {
  classId: string;
  /** The teacher (and the administrator) controls the room; a student only follows it. */
  role: "teacher" | "student";
  connect?: Connect;
}

/**
 * The connection with the live classroom and its state: it reconnects by itself and, at every connection, the first message brings the
 * whole state of the room (SPEC-051 RN-07). What the teacher sends is also applied to his own screen, because the server does not echo it.
 */
export function useLiveClassroom({ classId, role, connect = openLiveSocket }: UseLiveClassroomOptions) {
  const [state, dispatch] = useReducer(reducer, initial);
  const [connected, setConnected] = useState(false);
  const socket = useRef<LiveSocket | null>(null);
  const finished = useRef(false);


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
      });
    };
    open();
    return () => {
      active = false;
      clearTimeout(timer);
      socket.current?.close();
    };
  }, [classId, connect]);

  const canControl = role === "teacher" && !state.passive;
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
    moveCursor: (x: number, y: number, laser: boolean) => emit("live:cursor:move", { x, y, laser }),
    draw: (path: Array<[number, number]>) => emit("live:canvas:draw", { path }),
    clearDrawings: () => emit("live:canvas:draw", { clear: true }),
    switchMode: (mode: LiveMode, moduleId?: string) => emit("live:mode:switch", moduleId ? { mode, moduleId } : { mode }),
    sendTerminalInput: (event: TerminalInputEvent) => emit("live:terminal:input", event),
    sendTerminalSync: (event: TerminalCommandEvent) => emit("live:terminal:sync", event),
    moderate: (studentId?: string) => {
      if (canControl) sendOnly("live:hand:moderate", studentId ? { studentId } : { all: true });
    },
    focusBlock: (blockId: string) => emit("live:module:focus", { blockId }),
    setTerminalBroadcast: (enabled: boolean) => emit("live:terminal:broadcast", { enabled }),
    acceptStudent: (studentId: string) => {
      if (canControl) sendOnly("live:admission:accept", { studentId });
    },
    acceptAll: () => {
      if (canControl) sendOnly("live:admission:accept-all", {});
    },
    removeStudent: (studentId: string) => {
      if (canControl) sendOnly("live:admission:remove", { studentId });
    },
    /** A student removed from the class asks to come in again. */
    requestEntry: () => sendOnly("live:admission:request", {}),
    raiseHand: () => sendOnly("live:hand:raise", {}),
    lowerHand: () => sendOnly("live:hand:lower", {}),
  };
}
