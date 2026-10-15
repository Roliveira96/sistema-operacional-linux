import { afterEach, describe, expect, it, vi } from "vitest";
import { STAGE_HEIGHT, STAGE_WIDTH } from "../FixedStage/stage";
import { fitWithin, imageLoader } from "./imageLoader";

afterEach(() => vi.unstubAllGlobals());

// SPEC-068 CA-10: the image is drawn whole, as big as the stage lets it be, with the shape it has
describe("fitWithin", () => {
  it("fits a wide image to the width and a tall one to the height, whole and in proportion", () => {
    expect(fitWithin({ width: 1600, height: 900 }, STAGE_WIDTH, STAGE_HEIGHT)).toEqual({ width: 1280, height: 720 });
    expect(fitWithin({ width: 600, height: 1200 }, STAGE_WIDTH, STAGE_HEIGHT)).toEqual({ width: 360, height: 720 });
    expect(fitWithin({ width: 4000, height: 1000 }, STAGE_WIDTH, STAGE_HEIGHT)).toEqual({ width: 1280, height: 320 });
  });

  it("makes a small image as big as the stage lets it be", () => {
    expect(fitWithin({ width: 100, height: 50 }, STAGE_WIDTH, STAGE_HEIGHT)).toEqual({ width: 1280, height: 640 });
  });
});

/** An image that has its size as soon as the address is given, as a loaded one does. */
function stubImage(size: { width: number; height: number } | "broken") {
  class FakeImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = size === "broken" ? 0 : size.width;
    naturalHeight = size === "broken" ? 0 : size.height;
    set src(_url: string) {
      queueMicrotask(() => (size === "broken" ? this.onerror?.() : this.onload?.()));
    }
  }
  vi.stubGlobal("Image", FakeImage);
}

describe("imageLoader", () => {
  it("loads the image and says it has one page", async () => {
    stubImage({ width: 1600, height: 900 });
    const page = await imageLoader.load("https://minio/e.png");
    expect(page.pageCount).toBe(1);
    page.destroy();
  });

  it("draws the whole image on the canvas, with as many pixels as the screen shows it with", async () => {
    stubImage({ width: 1600, height: 900 });
    const page = await imageLoader.load("https://minio/e.png");
    const canvas = document.createElement("canvas");
    const drawImage = vi.fn();
    vi.spyOn(canvas, "getContext").mockReturnValue({ drawImage } as never);

    await page.render(1, canvas, 1264, 2);

    // the room gives 1264 px of width (the scroll bar took the rest): the image is as wide as that, and as tall as the stage allows
    expect(canvas.style.width).toBe("1264px");
    expect(canvas.style.height).toBe("711px");
    expect(canvas.width).toBe(2528);
    expect(canvas.height).toBe(1422);
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 2528, 1422);
  });

  it("does not draw a tall image taller than the stage", async () => {
    stubImage({ width: 600, height: 1200 });
    const page = await imageLoader.load("https://minio/tall.png");
    const canvas = document.createElement("canvas");
    vi.spyOn(canvas, "getContext").mockReturnValue({ drawImage: vi.fn() } as never);
    await page.render(1, canvas, 1264, 1);
    expect(canvas.style.height).toBe("720px");
    expect(canvas.style.width).toBe("360px");
  });

  it("fails when the image cannot be loaded", async () => {
    stubImage("broken");
    await expect(imageLoader.load("https://minio/missing.png")).rejects.toThrow();
  });
});

describe("imageLoader, the pixels of the screen", () => {
  it("uses the density of the screen when it is not told, and draws nothing where the canvas has no context", async () => {
    stubImage({ width: 1600, height: 900 });
    vi.stubGlobal("devicePixelRatio", 2);
    const page = await imageLoader.load("https://minio/e.png");
    const canvas = document.createElement("canvas");
    vi.spyOn(canvas, "getContext").mockReturnValue(null);

    await expect(page.render(1, canvas, 1264)).resolves.toBeUndefined();
    expect(canvas.width).toBe(2528);
  });
});
