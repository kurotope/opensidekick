// Page capture rules: the clamp into the capture, the climb, the floors and the notes.
import { MIN_REGION_PX, CAPTURE_NOTES, regionAllowed, cropRect, resolveElementBox, shotLabel } from "../src/common/capture.js";

let fail = 0;
const ok = (c, m) => { console.log((c ? "ok  : " : "FAIL: ") + m); if (!c) fail = 1; };

const r = (x, y, w, h, tag) => ({ x, y, w, h, tag });
const CAP = { w: 800, h: 600 };

// --- the region floor --------------------------------------------------------

ok(regionAllowed(15, 200).ok === false, "a 15 px wide region is refused (got ok false, wanted no shot)");
ok(regionAllowed(200, 15).ok === false, "a 15 px tall region is refused on its height as well");
ok(regionAllowed(16, 16).ok, "exactly 16×16 is accepted (got ok, wanted the smallest allowed box)");
ok(regionAllowed(16, 1000).ok, "a 16 px strip at the floor is accepted");
ok(regionAllowed(NaN, 100).ok === false, "a NaN side is refused, not thrown on");
ok(regionAllowed(0, 100).ok === false, "a zero side is refused, not thrown on");
ok(regionAllowed(-5, 100).ok === false, "a negative side is refused, not thrown on");
ok(regionAllowed("no", 100).ok === false, "a junk side is refused, not thrown on");
ok(CAPTURE_NOTES.tiny.includes(String(MIN_REGION_PX)), "the tiny note names the floor a region has to reach");

// --- the crop clamped into the capture, at CSS-pixel scale 1 -----------------

const inside = cropRect(r(100, 100, 200, 100), CAP.w, CAP.h);
ok(inside.x === 100 && inside.y === 100 && inside.w === 200 && inside.h === 100 && inside.clipped === false && inside.visible === true,
  `a rect inside the capture is unchanged (got "${inside.x},${inside.y} ${inside.w}x${inside.h}", wanted "100,100 200x100")`);
const clamp = cropRect(r(700, 580, 120, 60), CAP.w, CAP.h);
ok(clamp.x === 700 && clamp.y === 580 && clamp.w === 100 && clamp.h === 20,
  `rect 700,580,120×60 in an 800×600 capture clamps to 100×20 (got "${clamp.w}x${clamp.h}" at ${clamp.x},${clamp.y}, wanted "100x20" at 700,580)`);
ok(clamp.clipped === true && clamp.visible === true, "the clamped box is marked clipped and captured");
const edge = cropRect(r(790, 590, 20, 20), CAP.w, CAP.h);
ok(edge.x === 790 && edge.y === 590 && edge.w === 10 && edge.h === 10 && edge.clipped === true,
  "a box past the right and bottom edge shrinks to the edge (got \"10x10\" at 790,590, wanted the part inside)");
const off = cropRect(r(-20, -10, 40, 30), CAP.w, CAP.h);
ok(off.x === 0 && off.y === 0 && off.w === 20 && off.h === 20 && off.clipped === true,
  "a box past the left and top edge starts at 0,0 and keeps only the part inside (got \"20x20\" at 0,0, wanted \"20x20\" at 0,0)");
const straddle = cropRect(r(100, 550, 200, 100), CAP.w, CAP.h);
ok(straddle.visible === true && straddle.x === 100 && straddle.y === 550 && straddle.w === 200 && straddle.h === 50,
  `a box straddling the captured edge keeps its inside part (got "${straddle.x},${straddle.y} ${straddle.w}x${straddle.h}", wanted "100,550 200x50")`);
ok(cropRect(r(100, 660, 200, 100), CAP.w, CAP.h).visible === false, "a box below the captured edge is refused with visible false, not scaled into the shot");
ok(cropRect(r(900, 700, 50, 50), CAP.w, CAP.h).visible === false, "a box past the right and bottom edge is refused with visible false");
ok(cropRect(r(10, -100, 50, 50), CAP.w, CAP.h).visible === false, "a box above the capture is refused with visible false");
ok(cropRect(r(-100, 10, 50, 50), CAP.w, CAP.h).visible === false, "a box left of the capture is refused with visible false");
const frac = cropRect(r(10.7, 20.3, 30.6, 40.9), CAP.w, CAP.h);
ok(frac.x === 10 && frac.y === 20 && frac.w === 31 && frac.h === 41 && frac.clipped === false,
  `a fractional rect floors to whole pixels (got "${frac.x},${frac.y} ${frac.w}x${frac.h}", wanted "10,20 31x41")`);
const fracEdge = cropRect(r(790.6, 590.5, 20.4, 20.5), CAP.w, CAP.h);
ok(fracEdge.x === 790 && fracEdge.y === 590 && fracEdge.w === 10 && fracEdge.h === 10 && fracEdge.clipped === true,
  `a fractional rect at the edge floors and clamps (got "${fracEdge.x},${fracEdge.y} ${fracEdge.w}x${fracEdge.h}", wanted "790,590 10x10")`);
ok(cropRect(r(0, 0, 1, 1), CAP.w, CAP.h).w === 1, "a 1×1 element keeps its one pixel");
ok(cropRect(r(0, 0, 800, 600), CAP.w, CAP.h).clipped === false, "a rect exactly the capture is not clipped");
ok(cropRect(r(0, 0, 800, 600), CAP.w, CAP.h).visible === true, "a rect exactly the capture is captured");
ok(cropRect(r("700", "580", "120", "60"), CAP.w, CAP.h).visible === false, "a rect of strings is refused, not thrown on");
ok(cropRect({ x: 10, y: 20 }, CAP.w, CAP.h).visible === false, "a rect with no size is refused, not thrown on");
ok(cropRect(null, CAP.w, CAP.h).visible === false, "no rect at all is refused, not thrown on");
ok(cropRect(r(NaN, 10, 30, 40), CAP.w, CAP.h).visible === false, "a NaN position is refused, not thrown on");
ok(cropRect(r(10, 20, NaN, 40), CAP.w, CAP.h).visible === false, "a NaN width is refused, not thrown on");
ok(cropRect(r(10, 20, 0, 40), CAP.w, CAP.h).visible === false, "a zero-width box is refused, not thrown on");
ok(cropRect(r(10, 20, 30, 0), CAP.w, CAP.h).visible === false, "a zero-height box is refused, not thrown on");
ok(cropRect(r(10, 20, -30, 40), CAP.w, CAP.h).visible === false, "a negative-width box is refused, not thrown on");
ok(cropRect(r(10, 20, 30, 40), 0, CAP.h).visible === false, "a capture with a zero side is refused, not thrown on");
ok(cropRect(r(10, 20, 30, 40), CAP.w, NaN).visible === false, "a capture with a NaN side is refused, not thrown on");
ok(cropRect(r(10, 20, 30, 40), undefined, CAP.h).visible === false, "a capture with no width is refused, not thrown on");

// --- the climb to the container ----------------------------------------------

const CARD = r(20, 20, 424, 324, "div");
const BODY = r(0, 0, 800, 600, "body");
const para = resolveElementBox([r(40, 60, 400, 20, "p"), CARD, BODY]);
ok(para.w === 424 && para.h === 324 && para.tag === "div",
  "a paragraph inside a 424×324 card gives the card (got \"424x324\", wanted the card)");
const head = resolveElementBox([r(40, 30, 300, 40, "h2"), CARD, BODY]);
ok(head.w === 424 && head.h === 324, "an h2 inside the same card gives the card (got \"424x324\", wanted the card)");
const image = resolveElementBox([r(200, 200, 100, 40, "img"), CARD, BODY]);
ok(image.w === 100 && image.h === 40 && image.tag === "img",
  "a 100×40 image inside the card stays its own box (got \"100x40\", wanted the image, not the card)");
const solo = resolveElementBox([r(100, 100, 300, 100, "div"), BODY]);
ok(solo.w === 300 && solo.h === 100, "a standalone div whose parent is body stays its own box (got \"300x100\", wanted the div)");
const chain = resolveElementBox([
  r(10, 10, 10, 10, "span"), r(0, 0, 20, 20, "a"), r(0, 0, 30, 30, "b"),
  r(0, 0, 40, 40, "c"), r(0, 0, 50, 50, "d"), r(0, 0, 60, 60, "e"), BODY,
]);
ok(chain.w === 50 && chain.h === 50 && chain.tag === "d",
  "a chain of small parents climbs to the fourth parent and stops there (got \"50x50\" at div d, wanted the fourth parent, not e)");
ok(resolveElementBox([r(100, 100, 300, 100, "div"), BODY]).tag === "div", "a body rect is never returned");
ok(resolveElementBox([BODY]) === null, "a body-only chain returns no box, not a body rect");
ok(resolveElementBox([r(0, 0, 800, 600, "html"), BODY]) === null, "an html rect is never returned");
ok(resolveElementBox([r(100, 100, 100, 100, "div"), r(0, 0, 500, 500, "section"), BODY]).tag === "section",
  "a parent exactly 25 times the box is climbed to (got the section's box, wanted the parent)");
ok(resolveElementBox([r(100, 100, 100, 100, "div"), r(0, 0, 501, 501, "section"), BODY]).tag === "div",
  "a parent past 25 times the box is not climbed to (got the div's own box, wanted the target)");
ok(resolveElementBox([r(40, 60, 400, 20, "p"), { tag: "div" }, BODY]).tag === "p", "a broken ancestor chain stops the climb at the target");
ok(resolveElementBox([]) === null, "no rects return no box, not thrown on");
ok(resolveElementBox(null) === null, "no list at all returns no box, not thrown on");
ok(resolveElementBox([r(NaN, 0, 10, 10, "div"), CARD]) === null, "a junk target rect returns no box, not thrown on");

// --- notes ------------------------------------------------------------------

const NOTE_KEYS = ["restricted", "outside", "clipped", "tiny", "nothing", "frame", "cancelled", "timeout"];
ok(NOTE_KEYS.every((k) => typeof CAPTURE_NOTES[k] === "string" && CAPTURE_NOTES[k].length > 0),
  "every capture refusal has a note the user can read");

// --- labels -----------------------------------------------------------------

ok(shotLabel("visible", "", 800, 600) === "Visible area", "a visible-area shot is named by the area, with no size (got \"Visible area\", wanted the area words)");
ok(shotLabel("region", "", 120, 120) === "Region 120×120", "a region shot is named by the box the user drew (got \"Region 120×120\", wanted the box size)");
ok(shotLabel("region", "div", 120, 120) === "Region 120×120", "a region shot keeps the region word, not the element name");
ok(shotLabel("element", "div", 200, 100) === "div 200×100", "an element shot carries the name and the size (got \"div 200×100\", wanted name plus size)");
ok(shotLabel("element", "", 200, 100) === "Element 200×100", "an element with no name falls back to the mode's word");
ok(shotLabel("rightclick", "img", 100, 40) === "img 100×40", "the right-click shot is named like the element it climbed to");
ok(shotLabel("rightclick", "   ", 100, 40) === "Element 100×40", "a right-click shot with a blank name falls back to the word");

console.log(fail ? "\nSOME CAPTURE TESTS FAILED" : "\nALL CAPTURE TESTS PASSED");
process.exit(fail);
