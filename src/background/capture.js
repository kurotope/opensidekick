// The worker's capture pipeline: the page reports a box, this turns it into the shot the
// panel drains. Nothing is bound at import time, so the import graph loads under node.

import { MSG, SESSION_PENDING_SHOT_KEY } from "../common/constants.js";
import {
  CAPTURE_MODES,
  PICK_TIMEOUT_MS,
  CAPTURE_NOTES,
  cropRect,
  regionAllowed,
  resolveElementBox,
  shotLabel,
} from "../common/capture.js";
import { sourceAllowed, targetSize, acceptImage, MAX_IMAGES, roomFor, ATTACH_NOTES } from "../common/attachments.js";
import { originOf } from "./permissions.js";
import { csSend, toBase64 } from "./tools.js";

// The storage-full warning for a capture, in the shape the history write that cannot make
// room uses: say it once, drop this shot, never fail the capture silently.
const SHOT_FULL_WARNING =
  "Couldn't park this capture: OpenSidekick's browser storage is full. Free space for OpenSidekick in this browser's storage, then capture again.";

// The note a reply carries: a send that never reached the page, a pick released by Escape, a
// pick that never committed, a box that was never recorded. A refusal is a note, never a throw.
function replyNote(reply) {
  if (!reply || reply.error) return CAPTURE_NOTES.restricted;
  if (reply.timedOut) return CAPTURE_NOTES.timeout;
  if (reply.cancelled) return CAPTURE_NOTES.cancelled;
  if (!reply.ok) return CAPTURE_NOTES[reply.reason] || CAPTURE_NOTES.nothing;
  return null;
}

// A pick waits for the user, and while it waits the page keeps a crosshair and a highlight the
// extension is holding; a pick this old is released so the page is let go.
async function pickReply(tabId, mode, ms = PICK_TIMEOUT_MS) {
  const send = csSend(tabId, { type: MSG.CS_CAPTURE, mode });
  if (mode !== "element" && mode !== "region") return send;
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      // The cancel send is what releases the pick: the content script removes its pixels and
      // answers the send it has been holding.
      csSend(tabId, { type: MSG.CS_CAPTURE, mode: "cancel" }).catch(() => {});
      resolve({ timedOut: true });
    }, ms);
  });
  const reply = await Promise.race([send, timeout]);
  clearTimeout(timer);
  return reply;
}

// The capture arrives as a data URL, so the bytes are decoded before any gate reads them.
async function decodeDataUrl(dataUrl) {
  const bin = atob(String(dataUrl).split(",")[1] || "");
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return createImageBitmap(new Blob([bytes], { type: "image/png" }));
}

// The crop fills a canvas of the target size, so the shot is the box at the long-edge cap, and the
// bitmap is released as soon as its pixels are out of the drawing.
async function drawCrop(bitmap, crop, size) {
  const canvas = new OffscreenCanvas(size.width, size.height);
  const ctx = canvas.getContext("2d");
  ctx.scale(size.width / crop.w, size.height / crop.h);
  ctx.drawImage(bitmap, -crop.x, -crop.y);
  bitmap.close();
  const blob = await canvas.convertToBlob({ type: "image/png" });
  return toBase64(new Uint8Array(await blob.arrayBuffer()));
}

// The shot waits here: the panel may be closed when a capture runs, and this key is the one
// place it drains from. A shot over the composer's cap replaces the oldest, so the parked key
// is never longer than what the panel can take, by the same rule the appends use.
let shotFullWarned = false;
async function parkShot(shot, emit) {
  const raw = await chrome.storage.session.get(SESSION_PENDING_SHOT_KEY);
  const list = Array.isArray(raw[SESSION_PENDING_SHOT_KEY]) ? raw[SESSION_PENDING_SHOT_KEY] : [];
  const bounded = roomFor(list.length) ? [...list, shot] : [...list, shot].slice(-MAX_IMAGES);
  try {
    await chrome.storage.session.set({ [SESSION_PENDING_SHOT_KEY]: bounded });
    return true;
  } catch {
    if (!shotFullWarned) {
      shotFullWarned = true;
      emit({ kind: "warning", text: SHOT_FULL_WARNING });
    }
    return false;
  }
}

/** One capture from one mode. Returns the words the panel shows; nothing is sent to the model.
 *  `ms` is how long the pick waits, at the rule's default. */
export async function captureFromMode(tabId, mode, emit = () => {}, ms = PICK_TIMEOUT_MS) {
  if (tabId == null || !CAPTURE_MODES.includes(mode)) return CAPTURE_NOTES.nothing;
  const reply = await pickReply(tabId, mode, ms);
  const refusal = replyNote(reply);
  if (refusal) return refusal;
  // The floor is the cheapest gate, so a box that can never be a shot is refused before a
  // single pixel is taken.
  if (mode === "region" && !regionAllowed(reply.rect.w, reply.rect.h).ok) return CAPTURE_NOTES.tiny;
  // The right-click shot is the box the climb chose, not the leaf the page recorded.
  const box = mode === "rightclick" ? resolveElementBox(reply.rects) : reply.rect;
  if (!box) return CAPTURE_NOTES.nothing;
  const extra = reply.frame ? CAPTURE_NOTES.frame : null;
  let bitmap;
  try {
    const tab = await chrome.tabs.get(tabId);
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    bitmap = await decodeDataUrl(dataUrl);
    // The area gate reads the decoded bitmap, so an over-cap source is refused before any
    // canvas exists.
    const area = sourceAllowed(bitmap.width, bitmap.height);
    if (!area.ok) return ATTACH_NOTES[area.reason];
    const crop = cropRect(box, bitmap.width, bitmap.height);
    if (!crop.visible) return CAPTURE_NOTES.outside;
    const data = await drawCrop(bitmap, crop, targetSize(crop.w, crop.h));
    // The same base64 cap the composer and the tool path apply, so one rule refuses in one place.
    const a = acceptImage({ mediaType: "image/png", data });
    if (!a.ok) return ATTACH_NOTES[a.reason];
    const label = shotLabel(mode, mode === "rightclick" ? box.tag : reply.name, box.w, box.h);
    // The shot is parked with the origin of the page it is a picture of, never the page's
    // address: the address of a bank page is itself the private thing, and the history scan needs
    // the site only. A frame in the page is a second site, read from the frame's own element.
    const shot = { mediaType: a.mediaType, data, label, origin: originOf(tab.url), frameOrigin: reply.frameOrigin };
    // A shot that cannot be parked is gone, so the words the user reads name the drop: "Captured"
    // over a shot nobody can send announces a capture that never landed.
    if (!(await parkShot(shot, emit))) return SHOT_FULL_WARNING;
    // One note per capture: the words that name what happened come before the words that name
    // the box, so the user reads one line. A visible-area shot is the shot the user asked for,
    // so a capture shorter than the viewport says nothing about a clip.
    const lead = mode === "visible" ? extra : crop.clipped ? CAPTURE_NOTES.clipped : extra;
    return lead ? `${lead} ${label}` : `Captured ${label}`;
  } catch {
    // A tab gone, a capture Chrome refuses, a decode that fails: the note a restricted page
    // gets, and nothing thrown reaches the panel.
    return CAPTURE_NOTES.restricted;
  } finally {
    if (bitmap) bitmap.close();
  }
}
