// Composer attachments: the rules for an image the user pastes, drops, or picks.
// No chrome.*, no DOM; the panel applies these and the worker re-checks them,
// because the panel is not the trust boundary.

// Images only, deliberately: text has a native path (the textarea takes a paste,
// and the paste handler only intercepts files) while pixels have none; providers
// are protocol-agnostic for images only (Anthropic has a document block, OpenAI's
// /chat/completions has no file part, so text files are Anthropic-only code);
// geometry bounds an image, a 5 MB text file is ~1.2M tokens in one message; the
// agent's world is the tab, not the disk; and text files carry secrets (.env, keys,
// token-bearing logs) far more often than screenshots.

// The four formats both providers read: OpenAI accepts PNG, JPEG, WebP and
// non-animated GIF; Claude accepts JPEG, PNG, GIF and WebP.
export const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

// Raw file, gated before any decode. 5 MB is past what Amazon Bedrock and Google
// Cloud allow per image, so a bigger file is not worth decoding at all.
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

// After encoding: the provider's documented 5 MB per-image base64 limit, inside
// Chrome's 64 MiB message limit, so panel, tool path and worker refuse the same.
export const MAX_BASE64_CHARS = 5 * 1024 * 1024;

// createImageBitmap decodes the source, so the pixels do reach memory; this cap
// stops a 60 MP phone JPEG (~160 MB RGBA) becoming a re-encoded canvas, checked
// before any canvas is made.
export const MAX_SOURCE_PIXELS = 40 * 1000 * 1000;

// Anthropic's standard-tier long-edge limit: 1568 px costs ~1568 visual tokens,
// and stays under the 2000px per-image limit that applies past 20 images.
export const MAX_LONG_EDGE = 1568;

// Per message. Each image costs ~1300-1600 tokens, so four is already a
// sizeable slice of a 128k window.
export const MAX_IMAGES = 4;

// The count rule for an append, so the paste gate, the strip, the drain and the parked key
// all refuse a fifth image by one rule, and the cap cannot drift between them.
/** room for one more image in a list that holds `count`. */
export function roomFor(count) {
  return count < MAX_IMAGES;
}

export const ATTACH_NOTES = {
  type: "Not an image — PNG, JPEG, WebP or GIF only.",
  size: "Image too large — over 5 MB. Resize it and try again.",
  count: `Up to ${MAX_IMAGES} images per message.`,
  // A file kept as its own bytes and a re-encoded canvas hit this cap the same
  // way, so the note never blames a resize that never happened.
  base64: "Image too large to send — over 5 MB. Try a smaller one.",
  area: "Image is over 40 megapixels — too large to open. Try a smaller one.",
};

/** The media type as the provider must be told it: lowercase. */
export function canonicalType(type) {
  return String(type || "").toLowerCase();
}

// file.type is a label the OS puts on a file and a rename breaks it: telling the
// provider image/png for a bytes-wise JPEG asks it to read a PNG that is not
// there. The signature is the type.
const SIGNATURES = [
  ["image/png", (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a],
  ["image/jpeg", (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ["image/gif", (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38],
  // RIFF at 0 and WEBP at 8: a RIFF container is WAV, AVI and AVIF as well, so
  // the second half of the header is what makes it a WebP.
  ["image/webp", (b) => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50],
];

/** The canonical media type of one of the four formats, by signature, or null.
 *  Out-of-range indexes read as undefined, so a stub is refused, not thrown. */
export function sniffImageType(bytes) {
  if (!bytes) return null;
  for (const [type, isIt] of SIGNATURES) {
    if (isIt(bytes)) return type;
  }
  return null;
}

// An image with no words is still a task: Anthropic rejects an empty text block.
// One shared line keeps the panel's bubble and the provider's request agreeing.
export const IMAGE_ONLY_TASK = "Describe what you see in the attached image.";

/** The typed text trimmed; the fixed line when there are only images; "" when there is nothing to send. */
export function taskFor(text, images) {
  const typed = String(text ?? "").trim();
  if (typed) return typed;
  return images && images.length ? IMAGE_ONLY_TASK : "";
}

/** The area gate on the decoded bitmap: { ok } or { ok: false, reason: "area" }. */
export function sourceAllowed(width, height) {
  const area = Number(width) * Number(height);
  if (!Number.isFinite(area) || area > MAX_SOURCE_PIXELS) return { ok: false, reason: "area" };
  return { ok: true };
}

/** `file` is { type, size }; { ok } or { ok: false, reason }. The label is the
 * panel's first gate; the signature check and acceptImage gate what the file is. */
export function classifyFile(file, count) {
  const type = canonicalType(file && file.type);
  if (!IMAGE_TYPES.has(type)) return { ok: false, reason: "type" };
  if (Number(file.size) > MAX_FILE_BYTES) return { ok: false, reason: "size" };
  if (!roomFor(count)) return { ok: false, reason: "count" };
  return { ok: true };
}

/** Scale down to MAX_LONG_EDGE when over, never up; ratio kept, integer pixels. */
export function targetSize(width, height) {
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  if (w <= MAX_LONG_EDGE && h <= MAX_LONG_EDGE) return { width: w, height: h };
  const k = MAX_LONG_EDGE / Math.max(w, h);
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}

/** { mediaType, data } in; { ok, mediaType } or { ok: false, reason } out. Success
 * carries the canonical type, so panel, worker and wire carry one value, and a
 * caller that declares its own type gets the type the wire will carry. */
export function acceptImage(image) {
  if (!image || typeof image.data !== "string" || !image.data) return { ok: false, reason: "base64" };
  const type = canonicalType(image.mediaType);
  if (!IMAGE_TYPES.has(type)) return { ok: false, reason: "type" };
  if (image.data.length > MAX_BASE64_CHARS) return { ok: false, reason: "base64" };
  return { ok: true, mediaType: type };
}

/** The worker's check of a whole attachment list: { ok } or { ok: false, reason },
 * the reason keys ATTACH_NOTES. */
export function validateImages(images) {
  if (!Array.isArray(images)) return { ok: false, reason: "type" };
  if (images.length > MAX_IMAGES) return { ok: false, reason: "count" };
  for (const img of images) {
    const r = acceptImage(img);
    if (!r.ok) return r;
  }
  return { ok: true };
}
