"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cardOfStep, type ScriptStep, type TopicScript } from "@/lib/topicScript";

/** Pause between the steps of "play all" and of "play card", at speed 1 (as in the prototype). */
const GAP_ALL_MS = 900;
const GAP_CARD_MS = 800;
const CARD_SCROLL_MS = 350;
/** Speed used to replay the script when going back one step. */
const REPLAY_SPEED = 30;

export interface PlayerControls {
  /** Types and runs one step in the terminal. */
  runStep(step: ScriptStep): Promise<void>;
  /** Restores the topic machine at once, without animation. */
  resetMachine(): void;
  setTerminalSpeed(speed: number): void;
  /** Called when a card starts playing, to bring it into view. */
  onCardStart?(card: number): void;
  /** Called after going back, to tell the student what happened. */
  onBack?(target: number): void;
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
      await state.controls.runStep(target);
      state.index = step;
      setIndex(step);
      setDone((prev) => new Set(prev).add(step));
    } finally {
      state.busy = false;
      setRunning(null);
    }
  }, []);

  const toggleAll = useCallback(() => {
    const state = ref.current;
    if (state.playing) {
      setPlayingBoth(false);
      return;
    }
    void (async () => {
      if (state.index + 1 >= state.script.steps.length) {
        state.index = -1;
        setIndex(-1);
        setDone(new Set());
      }
      setPlayingBoth(true);
      setPlayingCard(null);
      while (state.playing && state.index + 1 < state.script.steps.length) {
        const nextStep = state.index + 1;
        const card = state.script.cards[cardOfStep(state.script.cards, nextStep)];
        if (card && card.start === nextStep) {
          state.controls.onCardStart?.(card.index);
          await sleep(CARD_SCROLL_MS);
        }
        await runOne(nextStep);
        await sleep(GAP_ALL_MS / state.speed);
      }
      setPlayingBoth(false);
    })();
  }, [runOne]);

  const toggleCard = useCallback(
    (cardIndex: number) => {
      const state = ref.current;
      if (state.playing) {
        setPlayingBoth(false);
        return;
      }
      const card = state.script.cards[cardIndex];
      if (!card || state.busy) return;
      void (async () => {
        setPlayingBoth(true);
        setPlayingCard(cardIndex);
        state.controls.onCardStart?.(cardIndex);
        for (let i = card.start; i < card.end && state.playing; i++) {
          await runOne(i);
          if (i < card.end - 1) await sleep(GAP_CARD_MS / state.speed);
        }
        setPlayingBoth(false);
        setPlayingCard(null);
      })();
    },
    [runOne],
  );

  const back = useCallback(async () => {
    const state = ref.current;
    if (state.busy || state.index < 0) return;
    setPlayingBoth(false);
    const target = state.index - 1;
    state.busy = true;
    state.controls.resetMachine();
    state.controls.setTerminalSpeed(REPLAY_SPEED);
    try {
      for (let i = 0; i <= target; i++) {
        const step = state.script.steps[i];
        if (step) await state.controls.runStep(step);
      }
    } finally {
      state.controls.setTerminalSpeed(state.speed);
      state.index = target;
      state.busy = false;
      setIndex(target);
      setDone(new Set(Array.from({ length: target + 1 }, (_, i) => i)));
      state.controls.onBack?.(target);
    }
  }, []);

  const rewind = useCallback(() => {
    ref.current.index = -1;
    setPlayingBoth(false);
    setPlayingCard(null);
    setIndex(-1);
    setDone(new Set());
  }, []);

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
