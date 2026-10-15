// The fixed stage of the live class (SPEC-057): a box of 1280 x 720 logical pixels, drawn the same for the teacher and for every student, and fit to
// the window of each one by a scale. Everything that is placed on it (the mouse, the scroll) is told in logical pixels or in fractions of them, so
// the screens agree whatever the size of the window. The teacher can zoom: the box gets smaller in logical pixels, by the zoom, and the scale makes it
// fill the window all the same, so what is drawn in it gets bigger.

/** The only pair of numbers for the size of the stage: the base size, with no zoom. */
export const STAGE_WIDTH = 1280;
export const STAGE_HEIGHT = 720;

/** The zoom levels of the teacher: 100%, 125%, 150%, 175% and 200%. */
export const ZOOM_LEVELS = [1, 1.25, 1.5, 1.75, 2] as const;

/** A zoom kept between 100% and 200%; 100% when it is not a number. */
export function clampZoom(zoom: number): number {
  return Number.isFinite(zoom) ? Math.min(2, Math.max(1, zoom)) : 1;
}

/** The next level up (`1`) or down (`-1`) from the one nearest to the zoom; the ends stay where they are. */
export function stepZoom(current: number, direction: 1 | -1): number {
  const zoom = clampZoom(current);
  let nearest = 0;
  ZOOM_LEVELS.forEach((level, index) => {
    if (Math.abs(level - zoom) < Math.abs(ZOOM_LEVELS[nearest]! - zoom)) nearest = index;
  });
  return ZOOM_LEVELS[Math.min(ZOOM_LEVELS.length - 1, Math.max(0, nearest + direction))]!;
}

/** The size of the stage in logical pixels: the base size divided by the zoom. */
export function stageSize(zoom = 1): { width: number; height: number } {
  const z = clampZoom(zoom);
  return { width: STAGE_WIDTH / z, height: STAGE_HEIGHT / z };
}

/**
 * The scale that fits the stage in a room: the smaller of the two ratios of the size the stage has at that zoom, so nothing is cut and nothing is
 * deformed. 1 while the room has no size.
 */
export function stageScale(width: number, height: number, zoom = 1): number {
  if (!(width > 0) || !(height > 0)) return 1;
  const size = stageSize(zoom);
  return Math.min(width / size.width, height / size.height);
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

/** How far the content can be moved inside its box, down (`y`) or sideways (`x`): what does not fit, in logical pixels. */
export function scrollRange(box: HTMLElement, content: HTMLElement, axis: "x" | "y" = "y"): number {
  return Math.max(0, axis === "y" ? content.offsetHeight - box.clientHeight : content.offsetWidth - box.clientWidth);
}

/** Where the box is scrolled, as a fraction of what can be scrolled; 0 when everything fits. */
export function scrollFraction(box: HTMLElement, content: HTMLElement, axis: "x" | "y" = "y"): number {
  const range = scrollRange(box, content, axis);
  return range > 0 ? unit((axis === "y" ? box.scrollTop : box.scrollLeft) / range) : 0;
}

/**
 * Puts the box at a fraction of what can be scrolled, down and sideways. The one who drives it (the teacher) scrolls the box itself; the one who
 * only follows (the student) has the content moved instead, because nobody scrolls his box and the move has a transition of 100 ms in the style.
 */
export function placeContent(box: HTMLElement, content: HTMLElement, fraction: number, follower: boolean, fractionX = 0): void {
  const y = Math.round(unit(fraction) * scrollRange(box, content, "y"));
  const x = Math.round(unit(fractionX) * scrollRange(box, content, "x"));
  if (follower) {
    box.scrollTop = 0;
    box.scrollLeft = 0;
    content.style.transform = `translate(${-x}px, ${-y}px)`;
  } else {
    content.style.transform = "";
    box.scrollTop = y;
    box.scrollLeft = x;
  }
}
