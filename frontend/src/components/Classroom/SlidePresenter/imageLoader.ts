// An image presentation drawn on the canvas of the stage (SPEC-068): the same reader contract as the PDF, with one page.

import { STAGE_HEIGHT } from "../FixedStage/stage";
import type { PdfLoader } from "./pdfRenderer";

/** The size the image is drawn with: the biggest that fits whole in the box, with the shape it has. */
export function fitWithin(natural: { width: number; height: number }, maxWidth: number, maxHeight: number): { width: number; height: number } {
  const scale = Math.min(maxWidth / natural.width, maxHeight / natural.height);
  return { width: Math.round(natural.width * scale), height: Math.round(natural.height * scale) };
}

/** Loads the image of the address, and draws it whole: as wide as the stage gives, and no taller than the stage. */
export const imageLoader: PdfLoader = {
  load(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () =>
        resolve({
          pageCount: 1,
          async render(_page, canvas, width, density = window.devicePixelRatio || 1) {
            const size = fitWithin({ width: image.naturalWidth, height: image.naturalHeight }, width, STAGE_HEIGHT);
            canvas.width = Math.floor(size.width * density);
            canvas.height = Math.floor(size.height * density);
            canvas.style.width = `${size.width}px`;
            canvas.style.height = `${size.height}px`;
            canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
          },
          destroy() {},
        });
      image.onerror = () => reject(new Error("the image cannot be loaded"));
      image.src = url;
    });
  },
};
