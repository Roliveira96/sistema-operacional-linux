import { afterEach, describe, expect, it } from "vitest";
import { placeContent, scrollFraction, scrollRange, STAGE_HEIGHT, STAGE_WIDTH, stageScale, toStagePoint } from "./stage";

afterEach(() => {
  document.body.replaceChildren();
});

/** jsdom has no layout: the sizes the browser would compute are given by hand. */
function sized(el: HTMLElement, sizes: Record<string, number>) {
  for (const [name, value] of Object.entries(sizes)) Object.defineProperty(el, name, { configurable: true, value });
  return el;
}

function box(rect: { left: number; top: number }, scroll: { top?: number; left?: number } = {}) {
  const el = document.createElement("div");
  el.getBoundingClientRect = () => ({ left: rect.left, top: rect.top, width: 0, height: 0, right: 0, bottom: 0, x: rect.left, y: rect.top, toJSON: () => ({}) });
  el.scrollTop = scroll.top ?? 0;
  el.scrollLeft = scroll.left ?? 0;
  return el;
}

// SPEC-057 CA-01: the stage is 1920 x 1080 and is fit to the window by the smaller of the two ratios
describe("stageScale", () => {
  it("is the stage size, 1920 x 1080, in logical pixels", () => {
    expect([STAGE_WIDTH, STAGE_HEIGHT]).toEqual([1920, 1080]);
  });

  it("is 1 when the room is exactly the size of the stage", () => {
    expect(stageScale(1920, 1080)).toBe(1);
  });

  it("is limited by the width when the room is narrow", () => {
    expect(stageScale(960, 1080)).toBe(0.5);
    expect(stageScale(960, 5000)).toBe(0.5);
  });

  it("is limited by the height when the room is short", () => {
    expect(stageScale(5000, 540)).toBe(0.5);
    expect(stageScale(1920, 270)).toBe(0.25);
  });

  it("grows the stage on a big screen, so the projector is filled", () => {
    expect(stageScale(3840, 2160)).toBe(2);
  });

  it("takes the smaller ratio of a laptop window", () => {
    expect(stageScale(1366, 768)).toBeCloseTo(Math.min(1366 / 1920, 768 / 1080), 10);
  });

  it("does not collapse the stage when the room was not measured, or has no size", () => {
    expect(stageScale(0, 0)).toBe(1);
    expect(stageScale(0, 500)).toBe(1);
    expect(stageScale(800, -1)).toBe(1);
    expect(stageScale(Number.NaN, 100)).toBe(1);
  });
});

// SPEC-057 CA-06 and section 6: one helper for the mouse, used by the slide and by the module
describe("toStagePoint", () => {
  it("is the place of the mouse in logical pixels from the corner of the box, when the scale is 1", () => {
    expect(toStagePoint({ clientX: 150, clientY: 80 }, box({ left: 100, top: 50 }), 1)).toEqual({ x: 50, y: 30 });
  });

  it("divides by the scale of the stage", () => {
    // The stage is drawn at half the size, so 480 pixels on the screen are 960 of the stage.
    expect(toStagePoint({ clientX: 580, clientY: 320 }, box({ left: 100, top: 50 }), 0.5)).toEqual({ x: 960, y: 540 });
    expect(toStagePoint({ clientX: 100 + 1920, clientY: 50 + 1080 }, box({ left: 100, top: 50 }), 2)).toEqual({ x: 960, y: 540 });
  });

  it("adds the scroll of the box, which is in logical pixels already", () => {
    expect(toStagePoint({ clientX: 100, clientY: 100 }, box({ left: 0, top: 0 }, { top: 540 }), 1)).toEqual({ x: 100, y: 640 });
    expect(toStagePoint({ clientX: 100, clientY: 100 }, box({ left: 0, top: 0 }, { top: 540, left: 30 }), 0.5)).toEqual({ x: 230, y: 740 });
  });
});

describe("the scroll of the slide and of the material", () => {
  const setup = (content: number, view: number) => {
    const area = sized(document.createElement("div"), { clientHeight: view });
    const sheet = sized(document.createElement("div"), { offsetHeight: content });
    area.append(sheet);
    return { area, sheet };
  };

  it("can scroll the height of the content that does not fit, and nothing when it fits", () => {
    expect(scrollRange(setup(2160, 1080).area, setup(2160, 1080).sheet)).toBe(1080);
    const small = setup(900, 1080);
    expect(scrollRange(small.area, small.sheet)).toBe(0);
  });

  it("tells the place of the box as a fraction of what can be scrolled", () => {
    const { area, sheet } = setup(2160, 1080);
    area.scrollTop = 270;
    expect(scrollFraction(area, sheet)).toBe(0.25);
    area.scrollTop = 1080;
    expect(scrollFraction(area, sheet)).toBe(1);
    area.scrollTop = 99999;
    expect(scrollFraction(area, sheet)).toBe(1);
  });

  it("tells 0 when there is nothing to scroll", () => {
    const { area, sheet } = setup(900, 1080);
    area.scrollTop = 40;
    expect(scrollFraction(area, sheet)).toBe(0);
  });

  it("scrolls the box itself for the one who drives it", () => {
    const { area, sheet } = setup(2160, 1080);
    placeContent(area, sheet, 0.5, false);
    expect(area.scrollTop).toBe(540);
    expect(sheet.style.transform).toBe("");
  });

  it("moves the content, not the box, for the one who only follows, with the 100 ms transition left to the style", () => {
    const { area, sheet } = setup(2160, 1080);
    placeContent(area, sheet, 0.5, true);
    expect(sheet.style.transform).toBe("translateY(-540px)");
    expect(area.scrollTop).toBe(0);
    placeContent(area, sheet, 0, true);
    expect(sheet.style.transform).toBe("translateY(0px)");
  });

  it("keeps the fraction between 0 and 1, and a content that fits does not move", () => {
    const { area, sheet } = setup(2160, 1080);
    placeContent(area, sheet, 7, true);
    expect(sheet.style.transform).toBe("translateY(-1080px)");
    placeContent(area, sheet, -3, true);
    expect(sheet.style.transform).toBe("translateY(0px)");
    placeContent(area, sheet, Number.NaN, true);
    expect(sheet.style.transform).toBe("translateY(0px)");
    const small = setup(900, 1080);
    placeContent(small.area, small.sheet, 0.8, true);
    expect(small.sheet.style.transform).toBe("translateY(0px)");
  });
});
