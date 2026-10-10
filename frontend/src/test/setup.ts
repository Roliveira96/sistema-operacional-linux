// jsdom has no layout. The visual editor (ProseMirror) asks ranges for their rectangles when it
// scrolls the cursor into view, and that can happen after a test has finished, as an unhandled
// error. Empty rectangles are enough for the tests.
const rect = { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}) } as DOMRect;
const none = { length: 0, item: () => null, [Symbol.iterator]: function* () {} } as unknown as DOMRectList;

if (typeof Range !== "undefined") {
  Range.prototype.getClientRects ??= () => none;
  Range.prototype.getBoundingClientRect ??= () => rect;
}
