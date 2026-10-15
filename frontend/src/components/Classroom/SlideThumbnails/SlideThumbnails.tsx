"use client";

import { useEffect, useRef } from "react";
import { messages } from "@/messages/pt-BR";
import { pdfLoader, type PdfLoader } from "../SlidePresenter/pdfRenderer";
import styles from "./SlideThumbnails.module.scss";

const m = messages.classroom.teacher.stage;
const s = messages.classroom.slides;

/** How wide each small slide is drawn, in CSS pixels. */
const THUMB_WIDTH = 160;

export interface SlideThumbnailsProps {
  deck: { downloadUrl: string; pageCount: number };
  /** The slide on the stage. */
  current: number;
  onSelect(slide: number): void;
  loader?: PdfLoader;
}

/** The slides of the class, small, for the teacher to go to one (SPEC-055 CA-03). */
export function SlideThumbnails({ deck, current, onSelect, loader = pdfLoader }: SlideThumbnailsProps) {
  const canvases = useRef<Array<HTMLCanvasElement | null>>([]);

  useEffect(() => {
    let cancelled = false;
    let opened: { destroy(): void } | null = null;
    loader
      .load(deck.downloadUrl)
      .then(async (pdf) => {
        if (cancelled) return pdf.destroy();
        opened = pdf;
        // ponytail: one after the other, up to 100 pages; draw only the ones in view if a deck this long gets slow.
        for (let page = 1; page <= pdf.pageCount && !cancelled; page++) {
          const canvas = canvases.current[page - 1];
          if (canvas) await pdf.render(page, canvas, THUMB_WIDTH);
        }
      })
      // Without the picture, the numbers still work.
      .catch(() => undefined);
    return () => {
      cancelled = true;
      opened?.destroy();
    };
  }, [loader, deck.downloadUrl]);

  return (
    <ol className={styles.list} aria-label={m.thumbnails}>
      {Array.from({ length: deck.pageCount }, (_, index) => {
        const page = index + 1;
        return (
          <li key={page}>
            <button
              type="button"
              className={`${styles.thumb} ${page === current ? styles.current : ""}`}
              aria-label={s.thumbnail(page)}
              aria-current={page === current ? "true" : undefined}
              onClick={() => onSelect(page)}
            >
              <canvas ref={(el) => void (canvases.current[index] = el)} className={styles.canvas} aria-hidden="true" />
              <span className={styles.number}>{page}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
