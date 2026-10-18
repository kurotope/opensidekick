// Composer attachment rules: the caps and the pure decisions, no DOM.
import {
  IMAGE_TYPES,
  MAX_FILE_BYTES,
  MAX_BASE64_CHARS,
  MAX_LONG_EDGE,
  MAX_IMAGES,
  ATTACH_NOTES,
  classifyFile,
  targetSize,
  acceptImage,
  validateImages,
} from "../src/common/attachments.js";

let fail = 0;
const ok = (c, m) => { console.log((c ? "ok  : " : "FAIL: ") + m); if (!c) fail = 1; };

// --- accepted types -----------------------------------------------------------

ok(IMAGE_TYPES.has("image/png") && IMAGE_TYPES.has("image/jpeg") && IMAGE_TYPES.has("image/webp") && IMAGE_TYPES.has("image/gif"), "the four formats both providers read are accepted");
ok(!IMAGE_TYPES.has("image/svg+xml"), "SVG is not accepted (it is a document, not a picture)");
ok(!IMAGE_TYPES.has("image/bmp") && !IMAGE_TYPES.has("image/avif"), "BMP and AVIF are not accepted");
ok(!IMAGE_TYPES.has("application/pdf"), "PDF is not accepted");

// --- classifyFile -------------------------------------------------------------

const png = { type: "image/png", size: 1000 };
ok(classifyFile(png, 0).ok, "a small PNG at index 0 is accepted");
ok(classifyFile({ type: "IMAGE/PNG", size: 1000 }, 0).ok, "type is matched case-insensitively");
ok(classifyFile({ type: "application/pdf", size: 1000 }, 0).reason === "type", "a PDF is refused with the type reason");
ok(classifyFile({ type: "", size: 1000 }, 0).reason === "type", "a file with no type is refused");
ok(classifyFile({ type: "image/png", size: MAX_FILE_BYTES + 1 }, 0).reason === "size", "a file over the raw cap is refused with the size reason");
ok(classifyFile({ type: "image/png", size: MAX_FILE_BYTES }, 0).ok, "a file exactly at the raw cap is accepted");
ok(classifyFile(png, MAX_IMAGES).reason === "count", "the image after the cap is refused with the count reason");
ok(classifyFile(png, MAX_IMAGES - 1).ok, "the last allowed image is accepted");
ok(classifyFile(null, 0).reason === "type", "a missing file is refused, not thrown on");

// --- targetSize ---------------------------------------------------------------

ok(targetSize(800, 600).width === 800 && targetSize(800, 600).height === 600, "an image under the limit is not resized");
ok(targetSize(1920, 1080).width === MAX_LONG_EDGE && targetSize(1920, 1080).height === 882, "1920x1080 scales to 1568x882");
ok(targetSize(4096, 512).width === MAX_LONG_EDGE && targetSize(4096, 512).height === 196, "a wide strip scales on its long edge only");
ok(targetSize(100, 4000).height === MAX_LONG_EDGE && targetSize(100, 4000).width === 39, "a tall strip scales on its long edge only");
ok(targetSize(1568, 1568).width === 1568, "exactly at the limit is left alone");
ok(targetSize(3000, 3000).width === 1568 && targetSize(3000, 3000).height === 1568, "a square scales to the limit");
const up = targetSize(10, 20);
ok(up.width === 10 && up.height === 20, "a tiny image is never upscaled");
ok(Number.isInteger(targetSize(1919, 1079).width), "the scaled dimensions are whole pixels");

// --- acceptImage ------------------------------------------------------------

ok(acceptImage({ mediaType: "image/png", data: "abc" }).ok, "a small encoded image is accepted");
ok(acceptImage({ mediaType: "image/png", data: "x".repeat(MAX_BASE64_CHARS + 1) }).reason === "base64", "an encoded image over the base64 cap is refused");
ok(acceptImage({ mediaType: "image/png", data: "x".repeat(MAX_BASE64_CHARS) }).ok, "exactly at the base64 cap is accepted");
ok(acceptImage({ mediaType: "image/bmp", data: "abc" }).reason === "type", "an encoded image of an unsupported type is refused");
ok(acceptImage({ mediaType: "image/png", data: "" }).reason === "base64", "an empty payload is refused");
ok(acceptImage(null).reason === "base64", "a missing image is refused, not thrown on");

// --- validateImages -----------------------------------------------------------

const img = { mediaType: "image/png", data: "abc" };
ok(validateImages([]).ok, "an empty list is valid");
ok(validateImages([img, img, img, img]).ok, "the full allowance is valid");
ok(validateImages([img, img, img, img, img]).reason === "count", "one image over the allowance is invalid");
ok(validateImages([img, { mediaType: "image/bmp", data: "abc" }]).reason === "type", "one bad image makes the list invalid");
ok(validateImages([img, { mediaType: "image/png", data: "x".repeat(MAX_BASE64_CHARS + 1) }]).reason === "base64", "one oversized image makes the list invalid");
ok(validateImages("not a list").reason === "type", "a non-list is refused, not thrown on");

// --- notes ------------------------------------------------------------------

ok(ATTACH_NOTES.type && ATTACH_NOTES.size && ATTACH_NOTES.count && ATTACH_NOTES.base64, "every refusal reason has a note to show the user");
ok(ATTACH_NOTES.count.includes(String(MAX_IMAGES)), "the count note names the real allowance");

console.log(fail ? "\nSOME ATTACHMENT TESTS FAILED" : "\nALL ATTACHMENT TESTS PASSED");
process.exit(fail);
