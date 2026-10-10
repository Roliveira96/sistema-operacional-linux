"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { contentMessages } from "@/messages/content.pt-BR";
import styles from "./ImageLightbox.module.scss";

const m = contentMessages.gallery;

export interface LightboxImage {
  src: string;
  caption: string;
}

/** The pictures of a gallery larger, one at a time: arrows or the buttons to go through them, Escape or the button to close. */
export function ImageLightbox({ images, start, onClose }: { images: LightboxImage[]; start: number; onClose: () => void }) {
  const titleId = useId();
  const close = useRef<HTMLButtonElement>(null);
  const [index, setIndex] = useState(start);
  const last = images.length - 1;
  const go = (to: number) => setIndex(Math.min(last, Math.max(0, to)));

  useEffect(() => {
    close.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft") setIndex((i) => Math.max(0, i - 1));
      if (event.key === "ArrowRight") setIndex((i) => Math.min(last, i + 1));
    };
    document.addEventListener("keydown", onKey);
    // The page behind does not scroll while the picture is open.
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose, last]);

  const current = images[index]!;
  return createPortal(
    <div className={styles.overlay} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId} className={styles.srOnly}>
          {m.title}
        </h2>
        <button ref={close} type="button" className={styles.close} onClick={onClose}>
          {m.close}
        </button>
        <figure className={styles.figure}>
          {/* eslint-disable-next-line @next/next/no-img-element -- the address is one the system kept. */}
          <img src={current.src} alt={current.caption} className={styles.picture} />
          {current.caption && <figcaption className={styles.caption}>{current.caption}</figcaption>}
        </figure>
        {images.length > 1 && (
          <div className={styles.nav}>
            <button type="button" className={styles.step} onClick={() => go(index - 1)} disabled={index === 0} aria-label={m.previous}>
              ←
            </button>
            <span className={styles.position} aria-live="polite">
              {m.position(index + 1, images.length)}
            </span>
            <button type="button" className={styles.step} onClick={() => go(index + 1)} disabled={index === last} aria-label={m.next}>
              →
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
