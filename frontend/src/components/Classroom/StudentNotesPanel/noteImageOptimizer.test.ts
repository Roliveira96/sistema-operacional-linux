import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NOTE_IMAGE_MAX_WIDTH, optimizeNoteImage } from "./noteImageOptimizer";

describe("optimizeNoteImage (SPEC-071 CA-07, CA-08)", () => {
  const originalImage = globalThis.Image;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  let loadedWidth = 2440;
  let loadedHeight = 1220;
  let lastCanvasWidth = 0;
  let lastCanvasHeight = 0;
  let drawArgs: number[] = [];
  let toBlobHandler: (cb: BlobCallback, type?: string, quality?: number) => void;

  beforeEach(() => {
    loadedWidth = 2440;
    loadedHeight = 1220;
    lastCanvasWidth = 0;
    lastCanvasHeight = 0;
    drawArgs = [];

    URL.createObjectURL = vi.fn(() => "blob:test-image");
    URL.revokeObjectURL = vi.fn();

    class FakeImage {
      width = loadedWidth;
      height = loadedHeight;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_val: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    globalThis.Image = FakeImage as unknown as typeof Image;

    toBlobHandler = (cb, type) => {
      cb(new Blob(["encoded"], { type: type ?? "image/avif" }));
    };

    const origCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(((tagName: string) => {
      if (tagName.toLowerCase() === "canvas") {
        const fakeCanvas = {
          set width(v: number) {
            lastCanvasWidth = v;
          },
          get width() {
            return lastCanvasWidth;
          },
          set height(v: number) {
            lastCanvasHeight = v;
          },
          get height() {
            return lastCanvasHeight;
          },
          getContext: () => ({
            imageSmoothingEnabled: false,
            imageSmoothingQuality: "low",
            drawImage: (_img: unknown, x: number, y: number, w: number, h: number) => {
              drawArgs = [x, y, w, h];
            },
          }),
          toBlob: (cb: BlobCallback, type?: string, quality?: number) => {
            toBlobHandler(cb, type, quality);
          },
        };
        return fakeCanvas as unknown as HTMLCanvasElement;
      }
      return origCreateElement(tagName);
    }) as typeof document.createElement);
  });

  afterEach(() => {
    globalThis.Image = originalImage;
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    vi.restoreAllMocks();
  });

  it("proportionally downscales images wider than 1220px and encodes as image/avif (CA-07, CA-08)", async () => {
    loadedWidth = 2440;
    loadedHeight = 1220;
    const input = new File(["raw-bitmap"], "print.png", { type: "image/png" });

    const out = await optimizeNoteImage(input);

    expect(NOTE_IMAGE_MAX_WIDTH).toBe(1220);
    expect(lastCanvasWidth).toBe(1220);
    expect(lastCanvasHeight).toBe(610);
    expect(drawArgs).toEqual([0, 0, 1220, 610]);
    expect(out.width).toBe(1220);
    expect(out.height).toBe(610);
    expect(out.mimeType).toBe("image/avif");
    expect(out.fileName).toBe("print.avif");
    expect(out.blob.type).toBe("image/avif");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test-image");
  });

  it("preserves original dimensions when width is <= 1220px (CA-07)", async () => {
    loadedWidth = 800;
    loadedHeight = 500;
    const input = new File(["raw-bitmap"], "janela.png", { type: "image/png" });

    const out = await optimizeNoteImage(input);

    expect(lastCanvasWidth).toBe(800);
    expect(lastCanvasHeight).toBe(500);
    expect(out.width).toBe(800);
    expect(out.height).toBe(500);
    expect(out.mimeType).toBe("image/avif");
  });

  it("falls back transparently to image/webp when the browser does not encode image/avif (CA-08)", async () => {
    loadedWidth = 1000;
    loadedHeight = 600;
    toBlobHandler = (cb, type) => {
      if (type === "image/avif") {
        // Browser that lacks AVIF encoder returns null or image/png
        cb(null);
        return;
      }
      cb(new Blob(["webp-bytes"], { type: "image/webp" }));
    };

    const input = new Blob(["raw"], { type: "image/png" });
    const out = await optimizeNoteImage(input);

    expect(out.mimeType).toBe("image/webp");
    expect(out.fileName).toBe("captura.webp");
    expect(out.blob.type).toBe("image/webp");
  });
});
