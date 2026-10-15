import { afterEach, describe, expect, it } from "vitest";
import { clampZoom, percentOf, placeContent, scrollFraction, scrollRange, STAGE_HEIGHT, STAGE_WIDTH, stageScale, stageSize, stepZoom, toStagePoint, ZOOM_LEVELS } from "./stage";

const W = STAGE_WIDTH;
const H = STAGE_HEIGHT;

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

// SPEC-057 CA-01: the stage is 1280 x 720 and is fit to the window by the smaller of the two ratios
describe("stageScale", () => {
  it("is the stage size, 1280 x 720, in logical pixels, in one pair of constants", () => {
    expect([STAGE_WIDTH, STAGE_HEIGHT]).toEqual([1280, 720]);
  });

  it("is 1 when the room is exactly the size of the stage", () => {
    expect(stageScale(W, H)).toBe(1);
  });

  it("is limited by the width when the room is narrow", () => {
    expect(stageScale(W / 2, H)).toBe(0.5);
    expect(stageScale(W / 2, H * 5)).toBe(0.5);
  });

  it("is limited by the height when the room is short", () => {
    expect(stageScale(W * 5, H / 2)).toBe(0.5);
    expect(stageScale(W, H / 4)).toBe(0.25);
  });

  it("grows the stage on a big screen, so the projector is filled", () => {
    expect(stageScale(W * 2, H * 2)).toBe(2);
    expect(stageScale(1920, 1080)).toBe(1.5);
  });

  it("takes the smaller ratio of a laptop window, which shows the stage a bit bigger than it is", () => {
    expect(stageScale(1366, 768)).toBeCloseTo(Math.min(1366 / W, 768 / H), 10);
    expect(stageScale(1366, 768)).toBeGreaterThan(1);
  });

  it("does not collapse the stage when the room was not measured, or has no size", () => {
    expect(stageScale(0, 0)).toBe(1);
    expect(stageScale(0, 500)).toBe(1);
    expect(stageScale(800, -1)).toBe(1);
    expect(stageScale(Number.NaN, 100)).toBe(1);
  });
});

// SPEC-057 CA-15, CA-16: the zoom of the teacher makes the stage smaller in logical pixels, and the scale makes it fit the window all the same
describe("the zoom of the stage", () => {
  it("has the levels of the spec: 100%, 125%, 150%, 175% and 200%", () => {
    expect([...ZOOM_LEVELS]).toEqual([1, 1.25, 1.5, 1.75, 2]);
  });

  it("makes the logical size of the stage the base size divided by the zoom", () => {
    expect(stageSize(1)).toEqual({ width: W, height: H });
    expect(stageSize(2)).toEqual({ width: W / 2, height: H / 2 });
    expect(stageSize(1.25)).toEqual({ width: W / 1.25, height: H / 1.25 });
  });

  it("fits the smaller stage to the room: the scale is the smaller of the two ratios of the smaller size", () => {
    expect(stageScale(W, H, 1)).toBe(1);
    expect(stageScale(W, H, 2)).toBe(2);
    expect(stageScale(W, H, 1.25)).toBe(1.25);
    expect(stageScale(1000, 1000, 2)).toBeCloseTo(Math.min(1000 / (W / 2), 1000 / (H / 2)), 10);
  });

  it("takes the zoom as 1 when it is not given or makes no sense", () => {
    expect(stageScale(W, H)).toBe(1);
    expect(stageScale(W, H, 0)).toBe(1);
    expect(stageScale(W, H, Number.NaN)).toBe(1);
  });

  it("keeps the zoom between 1 and 2, and 1 when it is not a number", () => {
    expect(clampZoom(5)).toBe(2);
    expect(clampZoom(0.5)).toBe(1);
    expect(clampZoom(1.5)).toBe(1.5);
    expect(clampZoom(Number.NaN)).toBe(1);
    expect(clampZoom(Number.POSITIVE_INFINITY)).toBe(1);
  });

  it("steps to the next level up or down, and stops at the ends", () => {
    expect(stepZoom(1, 1)).toBe(1.25);
    expect(stepZoom(1.75, 1)).toBe(2);
    expect(stepZoom(2, 1)).toBe(2);
    expect(stepZoom(2, -1)).toBe(1.75);
    expect(stepZoom(1.25, -1)).toBe(1);
    expect(stepZoom(1, -1)).toBe(1);
  });

  it("steps from the level that is nearest when the zoom is between two", () => {
    expect(stepZoom(1.3, 1)).toBe(1.5);
    expect(stepZoom(1.3, -1)).toBe(1);
  });
});

// SPEC-057 CA-06 and section 6: one helper for the mouse, used by the slide and by the module
describe("toStagePoint", () => {
  it("is the place of the mouse in logical pixels from the corner of the box, when the scale is 1", () => {
    expect(toStagePoint({ clientX: 150, clientY: 80 }, box({ left: 100, top: 50 }), 1)).toEqual({ x: 50, y: 30 });
  });

  it("divides by the scale of the stage", () => {
    // The stage is drawn at half the size, so the middle of it is a quarter of the stage away on the screen.
    expect(toStagePoint({ clientX: 100 + W / 4, clientY: 50 + H / 4 }, box({ left: 100, top: 50 }), 0.5)).toEqual({ x: W / 2, y: H / 2 });
    expect(toStagePoint({ clientX: 100 + W, clientY: 50 + H }, box({ left: 100, top: 50 }), 2)).toEqual({ x: W / 2, y: H / 2 });
  });

  it("adds the scroll of the box, which is in logical pixels already", () => {
    expect(toStagePoint({ clientX: 100, clientY: 100 }, box({ left: 0, top: 0 }, { top: 540 }), 1)).toEqual({ x: 100, y: 640 });
    expect(toStagePoint({ clientX: 100, clientY: 100 }, box({ left: 0, top: 0 }, { top: 540, left: 30 }), 0.5)).toEqual({ x: 230, y: 740 });
  });
});

describe("percentOf", () => {
  it("is a part of a whole as a percentage with two decimals", () => {
    expect(percentOf(W / 2, W)).toBe(50);
    expect(percentOf(1, 3)).toBe(33.33);
  });

  it("stays between 0 and 100, and is 0 when there is no whole", () => {
    expect(percentOf(-5, W)).toBe(0);
    expect(percentOf(W * 2, W)).toBe(100);
    expect(percentOf(5, 0)).toBe(0);
    expect(percentOf(Number.NaN, W)).toBe(0);
  });
});

describe("the scroll of the slide and of the material", () => {
  // A page twice as tall as the stage, or one that fits in it.
  const TALL = 2 * H;
  const SHORT = H * 0.8;
  const setup = (content: number, view: number) => {
    const area = sized(document.createElement("div"), { clientHeight: view });
    const sheet = sized(document.createElement("div"), { offsetHeight: content });
    area.append(sheet);
    return { area, sheet };
  };

  it("can scroll the height of the content that does not fit, and nothing when it fits", () => {
    const tall = setup(TALL, H);
    expect(scrollRange(tall.area, tall.sheet)).toBe(H);
    const small = setup(SHORT, H);
    expect(scrollRange(small.area, small.sheet)).toBe(0);
  });

  it("tells the place of the box as a fraction of what can be scrolled", () => {
    const { area, sheet } = setup(TALL, H);
    area.scrollTop = H / 4;
    expect(scrollFraction(area, sheet)).toBe(0.25);
    area.scrollTop = H;
    expect(scrollFraction(area, sheet)).toBe(1);
    area.scrollTop = 99999;
    expect(scrollFraction(area, sheet)).toBe(1);
  });

  it("tells 0 when there is nothing to scroll", () => {
    const { area, sheet } = setup(SHORT, H);
    area.scrollTop = 40;
    expect(scrollFraction(area, sheet)).toBe(0);
  });

  it("scrolls the box itself for the one who drives it", () => {
    const { area, sheet } = setup(TALL, H);
    placeContent(area, sheet, 0.5, false);
    expect(area.scrollTop).toBe(H / 2);
    expect(sheet.style.transform).toBe("");
  });

  it("moves the content, not the box, for the one who only follows, with the 100 ms transition left to the style", () => {
    const { area, sheet } = setup(TALL, H);
    placeContent(area, sheet, 0.5, true);
    expect(sheet.style.transform).toBe(`translate(0px, ${-H / 2}px)`);
    expect(area.scrollTop).toBe(0);
    placeContent(area, sheet, 0, true);
    expect(sheet.style.transform).toBe("translate(0px, 0px)");
  });

  it("puts the box back at the start for the one who follows, and the content back for the one who drives", () => {
    const { area, sheet } = setup(TALL, H);
    placeContent(area, sheet, 0.5, true);
    area.scrollTop = 99;
    placeContent(area, sheet, 0.5, true);
    expect(area.scrollTop).toBe(0);
    placeContent(area, sheet, 0.25, false);
    expect(sheet.style.transform).toBe("");
    expect(area.scrollTop).toBe(H / 4);
  });

  it("keeps the fraction between 0 and 1, and a content that fits does not move", () => {
    const { area, sheet } = setup(TALL, H);
    placeContent(area, sheet, 7, true);
    expect(sheet.style.transform).toBe(`translate(0px, ${-H}px)`);
    placeContent(area, sheet, -3, true);
    expect(sheet.style.transform).toBe("translate(0px, 0px)");
    placeContent(area, sheet, Number.NaN, true);
    expect(sheet.style.transform).toBe("translate(0px, 0px)");
    const small = setup(SHORT, H);
    placeContent(small.area, small.sheet, 0.8, true);
    expect(small.sheet.style.transform).toBe("translate(0px, 0px)");
  });
  // CA-17: with the zoom the page is wider than the stage, and the horizontal scroll is the teacher's as well
  describe("the horizontal scroll", () => {
    const WIDE = 2 * W;
    const setupWide = () => {
      const area = sized(document.createElement("div"), { clientHeight: H, clientWidth: W });
      const sheet = sized(document.createElement("div"), { offsetHeight: TALL, offsetWidth: WIDE });
      area.append(sheet);
      return { area, sheet };
    };

    it("can scroll the width of the content that does not fit, and nothing when it fits", () => {
      const { area, sheet } = setupWide();
      expect(scrollRange(area, sheet, "x")).toBe(W);
      expect(scrollRange(area, sheet, "y")).toBe(H);
      const fits = sized(document.createElement("div"), { offsetHeight: TALL, offsetWidth: W });
      area.append(fits);
      expect(scrollRange(area, fits, "x")).toBe(0);
    });

    it("tells the horizontal place of the box as a fraction of what can be scrolled", () => {
      const { area, sheet } = setupWide();
      area.scrollLeft = W / 4;
      expect(scrollFraction(area, sheet, "x")).toBe(0.25);
      area.scrollLeft = 99999;
      expect(scrollFraction(area, sheet, "x")).toBe(1);
      expect(scrollFraction(area, sheet)).toBe(0);
    });

    it("scrolls the box in both directions for the one who drives it", () => {
      const { area, sheet } = setupWide();
      placeContent(area, sheet, 0.5, false, 0.25);
      expect([area.scrollTop, area.scrollLeft]).toEqual([H / 2, W / 4]);
    });

    it("moves the content in both directions for the one who only follows", () => {
      const { area, sheet } = setupWide();
      placeContent(area, sheet, 0.5, true, 0.25);
      expect(sheet.style.transform).toBe(`translate(${-W / 4}px, ${-H / 2}px)`);
      expect([area.scrollTop, area.scrollLeft]).toEqual([0, 0]);
    });

    it("takes the horizontal place as 0 when it is not given, and keeps it between 0 and 1", () => {
      const { area, sheet } = setupWide();
      placeContent(area, sheet, 0, true);
      expect(sheet.style.transform).toBe("translate(0px, 0px)");
      placeContent(area, sheet, 0, true, 9);
      expect(sheet.style.transform).toBe(`translate(${-W}px, 0px)`);
      placeContent(area, sheet, 0, true, Number.NaN);
      expect(sheet.style.transform).toBe("translate(0px, 0px)");
    });
  });
});
