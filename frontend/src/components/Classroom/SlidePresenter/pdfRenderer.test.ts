import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pdfLoader, PdfReadError, readPdfInfo } from "./pdfRenderer";

// The reader of PDFs is mocked: what is tested is how the page is sized and drawn, not pdfjs.
const lib = vi.hoisted(() => {
  class RenderingCancelledException extends Error {}
  class PasswordException extends Error {}
  return { RenderingCancelledException, PasswordException, getDocument: vi.fn(), GlobalWorkerOptions: { workerSrc: "" } };
});
vi.mock("pdfjs-dist", () => lib);

/** A page 600 x 400 points wide, whose render is a task that can be held, finished or cancelled. */
function fakeDocument(pages = 3) {
  const tasks: Array<{ resolve(): void; reject(error: Error): void; cancel: ReturnType<typeof vi.fn> }> = [];
  const viewports: Array<{ scale: number }> = [];
  const page = {
    getViewport: ({ scale }: { scale: number }) => {
      viewports.push({ scale });
      return { width: 600 * scale, height: 400 * scale };
    },
    render: vi.fn(() => {
      let resolve!: () => void;
      let reject!: (error: Error) => void;
      const promise = new Promise<void>((ok, bad) => {
        resolve = ok;
        reject = bad;
      });
      const cancel = vi.fn(() => reject(new lib.RenderingCancelledException("cancelled")));
      tasks.push({ resolve, reject, cancel });
      return { promise, cancel };
    }),
  };
  const destroy = vi.fn();
  lib.getDocument.mockReturnValue({ promise: Promise.resolve({ numPages: pages, getPage: async () => page }), destroy });
  return { tasks, viewports, page, destroy };
}

const canvas = () => document.createElement("canvas");

beforeEach(() => {
  lib.getDocument.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

// SPEC-057: the page is as wide as the stage in logical pixels, with as many pixels as the screen shows it with
describe("pdfLoader", () => {
  it("opens the document by its address, and tells how many pages it has", async () => {
    fakeDocument(7);
    const reader = await pdfLoader.load("https://minio/slides.pdf");
    expect(lib.getDocument).toHaveBeenCalledWith({ url: "https://minio/slides.pdf" });
    expect(reader.pageCount).toBe(7);
  });

  it("draws the page as wide as asked in logical pixels, with the pixels of the display by default", async () => {
    fakeDocument();
    vi.stubGlobal("devicePixelRatio", 2);
    const reader = await pdfLoader.load("u");
    const target = canvas();
    const drawing = reader.render(1, target, 1280);
    await vi.waitFor(() => expect(target.width).toBeGreaterThan(0));
    expect([target.width, target.style.width]).toEqual([2560, "1280px"]);
    expect(target.height).toBe(Math.floor((1280 / 600) * 400 * 2));
    expect(target.style.height).toBe(`${Math.floor((1280 / 600) * 400)}px`);
    void drawing;
  });

  it("draws the page with the density it is told, which is how sharp it is when the stage is shown bigger than it is", async () => {
    const { viewports } = fakeDocument();
    vi.stubGlobal("devicePixelRatio", 1);
    const reader = await pdfLoader.load("u");
    const target = canvas();
    void reader.render(1, target, 1280, 1.5);
    await vi.waitFor(() => expect(target.width).toBeGreaterThan(0));
    expect([target.width, target.style.width]).toEqual([1920, "1280px"]);
    expect(viewports.at(-1)!.scale).toBeCloseTo((1280 / 600) * 1.5, 10);
    expect(target.height).toBe(Math.floor((1280 / 600) * 400 * 1.5));
  });

  it("draws a page with fewer pixels than its width when the density is below 1", async () => {
    fakeDocument();
    const reader = await pdfLoader.load("u");
    const target = canvas();
    void reader.render(1, target, 1280, 0.5);
    await vi.waitFor(() => expect(target.width).toBeGreaterThan(0));
    expect([target.width, target.style.width]).toEqual([640, "1280px"]);
  });

  it("takes the pixels of the display as 1 when the browser does not tell", async () => {
    fakeDocument();
    vi.stubGlobal("devicePixelRatio", undefined);
    const reader = await pdfLoader.load("u");
    const target = canvas();
    void reader.render(1, target, 1280);
    await vi.waitFor(() => expect(target.width).toBeGreaterThan(0));
    expect(target.width).toBe(1280);
  });

  it("finishes the drawing when the page is drawn", async () => {
    const { tasks } = fakeDocument();
    const reader = await pdfLoader.load("u");
    const drawing = reader.render(2, canvas(), 1280, 1);
    await vi.waitFor(() => expect(tasks).toHaveLength(1));
    tasks[0]!.resolve();
    await expect(drawing).resolves.toBeUndefined();
  });

  it("stops the drawing that is on its way when another one begins on the same canvas, so a window that is being resized does not pile them up", async () => {
    const { tasks } = fakeDocument();
    const reader = await pdfLoader.load("u");
    const target = canvas();
    const first = reader.render(1, target, 1280, 1);
    await vi.waitFor(() => expect(tasks).toHaveLength(1));
    const second = reader.render(1, target, 1280, 2);
    await vi.waitFor(() => expect(tasks).toHaveLength(2));
    expect(tasks[0]!.cancel).toHaveBeenCalledTimes(1);
    expect(tasks[1]!.cancel).not.toHaveBeenCalled();
    // The one that was stopped ends quietly: it is not a failure of the page.
    await expect(first).resolves.toBeUndefined();
    tasks[1]!.resolve();
    await expect(second).resolves.toBeUndefined();
  });

  it("does not stop a drawing that already ended", async () => {
    const { tasks } = fakeDocument();
    const reader = await pdfLoader.load("u");
    const first = reader.render(1, canvas(), 1280, 1);
    await vi.waitFor(() => expect(tasks).toHaveLength(1));
    tasks[0]!.resolve();
    await first;
    void reader.render(1, canvas(), 1280, 1);
    await vi.waitFor(() => expect(tasks).toHaveLength(2));
    expect(tasks[0]!.cancel).not.toHaveBeenCalled();
  });

  it("tells a real failure of the drawing", async () => {
    const { tasks } = fakeDocument();
    const reader = await pdfLoader.load("u");
    const drawing = reader.render(1, canvas(), 1280, 1);
    await vi.waitFor(() => expect(tasks).toHaveLength(1));
    tasks[0]!.reject(new Error("corrompida"));
    await expect(drawing).rejects.toThrow("corrompida");
  });

  it("frees the document when it is destroyed", async () => {
    const { destroy } = fakeDocument();
    const reader = await pdfLoader.load("u");
    reader.destroy();
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});

describe("readPdfInfo", () => {
  const file = (bytes = [1, 2, 3]) => ({ arrayBuffer: async () => new Uint8Array(bytes).buffer }) as File;

  it("tells how many pages the chosen file has, and frees it", async () => {
    const { destroy } = fakeDocument(12);
    await expect(readPdfInfo(file())).resolves.toEqual({ pageCount: 12 });
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("tells that a file with a password cannot be used", async () => {
    lib.getDocument.mockReturnValue({ promise: Promise.reject(new lib.PasswordException("senha")), destroy: vi.fn() });
    const error = await readPdfInfo(file()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PdfReadError);
    expect((error as PdfReadError).reason).toBe("password");
  });

  it("tells that a file that is not a readable PDF cannot be used", async () => {
    lib.getDocument.mockReturnValue({ promise: Promise.reject(new Error("invalido")), destroy: vi.fn() });
    const error = await readPdfInfo(file()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PdfReadError);
    expect((error as PdfReadError).reason).toBe("invalid");
  });
});
