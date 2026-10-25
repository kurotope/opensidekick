// Page capture rules: the math between a picked box and a shot. No chrome.*, no DOM;
// the worker is the only caller, and it applies every rule here to the decoded capture.

import { CAPTURE_ROWS } from "./constants.js";

// The modes a capture accepts, read off the rows the two menus render: a mode with no row
// and a row with no mode cannot exist.
export const CAPTURE_MODES = CAPTURE_ROWS.map((r) => r.mode);

// A region under this in either dimension is a sliver the model cannot read, and a drag
// that small is almost always a mis-drag.
export const MIN_REGION_PX = 16;

// The element a right-click records is usually a leaf — a paragraph, an <img> — so the box
// climbs to the container that names it. 25 keeps a card around its paragraph and leaves an
// image its own box.
export const CLIMB_RATIO = 25;

// A few levels reach the container; past that the box is the page, which is already the
// visible-area shot.
export const MAX_CLIMB_LEVELS = 4;

// A pick waits for the user, and while it waits the page's overlay and cursor are held; a
// pick this old is cancelled so the page is released.
export const PICK_TIMEOUT_MS = 20000;

// The words a shot is named with. A region is named by the box the user drew, not by the
// page; a visible-area shot has no box, so no size.
const MODE_WORDS = { visible: "Visible area", element: "Element", region: "Region", rightclick: "Element" };

// A box is never a document: a shot of the whole page is the visible-area mode, so a
// body/html rect is not an element shot.
const ROOT_TAGS = new Set(["body", "html"]);

// The capture refusals in the user's words. The image count cap and its note belong to
// attachments.js, so nothing here names a count: one rule, one note.
export const CAPTURE_NOTES = {
  restricted: "This page can't be captured — Chrome blocks screenshots of browser pages and the Web Store.",
  outside: "Nothing captured — the box is outside the visible area. Scroll it into view and try again.",
  clipped: "Only the part of the box inside the visible area was captured.",
  tiny: `Region too small — a capture is at least ${MIN_REGION_PX}×${MIN_REGION_PX} pixels. Drag a bigger box.`,
  nothing: "No element was recorded — use Capture this element and click the element you want.",
  frame: "The box reported is the frame's own, so the shot is the frame, not the page inside it.",
  cancelled: "Capture stopped — Escape ends a pick.",
  timeout: "The pick timed out before a box was committed. Try again.",
};

/** false when a side is under the floor, so the caller refuses the shot with the tiny note. */
export function regionAllowed(w, h) {
  const width = Number(w);
  const height = Number(h);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < MIN_REGION_PX || height < MIN_REGION_PX) {
    return { ok: false };
  }
  return { ok: true };
}

// The capture is the viewport's top-left region, in CSS pixels, so the box the page reports is
// already in capture pixels: a rect needs no transform, and a box below the captured edge is
// outside the shot, not shrunk into it. The pixel probe is the guard for that rule.
/** The crop in capture pixels: { x, y, w, h, clipped, visible }; { visible: false } when the box
 *  is empty or lies outside the capture, so the caller refuses the shot. */
export function cropRect(rect, imgW, imgH) {
  const refused = { visible: false };
  if (!rect) return refused;
  for (const v of [rect.x, rect.y, rect.w, rect.h, imgW, imgH]) {
    if (typeof v !== "number" || !Number.isFinite(v)) return refused;
  }
  if (rect.w < 1 || rect.h < 1 || imgW < 1 || imgH < 1) return refused;
  const bx = Math.floor(rect.x);
  const by = Math.floor(rect.y);
  const x = Math.max(0, bx);
  const y = Math.max(0, by);
  const right = Math.floor(rect.x + rect.w);
  const bottom = Math.floor(rect.y + rect.h);
  const w = Math.min(imgW, right) - x;
  const h = Math.min(imgH, bottom) - y;
  if (w < 1 || h < 1) return refused;
  return { x, y, w, h, clipped: x !== bx || y !== by || x + w !== right || y + h !== bottom, visible: true };
}

// The climb is the ratio test applied upward: stop at the first parent whose area is more
// than CLIMB_RATIO times the box below it, so the shot is the thing the user pointed at.
/** rects: the target first, then each ancestor, as { x, y, w, h, tag }. The element box
 *  { x, y, w, h, tag }, or null when no box is left that is not the document. */
export function resolveElementBox(rects) {
  if (!Array.isArray(rects) || rects.length === 0) return null;
  const first = rects[0];
  if (!measurable(first) || isRoot(first.tag)) return null;
  let box = first;
  let area = first.w * first.h;
  let levels = 0;
  while (levels < MAX_CLIMB_LEVELS) {
    const parent = rects[levels + 1];
    if (!measurable(parent) || isRoot(parent.tag)) break;
    const parentArea = parent.w * parent.h;
    if (parentArea > CLIMB_RATIO * area) break;
    box = parent;
    area = parentArea;
    levels++;
  }
  return { x: box.x, y: box.y, w: box.w, h: box.h, tag: box.tag };
}

// A name is a tag the page supplied, so it is trimmed; a shot with no name falls back to
// the word that names the mode.
/** The words that name a captured shot: "Visible area", "Region 120×120", "div 200×100". */
export function shotLabel(mode, name, w, h) {
  const words = MODE_WORDS[mode] || "Capture";
  if (mode === "visible") return words;
  const label = mode === "region" ? words : String(name ?? "").trim() || words;
  return `${label} ${Math.round(w) || 0}×${Math.round(h) || 0}`;
}

const isRoot = (tag) => ROOT_TAGS.has(String(tag).toLowerCase());

// A rect the climb can measure: x, y, w, h as finite numbers.
function measurable(r) {
  if (!r) return false;
  for (const v of [r.x, r.y, r.w, r.h]) {
    if (typeof v !== "number" || !Number.isFinite(v)) return false;
  }
  return true;
}
