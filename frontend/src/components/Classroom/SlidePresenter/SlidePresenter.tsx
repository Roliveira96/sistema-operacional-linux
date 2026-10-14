"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { Button } from "@/components/Button/Button";
import { messages } from "@/messages/pt-BR";
import type { LiveStroke } from "@/services/classroomService";
import { FRAME_MS, throttle, useCursorSender, type Throttle } from "../cursorSender";
import { StagePointer, useStageScale } from "../FixedStage/FixedStage";
import { percentOf, placeContent, scrollFraction, STAGE_WIDTH, toStagePoint } from "../FixedStage/stage";
import { pdfLoader, type PdfLoader, type PdfPageRenderer } from "./pdfRenderer";
import styles from "./SlidePresenter.module.scss";

const m = messages.classroom.slides;

export interface SlidePresenterProps {
  deck: { downloadUrl: string; pageCount: number };
  slide: number;
  /** The teacher moves the slides and draws on them; a student only follows. */
  canControl: boolean;
  /** The mouse of the teacher: always a pointer, and a highlighted one when the laser is on. Percentages of the whole page. */
  cursor: { x: number; y: number; laser: boolean; visible: boolean } | null;
  strokes: LiveStroke[];
  onSlide(slide: number): void;
  onCursor(x: number, y: number, laser: boolean, visible?: boolean): void;
  /** A piece of a stroke, in percentages of the whole page. */
  onDraw(path: Array<[number, number]>): void;
  onClear(): void;
  /** Where the teacher is in the page, from 0 to 1 of what can be scrolled (SPEC-057): the student follows it, and the teacher is put back there. */
  scroll?: number;
  /** The teacher scrolls the page inside the stage; the position is a fraction of what can be scrolled. */
  onScroll?(y: number): void;
  loader?: PdfLoader;
  /** The presentation window has its own toolbar and keys (SPEC-055 CA-16): no bar, no keys here, and the laser and the pen come from it. */
  bare?: boolean;
  laser?: boolean;
  pen?: boolean;
}

type Point = [number, number];

/**
 * The slides of the live classroom (SPEC-051, section 3.1): drawn from the PDF in the browser, as wide as the stage, with the laser and the pen of
 * the teacher on top. A page taller than the stage scrolls inside it, and only the teacher scrolls (SPEC-057).
 */
export function SlidePresenter({
  deck,
  slide,
  canControl,
  cursor,
  strokes,
  scroll = 0,
  onSlide,
  onCursor,
  onDraw,
  onClear,
  onScroll,
  loader = pdfLoader,
  bare = false,
  laser: laserProp,
  pen: penProp,
}: SlidePresenterProps) {
  const scale = useStageScale();
  const area = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [pdf, setPdf] = useState<PdfPageRenderer | null>(null);
  const [failed, setFailed] = useState(false);
  const [drawn, setDrawn] = useState(0);
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

  // The page is drawn as wide as the room the stage gives it (the 1920 of the stage, less the scroll bar), and as tall as it is.
  useEffect(() => {
    if (!pdf || !canvas.current) return;
    let stale = false;
    pdf.render(current, canvas.current, area.current?.clientWidth || STAGE_WIDTH).then(
      () => !stale && setDrawn((n) => n + 1),
      () => !stale && setFailed(true),
    );
    return () => {
      stale = true;
    };
  }, [pdf, current]);

  // The page is put where the room says: at the top at every slide, and again once it is drawn, because only then it is as tall as it is.
  useEffect(() => {
    if (area.current && sheet.current) placeContent(area.current, sheet.current, scroll, !canControl);
  }, [scroll, current, drawn, canControl]);

  // The pen goes out at the same pace as the pointer. The handlers read the latest props through a ref.
  const send = useRef({ onDraw });
  useEffect(() => {
    send.current = { onDraw };
  });
  const points = useRef<Point[] | null>(null);
  const sent = useRef(0);
  const penOut = useRef<Throttle<[]> | null>(null);
  const flushPen = useRef<() => void>(() => undefined);
  useEffect(() => {
    flushPen.current = () => {
      const path = points.current;
      if (!path || path.length - sent.current < 1 || path.length < 2) return;
      send.current.onDraw(path.slice(Math.max(sent.current - 1, 0)));
      sent.current = path.length;
    };
    const penPace = throttle(() => flushPen.current(), FRAME_MS);
    penOut.current = penPace;
    return () => penPace.cancel();
  }, []);
  const pointer = useCursorSender(onCursor, laser);
  const lastMouse = useRef<{ clientX: number; clientY: number } | null>(null);

  // The place of the mouse as a percentage of the whole page: the scale of the stage is divided out and what is scrolled is added, so it is the same
  // point of the page for everybody, whatever the size of the window and the place of the scroll.
  const where = (at: { clientX: number; clientY: number }): Point => {
    const point = toStagePoint(at, area.current!, scale);
    const page = sheet.current!.getBoundingClientRect();
    return [percentOf(point.x, page.width / scale), percentOf(point.y, page.height / scale)];
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
    lastMouse.current = { clientX: event.clientX, clientY: event.clientY };
    const [x, y] = where(event);
    if (points.current) {
      points.current.push([x, y]);
      penOut.current?.call();
    } else {
      pointer.move(x, y);
    }
  };

  // The pointer goes away from the screens of the class when the mouse leaves the slide.
  const mouseLeaveStage = (event: MouseEvent) => {
    mouseUp(event);
    if (!canControl) return;
    lastMouse.current = null;
    pointer.leave();
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

  // The teacher scrolls: the class is told where, and the pointer follows what is now under the mouse, even if the mouse is still.
  const scrolled = () => {
    if (!canControl || !area.current || !sheet.current) return;
    onScroll?.(scrollFraction(area.current, sheet.current));
    if (lastMouse.current && !points.current) {
      const [x, y] = where(lastMouse.current);
      pointer.move(x, y);
    }
  };

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
        ref={area}
        className={`${styles.area} ${canControl ? "" : styles.follower} ${canControl && pen ? styles.pen : ""}`}
        role="group"
        aria-label={m.stage}
        tabIndex={canControl ? 0 : undefined}
        onKeyDown={keyDown}
        onMouseMove={mouseMove}
        onMouseDown={mouseDown}
        onMouseUp={mouseUp}
        onMouseLeave={mouseLeaveStage}
        onScroll={scrolled}
      >
        <div ref={sheet} className={styles.sheet} data-sheet="">
          <canvas ref={canvas} className={styles.page} />
          <svg className={styles.strokes} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {strokes
              .filter((stroke) => stroke.path && stroke.path.length > 0)
              .map((stroke, index) => (
                <polyline key={index} points={stroke.path!.map((point) => point.join(",")).join(" ")} />
              ))}
          </svg>
          {cursor?.visible && <StagePointer x={cursor.x} y={cursor.y} laser={cursor.laser} />}
        </div>
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
              <Button variant={laser ? "primary" : "secondary"} size="sm" aria-pressed={laser} onClick={() => setLaser(!laser)}>
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
