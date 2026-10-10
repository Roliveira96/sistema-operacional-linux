import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiProblemError } from "@/services/httpClient";
import type { SpeechResult } from "@/services/speechService";
import { HIGHLIGHT_CURRENT, HIGHLIGHT_SPOKEN, MAX_VOICE_SPEED, useNarrator } from "./useNarrator";

class FakeAudio {
  src = "";
  playbackRate = 1;
  currentTime = 0;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  play = vi.fn(() => Promise.resolve());
  pause = vi.fn();
  /** Ends the current chunk, as the browser does. */
  end() {
    this.onended?.();
  }
}

const highlights = new Map<string, { ranges: Range[] }>();

let audio: FakeAudio;
const createAudio = () => audio as unknown as HTMLAudioElement;

const result = (words: { word: string; startMs: number; endMs: number }[]): SpeechResult => ({
  audioBase64: "QUJD",
  mimeType: "audio/mpeg",
  voice: "pt-BR-FranciscaNeural",
  words,
});

function element(markup: string): HTMLElement {
  const target = document.createElement("div");
  target.innerHTML = markup;
  document.body.appendChild(target);
  return target;
}

const KERNEL = [
  { word: "Linux", startMs: 0, endMs: 300 },
  { word: "é", startMs: 310, endMs: 400 },
  { word: "o", startMs: 410, endMs: 500 },
  { word: "kernel.", startMs: 510, endMs: 900 },
];

function setup(service = { synthesize: vi.fn().mockResolvedValue(result(KERNEL)) }) {
  const onWarning = vi.fn();
  const hook = renderHook(() => useNarrator({ service, onWarning, createAudio }));
  return { ...hook, service, onWarning };
}

/** Lets the narration reach the point where the audio is playing. */
const playing = () => vi.waitFor(() => expect(audio.play).toHaveBeenCalled());

beforeEach(() => {
  audio = new FakeAudio();
  highlights.clear();
  localStorage.clear();
  vi.stubGlobal("Highlight", class { ranges: Range[]; constructor(...ranges: Range[]) { this.ranges = ranges; } });
  vi.stubGlobal("CSS", { highlights: { set: (name: string, value: { ranges: Range[] }) => highlights.set(name, value), delete: (name: string) => highlights.delete(name) } });
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => window.setTimeout(callback, 4));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
  window.requestAnimationFrame = globalThis.requestAnimationFrame;
  window.cancelAnimationFrame = globalThis.cancelAnimationFrame;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

// Covers SPEC-018 CA-01: the text of an element is spoken and the word is highlighted.
describe("useNarrator", () => {
  it("speaks the text of an element and highlights the word being said", async () => {
    const { result: hook, service } = setup();
    const target = element("<p>Linux é o <b>kernel</b>.</p>");

    let narration!: Promise<boolean>;
    act(() => {
      narration = hook.current.speak(target);
    });
    await playing();

    expect(service.synthesize).toHaveBeenCalledWith("Linux é o kernel.");
    expect(audio.src).toBe("data:audio/mpeg;base64,QUJD");

    audio.currentTime = 0.6;
    await vi.waitFor(() => expect(highlights.get(HIGHLIGHT_CURRENT)?.ranges[0]?.toString()).toBe("kernel."));
    expect(highlights.get(HIGHLIGHT_SPOKEN)?.ranges[0]?.toString()).toBe("Linux é o ");

    audio.end();
    await narration;
    expect(highlights.size).toBe(0);
  });

  it("works without the highlight API of the browser", async () => {
    vi.stubGlobal("CSS", {});
    const { result: hook } = setup();
    let narration!: Promise<boolean>;
    act(() => {
      narration = hook.current.speak(element("<p>Linux é o kernel.</p>"));
    });
    await playing();
    audio.currentTime = 0.6;
    await new Promise((resolve) => setTimeout(resolve, 20));
    audio.end();
    await narration;
    expect(highlights.size).toBe(0);
  });

  // Covers CA-13 (P-05): the voice never goes above 2x.
  it("follows the speed up to the limit of the voice", async () => {
    const { result: hook } = setup();
    act(() => hook.current.setSpeed(4));
    let narration!: Promise<boolean>;
    act(() => {
      narration = hook.current.speak(element("<p>Linux é o kernel.</p>"));
    });
    await playing();
    expect(audio.playbackRate).toBe(MAX_VOICE_SPEED);
    act(() => hook.current.setSpeed(0.5));
    expect(audio.playbackRate).toBe(0.5);
    audio.end();
    await narration;
  });

  // Covers CA-09 and CA-10: long texts go in chunks, the next one is asked for while the first plays, and repeats come from the cache.
  it("asks for the next chunk while one plays and reuses what it already has", async () => {
    const sentence = "Esta é uma frase de tamanho razoável para o teste. ";
    const long = sentence.repeat(60).trim();
    const service = { synthesize: vi.fn().mockResolvedValue(result([])) };
    const { result: hook } = setup(service);

    let first!: Promise<boolean>;
    act(() => {
      first = hook.current.speak(element(`<p>${long}</p>`));
    });
    await playing();
    await vi.waitFor(() => expect(service.synthesize).toHaveBeenCalledTimes(2));
    expect(service.synthesize.mock.calls.every(([text]) => (text as string).length <= 2000)).toBe(true);

    audio.end();
    await vi.waitFor(() => expect(audio.play).toHaveBeenCalledTimes(2));
    audio.end();
    await first;

    service.synthesize.mockClear();
    let again!: Promise<boolean>;
    act(() => {
      again = hook.current.speak(element(`<p>${long}</p>`));
    });
    await vi.waitFor(() => expect(audio.play).toHaveBeenCalledTimes(3));
    audio.end();
    await vi.waitFor(() => expect(audio.play).toHaveBeenCalledTimes(4));
    audio.end();
    await again;
    expect(service.synthesize).not.toHaveBeenCalled();
  });

  // Covers CA-07 and CA-08: with the sound off nothing is requested, and the choice is kept.
  it("stays silent and asks for nothing while the sound is off, and remembers the choice", async () => {
    const { result: hook, service } = setup();
    act(() => hook.current.setEnabled(false));
    expect(hook.current.enabled).toBe(false);
    expect(localStorage.getItem("exame-so:narracao")).toBe("off");

    await hook.current.speak(element("<p>Linux é o kernel.</p>"));
    expect(service.synthesize).not.toHaveBeenCalled();

    const again = renderHook(() => useNarrator({ service, createAudio }));
    expect(again.result.current.enabled).toBe(false);
    act(() => again.result.current.setEnabled(true));
    expect(localStorage.getItem("exame-so:narracao")).toBe("on");
  });

  it("has nothing to say for an element without words", async () => {
    const { result: hook, service } = setup();
    await hook.current.speak(element("<p> 🐧 </p>"));
    expect(service.synthesize).not.toHaveBeenCalled();
  });

  // Covers CA-06 (P-01): a visitor is detected by the 401 and then left in silence.
  it("learns that there is no session and stops asking", async () => {
    const service = { synthesize: vi.fn().mockRejectedValue(new ApiProblemError({ type: "not-authenticated", title: "x", status: 401 }, 401)) };
    const { result: hook, onWarning } = setup(service);
    await act(async () => {
      await hook.current.speak(element("<p>Linux é o kernel.</p>"));
    });
    expect(hook.current.needsLogin).toBe(true);
    expect(onWarning).not.toHaveBeenCalled();

    await hook.current.speak(element("<p>Outro texto.</p>"));
    expect(service.synthesize).toHaveBeenCalledTimes(1);
  });

  // Covers CA-05: a failed voice warns once and never blocks.
  it("warns only once for a stretch of failures, and again after stop", async () => {
    const service = { synthesize: vi.fn().mockRejectedValue(new ApiProblemError({ type: "speech-unavailable", title: "x", status: 503 }, 503)) };
    const { result: hook, onWarning } = setup(service);
    await hook.current.speak(element("<p>Primeiro texto.</p>"));
    await hook.current.speak(element("<p>Segundo texto.</p>"));
    expect(onWarning).toHaveBeenCalledTimes(1);
    expect(onWarning).toHaveBeenCalledWith("unavailable");

    act(() => hook.current.stop());
    await hook.current.speak(element("<p>Terceiro texto.</p>"));
    expect(onWarning).toHaveBeenCalledTimes(2);
  });

  // Covers CA-12: the browser may refuse to play without a click.
  it("warns when the browser refuses to play and keeps going", async () => {
    audio.play.mockRejectedValue(new DOMException("blocked", "NotAllowedError"));
    const { result: hook, onWarning } = setup();
    await act(async () => {
      await hook.current.speak(element("<p>Linux é o kernel.</p>"));
    });
    expect(onWarning).toHaveBeenCalledWith("autoplay");
  });

  it("ends a chunk whose audio fails to decode", async () => {
    const { result: hook } = setup();
    let narration!: Promise<boolean>;
    act(() => {
      narration = hook.current.speak(element("<p>Linux é o kernel.</p>"));
    });
    await playing();
    audio.onerror?.();
    await narration;
  });

  // Covers CA-04: stopping silences the voice and clears the highlight at once.
  it("stops the voice and the highlight on stop", async () => {
    const { result: hook } = setup();
    let narration!: Promise<boolean>;
    act(() => {
      narration = hook.current.speak(element("<p>Linux é o kernel.</p>"));
    });
    await playing();
    audio.currentTime = 0.6;
    await vi.waitFor(() => expect(highlights.size).toBeGreaterThan(0));

    act(() => hook.current.stop());
    await narration;
    expect(audio.pause).toHaveBeenCalled();
    expect(highlights.size).toBe(0);
  });

  it("cuts the previous narration when a new one begins", async () => {
    const { result: hook } = setup();
    let first!: Promise<boolean>;
    act(() => {
      first = hook.current.speak(element("<p>Primeiro texto.</p>"));
    });
    await playing();
    act(() => {
      hook.current.speak(element("<p>Segundo texto.</p>"));
    });
    await first;
    expect(audio.pause).toHaveBeenCalled();
  });

  it("does not play a chunk that arrives after a stop", async () => {
    let arrive: (value: SpeechResult) => void = () => {};
    const service = { synthesize: vi.fn().mockReturnValue(new Promise<SpeechResult>((resolve) => (arrive = resolve))) };
    const { result: hook } = setup(service);
    let narration!: Promise<boolean>;
    act(() => {
      narration = hook.current.speak(element("<p>Linux é o kernel.</p>"));
    });
    act(() => hook.current.stop());
    arrive(result(KERNEL));
    await narration;
    expect(audio.play).not.toHaveBeenCalled();
  });

  it("falls back to a new Audio when none is provided", async () => {
    const created: unknown[] = [];
    vi.stubGlobal("Audio", function () {
      audio = new FakeAudio();
      created.push(audio);
      return audio;
    });
    const service = { synthesize: vi.fn().mockResolvedValue(result(KERNEL)) };
    const { result: hook } = renderHook(() => useNarrator({ service }));
    let narration!: Promise<boolean>;
    act(() => {
      narration = hook.current.speak(element("<p>Linux é o kernel.</p>"));
    });
    await playing();
    expect(created).toHaveLength(1);
    audio.end();
    await narration;
  });

  // Covers SPEC-018 CA-02 and CA-16: the caller learns whether the speech was cut.
  it("resolves to true when everything was said and to false when it was cut", async () => {
    const { result: hook } = setup();
    let first!: Promise<boolean>;
    act(() => {
      first = hook.current.speak(element("<p>Linux é o kernel.</p>"));
    });
    await playing();
    audio.end();
    expect(await first).toBe(true);

    let second!: Promise<boolean>;
    act(() => {
      second = hook.current.speak(element("<p>Outro texto qualquer.</p>"));
    });
    act(() => hook.current.stop());
    expect(await second).toBe(false);
  });

  it("resolves to true when the voice is skipped: sound off, no words, or a failure", async () => {
    const failing = { synthesize: vi.fn().mockRejectedValue(new Error("boom")) };
    const { result: hook } = setup(failing);
    expect(await hook.current.speak(element("<p>Falha na voz.</p>"))).toBe(true);
    expect(await hook.current.speak(element("<p> 🐧 </p>"))).toBe(true);
    act(() => hook.current.setEnabled(false));
    expect(await hook.current.speak(element("<p>Som desligado.</p>"))).toBe(true);
  });

  // Covers CA-15: the command is said, then what it does, then the notice, in this order.
  it("speaks a list of parts in order and highlights the whole element of a text part", async () => {
    const service = { synthesize: vi.fn().mockResolvedValue(result([])) };
    const { result: hook } = setup(service);
    const command = element("<code>ls -l</code>");
    const explanation = element("<span>lista os arquivos</span>");

    let done!: Promise<boolean>;
    act(() => {
      done = hook.current.speak([{ text: "ls traço l", highlight: command }, { element: explanation }, { text: "Veja o comando rodando no terminal ao lado." }]);
    });
    await vi.waitFor(() => expect(audio.play).toHaveBeenCalledTimes(1));
    expect(highlights.get(HIGHLIGHT_CURRENT)?.ranges[0]?.toString()).toBe("ls -l");
    audio.end();
    await vi.waitFor(() => expect(audio.play).toHaveBeenCalledTimes(2));
    audio.end();
    await vi.waitFor(() => expect(audio.play).toHaveBeenCalledTimes(3));
    expect(highlights.get(HIGHLIGHT_CURRENT)?.ranges[0]?.toString()).not.toBe("ls -l");
    audio.end();
    expect(await done).toBe(true);
    expect(service.synthesize.mock.calls.map(([text]) => text)).toEqual(["ls traço l", "lista os arquivos", "Veja o comando rodando no terminal ao lado."]);
  });
});
