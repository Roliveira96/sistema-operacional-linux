import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authoringMessages } from "@/messages/authoring.pt-BR";
import { contentMessages } from "@/messages/content.pt-BR";
import "@/test/domMatchers";
import { EXAMPLE_STEP_MS, KindExample } from "./KindExample";

const m = authoringMessages.questionKinds;
const e = m.example;
const right = contentMessages.trueFalse.right;

const reducedMotion = (on: boolean) =>
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({ matches: on && query.includes("reduce"), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );

beforeEach(() => {
  vi.useFakeTimers();
  reducedMotion(false);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const advance = (steps = 1) =>
  act(() => {
    vi.advanceTimersByTime(EXAMPLE_STEP_MS * steps);
  });

describe("KindExample", () => {
  // Covers SPEC-040 CA-01, CA-06 and D-01: the example is the screen of the student, marked as an example and out of reach.
  it("shows the example of the kind as the student sees it, marked as an example", () => {
    const { container } = render(<KindExample kind="THEORETICAL_BOOLEAN" />);
    expect(screen.getByRole("figure", { name: e.label(m.label.THEORETICAL_BOOLEAN) })).toBeInTheDocument();
    expect(screen.getByText(e.badge)).toBeInTheDocument();
    expect(screen.getByText(e.statement.THEORETICAL_BOOLEAN)).toBeInTheDocument();
    expect(container.querySelector("[inert]")).not.toBeNull();
  });

  // Covers SPEC-040 CA-03, D-03 and D-05: the cycle goes from the question to the answer and the result, right, and starts again.
  it("plays the answer and the result in a cycle", () => {
    render(<KindExample kind="THEORETICAL_BOOLEAN" />);
    expect(screen.queryByText(right)).toBeNull();
    advance(2);
    expect(screen.getByText(right)).toBeInTheDocument();
    advance(2);
    expect(screen.queryByText(right)).toBeNull();
  });

  it("has an example for each kind", () => {
    for (const kind of ["PRACTICAL", "THEORETICAL_SINGLE", "THEORETICAL_MATCHING", "DISCURSIVE"] as const) {
      render(<KindExample kind={kind} />);
      expect(screen.getByRole("figure", { name: e.label(m.label[kind]) })).toBeInTheDocument();
      advance(2);
      cleanup();
    }
    render(<KindExample kind="PRACTICAL" />);
    advance(2);
    expect(screen.getByText(e.terminalDone)).toBeInTheDocument();
    cleanup();
    render(<KindExample kind="DISCURSIVE" />);
    advance(1);
    expect(screen.getByText(contentMessages.descriptive.pending)).toBeInTheDocument();
    advance(1);
    expect(screen.getByText(contentMessages.descriptive.score(100))).toBeInTheDocument();
  });

  // Covers SPEC-040 D-04: the cycle can be paused and continued.
  it("pauses and continues", () => {
    render(<KindExample kind="THEORETICAL_BOOLEAN" />);
    fireEvent.click(screen.getByRole("button", { name: e.pause }));
    advance(4);
    expect(screen.queryByText(right)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: e.play }));
    advance(2);
    expect(screen.getByText(right)).toBeInTheDocument();
  });

  // Covers SPEC-040 CA-05: with reduced motion the example stands still, with the result.
  it("stands still with the result when the system asks for less motion", () => {
    reducedMotion(true);
    render(<KindExample kind="THEORETICAL_BOOLEAN" />);
    expect(screen.getByText(right)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: e.pause })).toBeNull();
    advance(4);
    expect(screen.getByText(right)).toBeInTheDocument();
  });

  // Covers SPEC-040 CA-04: the example never calls the server.
  it("never calls the server", () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    for (const kind of ["PRACTICAL", "THEORETICAL_BOOLEAN", "THEORETICAL_SINGLE", "THEORETICAL_MATCHING", "DISCURSIVE"] as const) {
      render(<KindExample kind={kind} />);
      advance(3);
      cleanup();
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
});
