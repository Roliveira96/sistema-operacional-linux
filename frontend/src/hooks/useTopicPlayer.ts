"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ScriptStep, TimelineItem, TopicScript } from "@/lib/topicScript";

/** Pause between the steps of "play all" and of "play card", at speed 1 (as in the prototype). */
const GAP_ALL_MS = 900;
const GAP_CARD_MS = 800;
const CARD_SCROLL_MS = 350;
/** Speed used to replay the script when going back one step. */
const REPLAY_SPEED = 30;

export interface PlayerControls {
  /**
   * Types and runs one step in the terminal. With `silent` the step is not narrated
   * (used to replay the script when going back). Resolves to false when the step was
   * not run because the narration was stopped first.
   */
  runStep(step: ScriptStep, silent?: boolean): Promise<void | boolean>;
  /** Restores the topic machine at once, without animation. */
  resetMachine(): void;
  setTerminalSpeed(speed: number): void;
  /** Called when a card starts playing, to bring it into view. */
  onCardStart?(card: number): void;
  /** Called after going back, to tell the student what happened. */
  onBack?(target: number): void;
  /** Reads a title or text block aloud; resolves when it was spoken or skipped (SPEC-018). */
  narrate?(item: TimelineItem): Promise<void>;
  /** Silences the voice at once. */
  stopNarration?(): void;
  /** Called when the player stops, by itself or by the student. */
  onStop?(): void;
}

export interface TopicPlayer {
  /** Index of the last step run, or -1. */
  index: number;
  playing: boolean;
  /** Card being played by its own button, or null (idle or playing the whole script). */
  playingCard: number | null;
  /** Step running right now, or null. */
  running: number | null;
  done: ReadonlySet<number>;
  speed: number;
  setSpeed(speed: number): void;
  toggleAll(): void;
  toggleCard(card: number): void;
  runOne(step: number): Promise<void>;
  next(): Promise<void>;
  back(): Promise<void>;
  /** Forgets the progress (after a machine reset). */
  rewind(): void;
}

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/** The automatic reader of the prototype: play all, play one card, step, step back and speed. */
export function useTopicPlayer(script: TopicScript, controls: PlayerControls, initialSpeed = 1): TopicPlayer {
  const [index, setIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [playingCard, setPlayingCard] = useState<number | null>(null);
  const [running, setRunning] = useState<number | null>(null);
  const [done, setDone] = useState<ReadonlySet<number>>(new Set());
  const [speed, setSpeedState] = useState(initialSpeed);

  const ref = useRef({ index: -1, playing: false, busy: false, speed: initialSpeed, script, controls });
  useEffect(() => {
    ref.current.script = script;
    ref.current.controls = controls;
  });

  useEffect(() => {
    const state = ref.current;
    state.controls.setTerminalSpeed(state.speed);
    return () => {
      state.playing = false;
    };
  }, []);

  const setSpeed = useCallback((value: number) => {
    ref.current.speed = value;
    setSpeedState(value);
    ref.current.controls.setTerminalSpeed(value);
  }, []);

  const setPlayingBoth = (value: boolean) => {
    ref.current.playing = value;
    setPlaying(value);
  };

  const runOne = useCallback(async (step: number) => {
    const state = ref.current;
    const target = state.script.steps[step];
    if (state.busy || !target) return;
    state.busy = true;
    setRunning(step);
    try {
      if ((await state.controls.runStep(target)) === false) return;
      state.index = step;
      setIndex(step);
      setDone((prev) => new Set(prev).add(step));
    } finally {
      state.busy = false;
      setRunning(null);
    }
  }, []);

  /** Plays timeline items in order until the end or until the student stops. */
  const playItems = useCallback(
    async (items: TimelineItem[], gap: number, scrollToCards: boolean) => {
      const state = ref.current;
      for (let k = 0; k < items.length && state.playing; k++) {
        const item = items[k]!;
        if (item.kind === "step") {
          await runOne(item.step);
          if (k < items.length - 1) await sleep(gap / state.speed);
          continue;
        }
        if (item.kind === "title" && scrollToCards) {
          state.controls.onCardStart?.(item.card);
          await sleep(CARD_SCROLL_MS);
        }
        await state.controls.narrate?.(item);
      }
    },
    [runOne],
  );

  const stopPlaying = useCallback(() => {
    const state = ref.current;
    setPlayingBoth(false);
    state.controls.stopNarration?.();
  }, []);

  const toggleAll = useCallback(() => {
    const state = ref.current;
    if (state.playing) {
      stopPlaying();
      return;
    }
    void (async () => {
      if (state.index + 1 >= state.script.steps.length) {
        state.index = -1;
        setIndex(-1);
        setDone(new Set());
      }
      // Continue right after the last step that ran (text blocks that follow it included).
      const last = state.script.timeline.findIndex((item) => item.kind === "step" && item.step === state.index);
      const rest = state.script.timeline.slice(last + 1);
      setPlayingBoth(true);
      setPlayingCard(null);
      await playItems(rest, GAP_ALL_MS, true);
      setPlayingBoth(false);
      state.controls.onStop?.();
    })();
  }, [playItems, stopPlaying]);

  const toggleCard = useCallback(
    (cardIndex: number) => {
      const state = ref.current;
      if (state.playing) {
        stopPlaying();
        return;
      }
      const card = state.script.cards[cardIndex];
      if (!card || state.busy) return;
      void (async () => {
        setPlayingBoth(true);
        setPlayingCard(cardIndex);
        state.controls.onCardStart?.(cardIndex);
        await playItems(card.items, GAP_CARD_MS, false);
        setPlayingBoth(false);
        setPlayingCard(null);
        state.controls.onStop?.();
      })();
    },
    [playItems, stopPlaying],
  );

  const back = useCallback(async () => {
    const state = ref.current;
    if (state.busy || state.index < 0) return;
    stopPlaying();
    const target = state.index - 1;
    state.busy = true;
    state.controls.resetMachine();
    state.controls.setTerminalSpeed(REPLAY_SPEED);
    try {
      for (let i = 0; i <= target; i++) {
        const step = state.script.steps[i];
        if (step) await state.controls.runStep(step, true);
      }
    } finally {
      state.controls.setTerminalSpeed(state.speed);
      state.index = target;
      state.busy = false;
      setIndex(target);
      setDone(new Set(Array.from({ length: target + 1 }, (_, i) => i)));
      state.controls.onBack?.(target);
    }
  }, [stopPlaying]);

  const rewind = useCallback(() => {
    ref.current.index = -1;
    stopPlaying();
    setPlayingCard(null);
    setIndex(-1);
    setDone(new Set());
  }, [stopPlaying]);

  return {
    index,
    playing,
    playingCard,
    running,
    done,
    speed,
    setSpeed,
    toggleAll,
    toggleCard,
    runOne,
    next: () => runOne(ref.current.index + 1),
    back,
    rewind,
  };
}
