"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { alignWords, readNarration, splitIntoChunks, wordAt, type NarrationChunk, type NarrationText } from "@/lib/narration";
import { loadNarration, saveNarration } from "@/lib/machineStorage";
import { ApiProblemError } from "@/services/httpClient";
import type { SpeechResult } from "@/services/speechService";

/** The synthetic voice is unintelligible above this speed (SPEC-018, P-05). */
export const MAX_VOICE_SPEED = 2;

export const HIGHLIGHT_CURRENT = "narration-current";
export const HIGHLIGHT_SPOKEN = "narration-spoken";

export type NarrationWarning = "unavailable" | "autoplay";

/**
 * What to say: the words of an element (highlighted word by word, as in a
 * karaoke) or a text of its own, optionally with one element highlighted as a whole.
 */
export type NarrationPart = { element: Element } | { text: string; highlight?: Element };

export interface Narrator {
  enabled: boolean;
  setEnabled(enabled: boolean): void;
  /** True once the server said there is no session (SPEC-018, P-01). */
  needsLogin: boolean;
  /**
   * Speaks an element or a list of parts, in order. Resolves to true when everything
   * was said or skipped (sound off, no session, failure), and to false when it was
   * cut by stop() or by another narration.
   */
  speak(source: Element | NarrationPart[]): Promise<boolean>;
  /** Silences the voice at once and cancels what is pending. */
  stop(): void;
  setSpeed(speed: number): void;
}

export interface NarratorOptions {
  service: { synthesize(text: string): Promise<SpeechResult> };
  /** Called at most once per stretch of narration, until stop(). */
  onWarning?(warning: NarrationWarning): void;
  createAudio?(): HTMLAudioElement;
  initialSpeed?: number;
}

/** One request of speech: a chunk of text and how to show it while it plays. */
interface Unit {
  chunk: NarrationChunk;
  /** Word by word, when the text is the text of an element. */
  words: NarrationText | null;
  /** The whole element highlighted at once, for texts of their own. */
  whole: Range | null;
}

function unitsOf(source: Element | NarrationPart[]): Unit[] {
  const parts: NarrationPart[] = Array.isArray(source) ? source : [{ element: source }];
  return parts.flatMap((part): Unit[] => {
    if ("element" in part) {
      const words = readNarration(part.element);
      return splitIntoChunks(words.text).map((chunk) => ({ chunk, words, whole: null }));
    }
    let whole: Range | null = null;
    if (part.highlight) {
      whole = part.highlight.ownerDocument.createRange();
      whole.selectNodeContents(part.highlight);
    }
    return splitIntoChunks(part.text).map((chunk) => ({ chunk, words: null, whole }));
  });
}

const highlightsSupported = () => typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight !== "undefined";

function paint(current: Range | null, spoken: Range | null) {
  if (!highlightsSupported()) return;
  if (current) CSS.highlights.set(HIGHLIGHT_CURRENT, new Highlight(current));
  else CSS.highlights.delete(HIGHLIGHT_CURRENT);
  if (spoken) CSS.highlights.set(HIGHLIGHT_SPOKEN, new Highlight(spoken));
  else CSS.highlights.delete(HIGHLIGHT_SPOKEN);
}

function frames(callback: () => void): () => void {
  if (typeof window.requestAnimationFrame !== "function") return () => {};
  let id = 0;
  let live = true;
  const tick = () => {
    if (!live) return;
    callback();
    id = window.requestAnimationFrame(tick);
  };
  id = window.requestAnimationFrame(tick);
  return () => {
    live = false;
    window.cancelAnimationFrame?.(id);
  };
}

/**
 * The voice of the karaoke reader (SPEC-018): turns the text of an element into
 * speech chunks, plays them one after the other asking for the next while the
 * current one plays, and highlights the word being said. It never throws: a
 * failure leaves the page silent and reports one warning.
 */
export function useNarrator({ service, onWarning, createAudio, initialSpeed = 1 }: NarratorOptions): Narrator {
  const [enabled, setEnabledState] = useState(loadNarration);
  const [needsLogin, setNeedsLogin] = useState(false);

  const core = useRef({
    generation: 0,
    enabled,
    needsLogin: false,
    warned: false,
    speed: initialSpeed,
    audio: null as HTMLAudioElement | null,
    cancelPlayback: null as null | (() => void),
    cache: new Map<string, Promise<SpeechResult>>(),
    service,
    onWarning,
    createAudio,
  });
  useEffect(() => {
    core.current.service = service;
    core.current.onWarning = onWarning;
    core.current.createAudio = createAudio;
  });

  /** Cuts the current narration; the warning memory is kept so a card warns only once. */
  const halt = useCallback(() => {
    const c = core.current;
    c.generation++;
    c.cancelPlayback?.();
    c.audio?.pause();
    paint(null, null);
  }, []);

  const stop = useCallback(() => {
    halt();
    core.current.warned = false;
  }, [halt]);

  useEffect(() => stop, [stop]);

  const setEnabled = useCallback(
    (value: boolean) => {
      core.current.enabled = value;
      setEnabledState(value);
      saveNarration(value);
      if (!value) stop();
    },
    [stop],
  );

  const setSpeed = useCallback((speed: number) => {
    const c = core.current;
    c.speed = speed;
    if (c.audio) c.audio.playbackRate = Math.min(speed, MAX_VOICE_SPEED);
  }, []);

  const warn = useCallback((warning: NarrationWarning) => {
    const c = core.current;
    if (c.warned) return;
    c.warned = true;
    c.onWarning?.(warning);
  }, []);

  const fetchChunk = useCallback((text: string): Promise<SpeechResult> => {
    const c = core.current;
    let request = c.cache.get(text);
    if (!request) {
      request = c.service.synthesize(text);
      c.cache.set(text, request);
      request.catch(() => c.cache.delete(text));
    }
    return request;
  }, []);

  /** Plays one chunk to the end, moving the highlight; resolves on end, error or stop. */
  const playChunk = useCallback(
    (result: SpeechResult, unit: Unit): Promise<void> => {
      const c = core.current;
      c.audio ??= c.createAudio ? c.createAudio() : new Audio();
      const audio = c.audio;
      const words = unit.words ? alignWords(unit.chunk.text, result.words) : [];
      return new Promise<void>((resolve) => {
        let stopFrames = () => {};
        const finish = () => {
          stopFrames();
          audio.onended = null;
          audio.onerror = null;
          c.cancelPlayback = null;
          resolve();
        };
        c.cancelPlayback = finish;
        audio.onended = finish;
        audio.onerror = finish;
        audio.src = `data:${result.mimeType};base64,${result.audioBase64}`;
        audio.playbackRate = Math.min(c.speed, MAX_VOICE_SPEED);
        audio.play().then(
          () => {
            if (unit.whole) return paint(unit.whole, null);
            const text = unit.words;
            if (!text) return;
            let last = -2;
            stopFrames = frames(() => {
              const index = wordAt(words, audio.currentTime * 1000);
              if (index === last) return;
              last = index;
              const word = words[index];
              if (!word) return paint(null, null);
              const start = unit.chunk.start + word.start;
              paint(text.locate(start, unit.chunk.start + word.end), text.locate(0, start));
            });
          },
          () => {
            warn("autoplay");
            finish();
          },
        );
      });
    },
    [warn],
  );

  const speak = useCallback(
    async (source: Element | NarrationPart[]): Promise<boolean> => {
      const c = core.current;
      halt();
      if (!c.enabled || c.needsLogin) return true;
      const units = unitsOf(source);
      if (units.length === 0) return true;

      const generation = c.generation;
      const live = () => c.generation === generation;
      try {
        for (let i = 0; i < units.length && live(); i++) {
          const result = await fetchChunk(units[i]!.chunk.text);
          if (!live()) return false;
          const next = units[i + 1];
          if (next) fetchChunk(next.chunk.text).catch(() => {});
          await playChunk(result, units[i]!);
        }
      } catch (error) {
        if (!live()) return false;
        if (error instanceof ApiProblemError && error.status === 401) {
          c.needsLogin = true;
          setNeedsLogin(true);
        } else {
          warn("unavailable");
        }
      } finally {
        if (live()) paint(null, null);
      }
      return live();
    },
    [fetchChunk, halt, playChunk, warn],
  );

  return { enabled, setEnabled, needsLogin, speak, stop, setSpeed };
}
