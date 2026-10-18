// Composer attachments: the rules for an image the user pastes, drops, or picks.
// Pure (no chrome.*, no DOM), so it is unit-tested under plain node. The panel
// applies these before sending and the worker re-checks them, because the panel
// is not the trust boundary.

// Images only, deliberately. Text has a native path — the composer textarea
// takes a paste, and the paste handler only intercepts when the clipboard
// carries files — and pixels have none, so a picker for .txt is a second door
// to a room you can walk into. Three more reasons: providers are protocol-
// agnostic for images only (Anthropic has a document block, OpenAI's
// /chat/completions has no file part, so text files are Anthropic-only code);
// images are bounded by geometry and text is not, so a 5 MB text file is
// ~1.2M tokens in one message — past any window, the same reason agent.js
// truncates tool results to 12,000 chars; and the agent's world is the tab, not
// the disk (no fileAccess in manifest.json, so get_page_text cannot read a
// file:// tab, and an attached file is a blob the model can never re-read).
// Text files also carry secrets — .env, keys, token-bearing logs — far more
// often than screenshots.

// The four formats both providers read: OpenAI accepts PNG, JPEG, WebP and
// non-animated GIF; Claude accepts JPEG, PNG, GIF and WebP.
export const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

// Raw file, checked before any decode. 5 MB is already past what Amazon Bedrock
// and Google Cloud allow per image (5 MB base64), so a bigger file is not worth
// decoding at all.
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

// After downscaling. Chosen to stay under Anthropic's 5 MB per-image limit on
// partner platforms and well inside Chrome's 64 MiB runtime-message limit.
export const MAX_BASE64_CHARS = 4_000_000;

// Anthropic's standard-tier long-edge limit: a 1568px image costs ~1568 visual
// tokens, the cheapest full-fidelity read, and stays under the 2000px per-image
// limit that applies to every image once a request carries more than 20.
export const MAX_LONG_EDGE = 1568;

// Per message. Each image costs ~1300-1600 tokens, so four is already a
// sizeable slice of a 128k window.
export const MAX_IMAGES = 4;

export const ATTACH_NOTES = {
  type: "Not an image — PNG, JPEG, WebP or GIF only.",
  size: "Image too large — over 5 MB. Resize it and try again.",
  count: `Up to ${MAX_IMAGES} images per message.`,
  base64: "Image too large after resizing. Try a smaller one.",
};

/**
 * May this file be attached, given how many are already pending? `file` is
 * { type, size }; returns { ok } or { ok: false, reason }.
 */
export function classifyFile(file, count) {
  const type = String((file && file.type) || "").toLowerCase();
  if (!IMAGE_TYPES.has(type)) return { ok: false, reason: "type" };
  if (Number(file.size) > MAX_FILE_BYTES) return { ok: false, reason: "size" };
  if (count >= MAX_IMAGES) return { ok: false, reason: "count" };
  return { ok: true };
}

/**
 * The dimensions to encode at: scaled down to MAX_LONG_EDGE when over, never
 * up, aspect ratio kept, integer pixels.
 */
export function targetSize(width, height) {
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  if (w <= MAX_LONG_EDGE && h <= MAX_LONG_EDGE) return { width: w, height: h };
  const k = MAX_LONG_EDGE / Math.max(w, h);
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}

/** Is one encoded image usable? { mediaType, data } in, { ok, reason } out. */
export function acceptImage(image) {
  if (!image || typeof image.data !== "string" || !image.data) return { ok: false, reason: "base64" };
  if (!IMAGE_TYPES.has(String(image.mediaType || "").toLowerCase())) return { ok: false, reason: "type" };
  if (image.data.length > MAX_BASE64_CHARS) return { ok: false, reason: "base64" };
  return { ok: true };
}

/**
 * The worker's check of a whole attachment list. Returns { ok } or
 * { ok: false, reason }; the reason keys ATTACH_NOTES.
 */
export function validateImages(images) {
  if (!Array.isArray(images)) return { ok: false, reason: "type" };
  if (images.length > MAX_IMAGES) return { ok: false, reason: "count" };
  for (const img of images) {
    const r = acceptImage(img);
    if (!r.ok) return r;
  }
  return { ok: true };
}
