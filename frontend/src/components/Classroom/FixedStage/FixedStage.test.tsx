import { readFileSync } from "node:fs";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FixedStage, StagePointer, StageScale, StageZoom, useStageScale, useStageZoom } from "./FixedStage";
import { STAGE_HEIGHT as H, STAGE_WIDTH as W } from "./stage";

// The path goes through a variable on purpose: Vite rewrites `new URL("./literal", import.meta.url)` as an asset address.
const styleOf = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const css = styleOf("./FixedStage.module.scss");

/** jsdom has no ResizeObserver: this one only tells what it watches, and lets the test say what the browser would measure. */
class FakeObserver {
  static all: FakeObserver[] = [];
  watched: Element[] = [];
  disconnected = false;
  constructor(public callback: ResizeObserverCallback) {
    FakeObserver.all.push(this);
  }
  observe(target: Element) {
    this.watched.push(target);
  }
  unobserve() {}
  disconnect() {
    this.disconnected = true;
  }
  measure(width: number, height: number) {
    act(() => this.callback([{ contentRect: { width, height } } as ResizeObserverEntry], this as unknown as ResizeObserver));
  }
}
const resize = (width: number, height: number) => FakeObserver.all.at(-1)!.measure(width, height);

beforeEach(() => {
  FakeObserver.all = [];
  vi.stubGlobal("ResizeObserver", FakeObserver);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const area = () => screen.getByTestId("fixed-stage");
const box = () => screen.getByTestId("stage-box");

function Scale() {
  return <output data-testid="scale">{useStageScale()}</output>;
}

function Zoom() {
  return <output data-testid="zoom">{useStageZoom()}</output>;
}

// SPEC-057 CA-01: the same 1280 x 720 stage for everybody, fit to the window of each one
describe("FixedStage", () => {
  it("draws what is inside in a box of 1280 x 720 logical pixels", () => {
    render(
      <FixedStage>
        <p>lâmina</p>
      </FixedStage>,
    );
    expect(box().style.width).toBe("1280px");
    expect(box().style.height).toBe("720px");
    expect(box().contains(screen.getByText("lâmina"))).toBe(true);
  });

  it("measures the free room, and scales the box by the smaller ratio, from the top left", () => {
    render(<FixedStage>x</FixedStage>);
    expect(FakeObserver.all).toHaveLength(1);
    expect(FakeObserver.all[0]!.watched).toEqual([area()]);
    resize(W / 2, H);
    expect(box().style.transform).toBe("scale(0.5)");
    expect(css).toMatch(/transform-origin:\s*top left/);
  });

  it("takes the height as the limit when the room is short and wide", () => {
    render(<FixedStage>x</FixedStage>);
    resize(W * 3, H / 2);
    expect(box().style.transform).toBe("scale(0.5)");
  });

  it("keeps the stage centered in the room: the frame has the scaled size and the room centers it", () => {
    render(<FixedStage>x</FixedStage>);
    resize(1000, 1000);
    const frame = box().parentElement!;
    expect(frame.style.width).toBe(`${W * (1000 / W)}px`);
    expect(frame.style.height).toBe(`${H * (1000 / W)}px`);
    expect(area().contains(frame)).toBe(true);
    expect(css).toMatch(/align-items:\s*center/);
    expect(css).toMatch(/justify-content:\s*center/);
  });

  it("fills what is left with the dark of the theme, from a token and not from a color written in the style", () => {
    expect(css).toMatch(/background-color:\s*var\(--color-surface-sunken\)/);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\brgba?\(/);
  });

  // CA-02: the window changes size, or goes to or comes out of full screen
  it("calculates the scale again when the window changes size, or enters and leaves full screen, without loading the class again", () => {
    render(
      <FixedStage>
        <input aria-label="campo" />
      </FixedStage>,
    );
    resize(1366, 768);
    const field = screen.getByLabelText("campo") as HTMLInputElement;
    fireEvent.change(field, { target: { value: "digitado" } });
    const before = box().style.transform;
    resize(W, H);
    expect(box().style.transform).toBe("scale(1)");
    expect(box().style.transform).not.toBe(before);
    resize(1920, 1080);
    expect(box().style.transform).toBe(`scale(${1920 / W})`);
    // The same elements stayed: nothing was mounted again.
    expect(screen.getByLabelText("campo")).toBe(field);
    expect(field.value).toBe("digitado");
  });

  it("starts at scale 1 until the room is measured", () => {
    render(<FixedStage>x</FixedStage>);
    expect(box().style.transform).toBe("scale(1)");
  });

  it("does not collapse when the room has no size yet", () => {
    render(<FixedStage>x</FixedStage>);
    resize(0, 0);
    expect(box().style.transform).toBe("scale(1)");
  });

  it("stays at scale 1 in a browser without ResizeObserver", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    render(<FixedStage>x</FixedStage>);
    expect(box().style.transform).toBe("scale(1)");
  });

  it("stops watching the room when it goes away", () => {
    const view = render(<FixedStage>x</FixedStage>);
    view.unmount();
    expect(FakeObserver.all[0]!.disconnected).toBe(true);
  });

  it("tells the scale to what is drawn inside, which needs it to place the mouse", () => {
    render(
      <FixedStage>
        <Scale />
      </FixedStage>,
    );
    expect(screen.getByTestId("scale").textContent).toBe("1");
    resize(W / 2, H / 2);
    expect(screen.getByTestId("scale").textContent).toBe("0.5");
  });

  it("gives scale 1 to what is drawn outside of any stage, and takes the one that is provided", () => {
    const view = render(<Scale />);
    expect(screen.getByTestId("scale").textContent).toBe("1");
    view.rerender(
      <StageScale.Provider value={0.25}>
        <Scale />
      </StageScale.Provider>,
    );
    expect(screen.getByTestId("scale").textContent).toBe("0.25");
  });

  // CA-03: the layout inside never depends on the window, so nothing in the style may read the size of the window
  it("does not read the size of the window in its style", () => {
    expect(css).not.toMatch(/\d(vh|vw|dvh|dvw)\b/);
    expect(css).not.toMatch(/@media/);
  });
});

// SPEC-057 CA-15, CA-16, CA-18: the zoom of the teacher shrinks the stage in logical pixels, and the scale fits it to the window all the same
describe("FixedStage with zoom", () => {
  it("is as big as the base stage with no zoom", () => {
    render(<FixedStage>x</FixedStage>);
    resize(W, H);
    expect([box().style.width, box().style.height, box().style.transform]).toEqual([`${W}px`, `${H}px`, "scale(1)"]);
  });

  it("draws the stage smaller in logical pixels, by the zoom, and scales it up to fill the window", () => {
    render(<FixedStage zoom={2}>x</FixedStage>);
    resize(W, H);
    expect([box().style.width, box().style.height, box().style.transform]).toEqual([`${W / 2}px`, `${H / 2}px`, "scale(2)"]);
    expect(box().parentElement!.style.width).toBe(`${W}px`);
    expect(box().parentElement!.style.height).toBe(`${H}px`);
  });

  it("takes the smaller of the two ratios of the smaller stage, so nothing is cut", () => {
    render(<FixedStage zoom={1.25}>x</FixedStage>);
    resize(1000, 1000);
    const scale = Math.min(1000 / (W / 1.25), 1000 / (H / 1.25));
    expect(box().style.transform).toBe(`scale(${scale})`);
    expect(box().style.width).toBe(`${W / 1.25}px`);
  });

  it("changes the zoom without loading the class again, and the scale is worked out again", () => {
    const view = render(
      <FixedStage zoom={1}>
        <input aria-label="campo" />
      </FixedStage>,
    );
    resize(W, H);
    const field = screen.getByLabelText("campo") as HTMLInputElement;
    fireEvent.change(field, { target: { value: "digitado" } });
    view.rerender(
      <FixedStage zoom={1.5}>
        <input aria-label="campo" />
      </FixedStage>,
    );
    expect(box().style.transform).toBe("scale(1.5)");
    expect(screen.getByLabelText("campo")).toBe(field);
    expect(field.value).toBe("digitado");
  });

  it("tells the zoom to what is drawn inside, and 1 to what is outside of any stage", () => {
    const view = render(
      <FixedStage zoom={1.75}>
        <Zoom />
      </FixedStage>,
    );
    expect(screen.getByTestId("zoom").textContent).toBe("1.75");
    view.unmount();
    render(<Zoom />);
    expect(screen.getByTestId("zoom").textContent).toBe("1");
    cleanup();
    render(
      <StageZoom.Provider value={2}>
        <Zoom />
      </StageZoom.Provider>,
    );
    expect(screen.getByTestId("zoom").textContent).toBe("2");
  });

  it("takes a zoom that makes no sense as 100%", () => {
    render(<FixedStage zoom={Number.NaN}>x</FixedStage>);
    resize(W, H);
    expect(box().style.width).toBe(`${W}px`);
  });
});

// The marks of the text the teacher selected (SPEC-057 CA-20, CA-21) are painted with the highlight of the browser, with a token for the color
describe("the highlight of the selection of the teacher", () => {
  it("is styled for the material and for the terminal with tokens, and with no color written in the style", () => {
    expect(css).toMatch(/::highlight\(teacher-material\)/);
    expect(css).toMatch(/::highlight\(teacher-terminal\)/);
    expect(css).toMatch(/::highlight\([^)]*\)[^{]*\{[^}]*background-color:\s*var\(--color-/);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });

  it("styles the fallback mark, so the text keeps its place when the browser has no highlight", () => {
    expect(css).toMatch(/mark\[data-teacher-selection\]|\.mark/);
  });
});

// The pointer of the teacher is drawn in the stage, in logical pixels, so it has the same size for everybody
describe("StagePointer", () => {
  it("is the plain pointer, at a percentage of the box it is in", () => {
    const { container } = render(<StagePointer x={30} y={40} laser={false} />);
    const pointer = container.querySelector("[data-pointer]") as HTMLElement;
    expect(pointer.style.left).toBe("30%");
    expect(pointer.style.top).toBe("40%");
    expect(container.querySelector("[data-laser]")).toBeNull();
  });

  it("is the highlight when the laser is on", () => {
    const { container } = render(<StagePointer x={10} y={20} laser />);
    const laser = container.querySelector("[data-laser]") as HTMLElement;
    expect(laser.style.left).toBe("10%");
    expect(laser.style.top).toBe("20%");
    expect(container.querySelector("[data-pointer]")).toBeNull();
  });
});
