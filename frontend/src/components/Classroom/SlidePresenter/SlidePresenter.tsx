"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { Button } from "@/components/Button/Button";
import { messages } from "@/messages/pt-BR";
import type { LiveStroke } from "@/services/classroomService";
import { pdfLoader, type PdfLoader, type PdfPageRenderer } from "./pdfRenderer";
import styles from "./SlidePresenter.module.scss";

const m = messages.classroom.slides;

/** The pointer and the pen go out about 30 times a second (SPEC-051 CA-06). */
export const FRAME_MS = 33;

export interface SlidePresenterProps {
  deck: { downloadUrl: string; pageCount: number };
  slide: number;
  /** The teacher moves the slides and draws on them; a student only follows. */
  canControl: boolean;
  cursor: { x: number; y: number; laser: boolean } | null;
  strokes: LiveStroke[];
  onSlide(slide: number): void;
  onCursor(x: number, y: number, laser: boolean): void;
  /** A piece of a stroke, in percentages of the slide. */
  onDraw(path: Array<[number, number]>): void;
  onClear(): void;
  loader?: PdfLoader;
  /** The presentation window has its own toolbar and keys (SPEC-055 CA-16): no bar, no keys here, and the laser and the pen come from it. */
  bare?: boolean;
  laser?: boolean;
  pen?: boolean;
}

type Point = [number, number];

interface Throttle<A extends unknown[]> {
  call(...args: A): void;
  cancel(): void;
}

/** Calls at once, then at most once every `ms` with the latest arguments; the last call always gets through. */
function throttle<A extends unknown[]>(fn: (...args: A) => void, ms: number): Throttle<A> {
  let last = -Infinity;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: A | null = null;
  return {
    call(...args: A) {
      const wait = last + ms - Date.now();
      if (wait <= 0) {
        clearTimeout(timer);
        timer = undefined;
        pending = null;
        last = Date.now();
        fn(...args);
        return;
      }
      pending = args;
      timer ??= setTimeout(() => {
        timer = undefined;
        last = Date.now();
        const next = pending;
        pending = null;
        if (next) fn(...next);
      }, wait);
    },
    cancel() {
      clearTimeout(timer);
      timer = undefined;
      pending = null;
    },
  };
}

/** The slides of the live classroom (SPEC-051, section 3.1): drawn from the PDF in the browser, with the laser and the pen of the teacher on top. */
export function SlidePresenter({ deck, slide, canControl, cursor, strokes, onSlide, onCursor, onDraw, onClear, loader = pdfLoader, bare = false, laser: laserProp, pen: penProp }: SlidePresenterProps) {
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [pdf, setPdf] = useState<PdfPageRenderer | null>(null);
  const [failed, setFailed] = useState(false);
  const [ownLaser, setLaser] = useState(false);
  const [ownPen, setPen] = useState(false);
  const laser = laserProp ?? ownLaser;
  const pen = penProp ?? ownPen;

  const total = pdf?.pageCount ?? deck.pageCount;
  const current = Math.min(Math.max(slide, 1), Math.max(total, 1));

  useEffect(() => {
    let cancelled = false;
    let opened: PdfPageRenderer | null = null;
    loader.load(deck.downloadUrl).then(
      (loaded) => {
        if (cancelled) return loaded.destroy();
        opened = loaded;
        setPdf(loaded);
      },
      () => !cancelled && setFailed(true),
    );
    return () => {
      cancelled = true;
      opened?.destroy();
    };
  }, [loader, deck.downloadUrl]);

  useEffect(() => {
    if (!pdf || !canvas.current) return;
    const width = stage.current?.getBoundingClientRect().width || 960;
    pdf.render(current, canvas.current, width).catch(() => setFailed(true));
  }, [pdf, current]);

  // The pointer and the pen go out at the same pace. They are made in an effect, and the handlers read the latest props through a ref.
  const send = useRef({ onCursor, onDraw });
  useEffect(() => {
    send.current = { onCursor, onDraw };
  });
  const points = useRef<Point[] | null>(null);
  const sent = useRef(0);
  const cursorOut = useRef<Throttle<[number, number, boolean]> | null>(null);
  const penOut = useRef<Throttle<[]> | null>(null);
  const flushPen = useRef<() => void>(() => undefined);
  useEffect(() => {
    flushPen.current = () => {
      const path = points.current;
      if (!path || path.length - sent.current < 1 || path.length < 2) return;
      send.current.onDraw(path.slice(Math.max(sent.current - 1, 0)));
      sent.current = path.length;
    };
    const cursorPace = throttle((x: number, y: number, on: boolean) => send.current.onCursor(x, y, on), FRAME_MS);
    const penPace = throttle(() => flushPen.current(), FRAME_MS);
    cursorOut.current = cursorPace;
    penOut.current = penPace;
    return () => {
      cursorPace.cancel();
      penPace.cancel();
    };
  }, []);

  const where = (event: MouseEvent): Point => {
    const rect = stage.current!.getBoundingClientRect();
    const clamp = (value: number) => Math.min(100, Math.max(0, Math.round(value * 100) / 100));
    return [clamp(((event.clientX - rect.left) / rect.width) * 100), clamp(((event.clientY - rect.top) / rect.height) * 100)];
  };

  const goto = (to: number) => onSlide(Math.min(Math.max(to, 1), Math.max(total, 1)));

  const keyDown = (event: KeyboardEvent) => {
    if (!canControl || bare) return;
    if (event.key === "ArrowRight" || event.key === "ArrowDown" || event.key === " ") {
      event.preventDefault();
      goto(current + 1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      goto(current - 1);
    }
  };

  const mouseMove = (event: MouseEvent) => {
    if (!canControl) return;
    const [x, y] = where(event);
    if (points.current) {
      points.current.push([x, y]);
      penOut.current?.call();
    } else if (laser) {
      cursorOut.current?.call(x, y, true);
    }
  };

  const mouseDown = (event: MouseEvent) => {
    if (!canControl || !pen) return;
    points.current = [where(event)];
    sent.current = 0;
  };

  const mouseUp = (event: MouseEvent) => {
    if (!points.current) return;
    points.current.push(where(event));
    penOut.current?.cancel();
    flushPen.current();
    points.current = null;
  };

  const toggleLaser = () => setLaser(!laser);

  // Whoever turns the laser off, the class stops seeing it.
  const wasLaser = useRef(laser);
  useEffect(() => {
    if (wasLaser.current && !laser) cursorOut.current?.call(0, 0, false);
    wasLaser.current = laser;
  }, [laser]);

  return (
    <section className={styles.presenter}>
      {failed && (
        <p className={styles.error} role="alert">
          {m.loadError}
        </p>
      )}
      {!pdf && !failed && (
        <p className={styles.note} role="status">
          {m.loading}
        </p>
      )}
      <div
        ref={stage}
        className={`${styles.stage} ${canControl && pen ? styles.pen : ""}`}
        role="group"
        aria-label={m.stage}
        tabIndex={0}
        onKeyDown={keyDown}
        onMouseMove={mouseMove}
        onMouseDown={mouseDown}
        onMouseUp={mouseUp}
        onMouseLeave={mouseUp}
      >
        <canvas ref={canvas} className={styles.page} />
        <svg className={styles.strokes} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {strokes
            .filter((stroke) => stroke.path && stroke.path.length > 0)
            .map((stroke, index) => (
              <polyline key={index} points={stroke.path!.map((point) => point.join(",")).join(" ")} />
            ))}
        </svg>
        {cursor?.laser && <span className={styles.laser} data-laser="" style={{ left: `${cursor.x}%`, top: `${cursor.y}%` }} />}
      </div>

      {!bare && (
      <div className={styles.bar}>
        {canControl && (
          <>
            <Button variant="secondary" size="sm" disabled={current <= 1} onClick={() => goto(current - 1)}>
              {m.previous}
            </Button>
            <Button variant="secondary" size="sm" disabled={current >= total} onClick={() => goto(current + 1)}>
              {m.next}
            </Button>
          </>
        )}
        <span className={styles.position}>{m.position(current, total)}</span>
        {canControl && (
          <>
            <label className={styles.goto}>
              <span className={styles.srOnly}>{m.goTo}</span>
              <input
                type="number"
                min={1}
                max={total}
                value={current}
                onChange={(e) => {
                  const to = Number(e.target.value);
                  if (Number.isFinite(to) && e.target.value !== "") goto(to);
                }}
              />
            </label>
            <Button variant={laser ? "primary" : "secondary"} size="sm" aria-pressed={laser} onClick={toggleLaser}>
              {m.laser}
            </Button>
            <Button variant={pen ? "primary" : "secondary"} size="sm" aria-pressed={pen} onClick={() => setPen(!pen)}>
              {m.pen}
            </Button>
            <Button variant="ghost" size="sm" onClick={onClear}>
              {m.clear}
            </Button>
          </>
        )}
      </div>
      )}
    </section>
  );
}
