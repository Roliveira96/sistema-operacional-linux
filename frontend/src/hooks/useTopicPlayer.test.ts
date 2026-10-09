import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildTopicScript } from "@/lib/topicScript";
import { useTopicPlayer, type PlayerControls } from "./useTopicPlayer";

const script = buildTopicScript([
  { id: "1", type: "TEXT", position: 1, payload: { title: "A", command: "a", html: "" } },
  { id: "2", type: "COMMAND", position: 2, payload: { steps: [{ command: "one" }, { command: "two" }] } },
  { id: "3", type: "TEXT", position: 3, payload: { title: "B", command: "b", html: "" } },
  { id: "4", type: "COMMAND", position: 4, payload: { steps: [{ command: "three" }] } },
]);

function setup() {
  const ran: string[] = [];
  const speeds: number[] = [];
  const controls: PlayerControls = {
    runStep: vi.fn(async (step) => {
      ran.push(step.command);
    }),
    resetMachine: vi.fn(),
    setTerminalSpeed: (speed) => speeds.push(speed),
    onCardStart: vi.fn(),
    onBack: vi.fn(),
  };
  const hook = renderHook(() => useTopicPlayer(script, controls, 2));
  return { ...hook, ran, speeds, controls };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

// Covers SPEC-016 CA-03: the player runs the script, one step or all of it.
describe("useTopicPlayer", () => {
  it("starts idle at the saved speed and applies it to the terminal", () => {
    const { result, speeds } = setup();
    expect(result.current).toMatchObject({ index: -1, playing: false, speed: 2, running: null });
    expect(speeds).toContain(2);
  });

  it("runs the next step and remembers it as done", async () => {
    const { result, ran } = setup();
    await act(async () => {
      await result.current.next();
    });
    expect(ran).toEqual(["one"]);
    expect(result.current.index).toBe(0);
    expect(result.current.done.has(0)).toBe(true);
    await act(async () => {
      await result.current.runOne(99);
    });
    expect(ran).toEqual(["one"]);
  });

  it("plays the whole script in order and stops at the end", async () => {
    const { result, ran, controls } = setup();
    await act(async () => {
      result.current.toggleAll();
      await vi.runAllTimersAsync();
    });
    expect(ran).toEqual(["one", "two", "three"]);
    expect(result.current.playing).toBe(false);
    expect(result.current.index).toBe(2);
    expect(controls.onCardStart).toHaveBeenCalledWith(0);
    expect(controls.onCardStart).toHaveBeenCalledWith(1);
  });

  it("stops when the play button is pressed again", async () => {
    const { result, ran } = setup();
    await act(async () => {
      result.current.toggleAll();
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(result.current.playing).toBe(true);
    await act(async () => {
      result.current.toggleAll();
      await vi.runAllTimersAsync();
    });
    expect(result.current.playing).toBe(false);
    expect(ran.length).toBeLessThan(3);
  });

  it("restarts from the beginning when the script was finished", async () => {
    const { result, ran } = setup();
    await act(async () => {
      result.current.toggleAll();
      await vi.runAllTimersAsync();
    });
    await act(async () => {
      result.current.toggleAll();
      await vi.runAllTimersAsync();
    });
    expect(ran).toEqual(["one", "two", "three", "one", "two", "three"]);
  });

  it("plays only the steps of one card", async () => {
    const { result, ran } = setup();
    await act(async () => {
      result.current.toggleCard(1);
      await vi.runAllTimersAsync();
    });
    expect(ran).toEqual(["three"]);
    expect(result.current.playingCard).toBeNull();
    expect(result.current.playing).toBe(false);
  });

  it("stops a card that is playing when its button is pressed again", async () => {
    const { result, ran } = setup();
    await act(async () => {
      result.current.toggleCard(0);
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(result.current.playingCard).toBe(0);
    await act(async () => {
      result.current.toggleCard(0);
      await vi.runAllTimersAsync();
    });
    expect(ran).toEqual(["one"]);
    expect(result.current.playingCard).toBeNull();
  });

  it("ignores a card that does not exist", async () => {
    const { result, ran } = setup();
    await act(async () => {
      result.current.toggleCard(9);
      await vi.runAllTimersAsync();
    });
    expect(ran).toEqual([]);
  });

  // The back button resets the machine and replays quickly up to the previous step.
  it("goes back by resetting the machine and replaying fast up to the previous step", async () => {
    const { result, ran, speeds, controls } = setup();
    await act(async () => {
      await result.current.next();
      await result.current.next();
      await result.current.next();
    });
    expect(result.current.index).toBe(2);
    ran.length = 0;
    await act(async () => {
      await result.current.back();
    });
    expect(controls.resetMachine).toHaveBeenCalledTimes(1);
    expect(ran).toEqual(["one", "two"]);
    expect(result.current.index).toBe(1);
    expect([...result.current.done]).toEqual([0, 1]);
    expect(speeds.at(-1)).toBe(2);
    expect(speeds).toContain(30);
    expect(controls.onBack).toHaveBeenCalledWith(1);
  });

  it("does nothing when there is nothing to go back to", async () => {
    const { result, controls } = setup();
    await act(async () => {
      await result.current.back();
    });
    expect(controls.resetMachine).not.toHaveBeenCalled();
  });

  it("changes the speed and forgets the progress on rewind", async () => {
    const { result, speeds } = setup();
    act(() => result.current.setSpeed(4));
    expect(result.current.speed).toBe(4);
    expect(speeds.at(-1)).toBe(4);
    await act(async () => {
      await result.current.next();
    });
    act(() => result.current.rewind());
    expect(result.current.index).toBe(-1);
    expect(result.current.done.size).toBe(0);
  });

  // Covers SPEC-018 CA-01 to CA-03: the card is read and its commands run, in the order of the page.
  it("narrates the title and the text blocks around the commands of a card", async () => {
    const { result, ran, controls } = setupWithText();
    await act(async () => {
      result.current.toggleCard(0);
      await vi.runAllTimersAsync();
    });
    expect(ran).toEqual(["title0", "block:h0", "block:t0", "one", "two", "block:t1"]);
    expect(controls.onStop).toHaveBeenCalledTimes(1);
  });

  it("plays the whole script narrating, scrolling to each card and continuing after the last step run", async () => {
    const { result, ran, controls } = setupWithText();
    await act(async () => {
      await result.current.next();
    });
    ran.length = 0;
    await act(async () => {
      result.current.toggleAll();
      await vi.runAllTimersAsync();
    });
    expect(ran).toEqual(["two", "block:t1", "title1", "block:h1", "three"]);
    expect(controls.onCardStart).toHaveBeenCalledWith(1);
    expect(controls.onStop).toHaveBeenCalled();
  });

  // Covers SPEC-018 CA-16: a step whose narration was cut is not run and not marked as done.
  it("does not mark a step as done when it was not run", async () => {
    const { result, controls } = setupWithText();
    vi.mocked(controls.runStep).mockResolvedValueOnce(false);
    await act(async () => {
      await result.current.next();
    });
    expect(result.current.index).toBe(-1);
    expect(result.current.done.size).toBe(0);
  });

  it("replays the script without narration when going back", async () => {
    const { result, controls } = setupWithText();
    await act(async () => {
      await result.current.next();
      await result.current.next();
    });
    await act(async () => {
      await result.current.back();
    });
    expect(vi.mocked(controls.runStep).mock.calls.at(-1)?.[1]).toBe(true);
    expect(vi.mocked(controls.runStep).mock.calls[0]?.[1]).toBeUndefined();
  });

  // Covers CA-04: stopping, going back or rewinding silences the voice.
  it("silences the voice when the student stops, goes back or rewinds", async () => {
    const { result, controls } = setupWithText();
    await act(async () => {
      result.current.toggleCard(0);
      await vi.advanceTimersByTimeAsync(10);
    });
    await act(async () => {
      result.current.toggleCard(0);
      await vi.runAllTimersAsync();
    });
    expect(controls.stopNarration).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.next();
    });
    await act(async () => {
      await result.current.back();
    });
    expect(controls.stopNarration).toHaveBeenCalledTimes(2);
    act(() => result.current.rewind());
    expect(controls.stopNarration).toHaveBeenCalledTimes(3);
  });
});

function setupWithText() {
  const withText = buildTopicScript([
    { id: "h0", type: "TEXT", position: 1, payload: { title: "A", command: "a", html: "" } },
    { id: "t0", type: "TIP", position: 2, payload: { html: "x" } },
    { id: "c0", type: "COMMAND", position: 3, payload: { steps: [{ command: "one" }, { command: "two" }] } },
    { id: "t1", type: "CURIOSITY", position: 4, payload: { html: "y" } },
    { id: "h1", type: "TEXT", position: 5, payload: { title: "B", command: "b", html: "" } },
    { id: "c1", type: "COMMAND", position: 6, payload: { steps: [{ command: "three" }] } },
  ]);
  const ran: string[] = [];
  const controls: PlayerControls = {
    runStep: vi.fn(async (step) => {
      ran.push(step.command);
    }),
    resetMachine: vi.fn(),
    setTerminalSpeed: vi.fn(),
    onCardStart: vi.fn(),
    onStop: vi.fn(),
    stopNarration: vi.fn(),
    narrate: vi.fn(async (item) => {
      ran.push(item.kind === "title" ? `title${item.card}` : item.kind === "block" ? `block:${item.blockId}` : "step");
    }),
  };
  const hook = renderHook(() => useTopicPlayer(withText, controls, 1));
  return { ...hook, ran, controls };
}
