// PDF reading in the browser with the local pdfjs-dist, no CDN (SPEC-051 P-N03): the server only keeps the file and the page count.

/** A PDF open to be drawn page by page. */
export interface PdfPageRenderer {
  pageCount: number;
  /** Draws the page (from 1) on the canvas, as wide as `width` CSS pixels. */
  render(page: number, canvas: HTMLCanvasElement, width: number): Promise<void>;
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
    return {
      pageCount: doc.numPages,
      async render(page, canvas, width) {
        const pdfPage = await doc.getPage(page);
        const base = pdfPage.getViewport({ scale: 1 });
        const ratio = window.devicePixelRatio || 1;
        const viewport = pdfPage.getViewport({ scale: (width / base.width) * ratio });
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${Math.floor(viewport.width / ratio)}px`;
        canvas.style.height = `${Math.floor(viewport.height / ratio)}px`;
        await pdfPage.render({ canvas, viewport }).promise;
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
