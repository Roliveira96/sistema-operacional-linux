// The fixed stage of the live class (SPEC-057): a box of 1920 x 1080 logical pixels, drawn the same for the teacher and for every student, and fit to
// the window of each one by a scale. Everything that is placed on it (the mouse, the scroll) is told in logical pixels or in fractions of them, so
// the screens agree whatever the size of the window.

export const STAGE_WIDTH = 1920;
export const STAGE_HEIGHT = 1080;

/** The scale that fits the stage in a room: the smaller of the two ratios, so nothing is cut and nothing is deformed. 1 while the room has no size. */
export function stageScale(width: number, height: number): number {
  if (!(width > 0) || !(height > 0)) return 1;
  return Math.min(width / STAGE_WIDTH, height / STAGE_HEIGHT);
}

export interface StagePoint {
  x: number;
  y: number;
}

/**
 * Where the mouse is, in logical pixels from the corner of `el` (SPEC-057 section 6): the distance on the screen divided by the scale of the stage,
 * plus what `el` has scrolled, which is in logical pixels already. The one helper for the slide and for the module.
 */
export function toStagePoint(event: { clientX: number; clientY: number }, el: HTMLElement, scale: number): StagePoint {
  const rect = el.getBoundingClientRect();
  return { x: (event.clientX - rect.left) / scale + el.scrollLeft, y: (event.clientY - rect.top) / scale + el.scrollTop };
}

/** A part of a whole as a percentage with two decimals, kept between 0 and 100. */
export function percentOf(value: number, whole: number): number {
  const percent = (value / whole) * 100;
  return Number.isFinite(percent) ? Math.min(100, Math.max(0, Math.round(percent * 100) / 100)) : 0;
}

const unit = (value: number) => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0);

/** How far the content can be moved inside its box: what does not fit, in logical pixels. */
export function scrollRange(box: HTMLElement, content: HTMLElement): number {
  return Math.max(0, content.offsetHeight - box.clientHeight);
}

/** Where the box is scrolled, as a fraction of what can be scrolled; 0 when everything fits. */
export function scrollFraction(box: HTMLElement, content: HTMLElement): number {
  const range = scrollRange(box, content);
  return range > 0 ? unit(box.scrollTop / range) : 0;
}

/**
 * Puts the box at a fraction of what can be scrolled. The one who drives it (the teacher) scrolls the box itself; the one who only follows (the
 * student) has the content moved instead, because nobody scrolls his box and the move has a transition of 100 ms in the style.
 */
export function placeContent(box: HTMLElement, content: HTMLElement, fraction: number, follower: boolean): void {
  const offset = Math.round(unit(fraction) * scrollRange(box, content));
  if (follower) {
    box.scrollTop = 0;
    content.style.transform = `translateY(${-offset}px)`;
  } else {
    content.style.transform = "";
    box.scrollTop = offset;
  }
}
