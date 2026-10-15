// PDF reading in the browser with the local pdfjs-dist, no CDN (SPEC-051 P-N03): the server only keeps the file and the page count.

/** A PDF open to be drawn page by page. */
export interface PdfPageRenderer {
  pageCount: number;
  /**
   * Draws the page (from 1) on the canvas, as wide as `width` CSS pixels and with `density` pixels for each of them (the pixels of the display by
   * default). A drawing that is still on its way on the same canvas is stopped, so the page can be drawn again, sharper, without them piling up.
   */
  render(page: number, canvas: HTMLCanvasElement, width: number, density?: number): Promise<void>;
  destroy(): void;
}

export interface PdfLoader {
  load(url: string): Promise<PdfPageRenderer>;
}

/** Why a PDF could not be read: the password it asks for, or a file that is not a readable PDF. */
export class PdfReadError extends Error {
  readonly reason: "password" | "invalid";
  constructor(reason: "password" | "invalid") {
    super(`PDF cannot be read: ${reason}`);
    this.name = "PdfReadError";
    this.reason = reason;
  }
}

async function pdfjs() {
  const lib = await import("pdfjs-dist");
  // The reader runs in a worker that comes from the same bundle of the page.
  lib.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  return lib;
}

export const pdfLoader: PdfLoader = {
  async load(url) {
    const lib = await pdfjs();
    const task = lib.getDocument({ url });
    const doc = await task.promise;
    let running: { cancel(): void } | null = null;
    return {
      pageCount: doc.numPages,
      async render(page, canvas, width, density = window.devicePixelRatio || 1) {
        const pdfPage = await doc.getPage(page);
        running?.cancel();
        const base = pdfPage.getViewport({ scale: 1 });
        const viewport = pdfPage.getViewport({ scale: (width / base.width) * density });
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${Math.floor(viewport.width / density)}px`;
        canvas.style.height = `${Math.floor(viewport.height / density)}px`;
        const drawing = pdfPage.render({ canvas, viewport });
        running = drawing;
        try {
          await drawing.promise;
        } catch (error) {
          // A drawing that was stopped for a newer one is not a failure of the page.
          if (!(error instanceof lib.RenderingCancelledException)) throw error;
        } finally {
          if (running === drawing) running = null;
        }
      },
      destroy() {
        void task.destroy();
      },
    };
  },
};

/** Reads the PDF chosen by the teacher, before sending it: how many pages it has, or why it cannot be used (SPEC-051 P-N04). */
export async function readPdfInfo(file: File): Promise<{ pageCount: number }> {
  const lib = await pdfjs();
  const task = lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  try {
    const doc = await task.promise;
    return { pageCount: doc.numPages };
  } catch (error) {
    throw new PdfReadError(error instanceof lib.PasswordException ? "password" : "invalid");
  } finally {
    void task.destroy();
  }
}
