export const NOTE_IMAGE_MAX_WIDTH = 1220;

export interface OptimizedNoteImage {
  blob: Blob;
  width: number;
  height: number;
  mimeType: "image/avif" | "image/webp";
  fileName: string;
}

function baseNameOf(file: File | Blob): string {
  if ("name" in file && typeof file.name === "string" && file.name.trim()) {
    const trimmed = file.name.trim();
    const dot = trimmed.lastIndexOf(".");
    return dot > 0 ? trimmed.slice(0, dot) : trimmed;
  }
  return "captura";
}

function encodeCanvas(canvas: HTMLCanvasElement, mimeType: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => {
        resolve(blob);
      },
      mimeType,
      quality,
    );
  });
}

/**
 * Downscales images wider than 1220px proportionally using HTMLCanvasElement and encodes them as `image/avif`
 * (with transparent fallback to `image/webp` when the browser does not support AVIF encoding) (SPEC-071 CA-07, CA-08).
 */
export async function optimizeNoteImage(file: File | Blob): Promise<OptimizedNoteImage> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = async () => {
      URL.revokeObjectURL(objectUrl);

      let targetWidth = img.width || NOTE_IMAGE_MAX_WIDTH;
      let targetHeight = img.height || NOTE_IMAGE_MAX_WIDTH;

      if (targetWidth > NOTE_IMAGE_MAX_WIDTH) {
        const ratio = NOTE_IMAGE_MAX_WIDTH / targetWidth;
        targetWidth = NOTE_IMAGE_MAX_WIDTH;
        targetHeight = Math.max(1, Math.round(targetHeight * ratio));
      }

      const canvas = document.createElement("canvas");
      canvas.width = targetWidth;
      canvas.height = targetHeight;

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Canvas 2D context unavailable."));
        return;
      }

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

      const base = baseNameOf(file);
      const avifBlob = await encodeCanvas(canvas, "image/avif", 0.8);
      if (avifBlob && avifBlob.type === "image/avif") {
        resolve({
          blob: avifBlob,
          width: targetWidth,
          height: targetHeight,
          mimeType: "image/avif",
          fileName: `${base}.avif`,
        });
        return;
      }

      const webpBlob = await encodeCanvas(canvas, "image/webp", 0.85);
      if (webpBlob) {
        resolve({
          blob: webpBlob,
          width: targetWidth,
          height: targetHeight,
          mimeType: "image/webp",
          fileName: `${base}.webp`,
        });
        return;
      }

      reject(new Error("Failed to encode note image."));
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Failed to decode image."));
    };

    img.src = objectUrl;
  });
}
