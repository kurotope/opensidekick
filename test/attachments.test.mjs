// Composer attachment rules: the caps and the pure decisions, no DOM.
import {
  IMAGE_TYPES,
  MAX_FILE_BYTES,
  MAX_BASE64_CHARS,
  MAX_LONG_EDGE,
  MAX_IMAGES,
  IMAGE_ONLY_TASK,
  ATTACH_NOTES,
  classifyFile,
  targetSize,
  acceptImage,
  validateImages,
  sniffImageType,
  taskFor,
  sourceAllowed,
} from "../src/common/attachments.js";

let fail = 0;
const ok = (c, m) => { console.log((c ? "ok  : " : "FAIL: ") + m); if (!c) fail = 1; };

// --- accepted types -----------------------------------------------------------

ok(IMAGE_TYPES.has("image/png") && IMAGE_TYPES.has("image/jpeg") && IMAGE_TYPES.has("image/webp") && IMAGE_TYPES.has("image/gif"), "the four formats both providers read are accepted");
ok(!IMAGE_TYPES.has("image/svg+xml"), "SVG is not accepted (it is a document, not a picture)");
ok(!IMAGE_TYPES.has("image/bmp") && !IMAGE_TYPES.has("image/avif"), "BMP and AVIF are not accepted");

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

// --- targetSize ---------------------------------------------------------------

ok(targetSize(800, 600).width === 800 && targetSize(800, 600).height === 600, "an image under the limit is kept whole, and never upscaled");
ok(targetSize(1920, 1080).width === MAX_LONG_EDGE && targetSize(1920, 1080).height === 882, "1920x1080 scales to 1568x882");
ok(targetSize(4096, 512).width === MAX_LONG_EDGE && targetSize(4096, 512).height === 196, "a wide strip scales on its long edge only");
ok(targetSize(100, 4000).height === MAX_LONG_EDGE && targetSize(100, 4000).width === 39, "a tall strip scales on its long edge only");
ok(Number.isInteger(targetSize(1919, 1079).width), "the scaled dimensions are whole pixels");

// --- acceptImage ------------------------------------------------------------

const img = { mediaType: "image/png", data: "abc" };
ok(acceptImage({ mediaType: "image/png", data: "abc" }).ok, "a small encoded image is accepted");
ok(acceptImage({ mediaType: "IMAGE/PNG", data: "abc" }).mediaType === "image/png",
  "acceptImage hands back the canonical lowercase type, so the wire never sees a mixed-case MIME");
ok(acceptImage({ mediaType: "image/png", data: "x".repeat(MAX_BASE64_CHARS + 1) }).reason === "base64", "an encoded image over the base64 cap is refused");
ok(acceptImage({ mediaType: "image/png", data: "x".repeat(MAX_BASE64_CHARS) }).ok, "exactly at the base64 cap is accepted");
ok(acceptImage({ mediaType: "image/bmp", data: "abc" }).reason === "type", "an encoded image of an unsupported type is refused");
ok(acceptImage(null).reason === "base64", "a missing image is refused, not thrown on");

// --- validateImages -----------------------------------------------------------

ok(validateImages([]).ok, "an empty list is valid");
ok(validateImages([img, img, img, img]).ok, "the full allowance is valid");
ok(validateImages([img, img, img, img, img]).reason === "count", "one image over the allowance is invalid");
ok(validateImages("not a list").reason === "type", "a non-list is refused, not thrown on");

// --- sniffImageType ----------------------------------------------------------

const u8 = (arr) => new Uint8Array(arr);
const PNG_BYTES = u8([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG_BYTES = u8([0xff, 0xd8, 0xff, 0xe1, 0, 0x10, 0x45, 0x78, 0x69, 0x66, 0, 1]);
const GIF_BYTES = u8([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x0a, 0, 0, 0, 0, 0]);
const WEBP_BYTES = u8([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);

ok(sniffImageType(PNG_BYTES) === "image/png", "PNG's 8-byte signature sniffs as image/png");
ok(sniffImageType(JPEG_BYTES) === "image/jpeg", "FF D8 FF sniffs as image/jpeg");
ok(sniffImageType(GIF_BYTES) === "image/gif", "GIF8 sniffs as image/gif");
ok(sniffImageType(WEBP_BYTES) === "image/webp", "RIFF then WEBP at offset 8 sniffs as image/webp");
// A file named photo.png that is bytes-wise a JPEG has to reach the provider as
// image/jpeg: the signature is the type, not the label the OS gave the file.
ok(sniffImageType(JPEG_BYTES) === "image/jpeg", "the bytes decide the type, not the declared file.type");
ok(sniffImageType(u8(new TextEncoder().encode("hello world!"))) === null, "plain text is not one of the four formats");
ok(sniffImageType(u8([0x42, 0x4d])) === null, "a 2-byte stub is refused, not thrown on");
ok(sniffImageType(u8([0xff, 0xd8])) === null, "a truncated JPEG signature is refused");
ok(sniffImageType(null) === null, "no bytes are refused");
ok(sniffImageType(u8([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x41, 0x56, 0x49, 0x46])) === null, "a RIFF container that is not WEBP (AVIF) is refused");

// --- taskFor ----------------------------------------------------------------

ok(taskFor("  summarize this  ", []) === "summarize this", "taskFor returns the trimmed text");
ok(taskFor("", [img]) === IMAGE_ONLY_TASK, "an image with no words gets the fixed task line");
ok(taskFor(null, [img]) === IMAGE_ONLY_TASK, "a missing task with an image gets the fixed line");
ok(taskFor("", []) === "", "no text and no image is an empty task, not the fixed line");
ok(taskFor(null, null) === "", "nothing at all is an empty task");
ok(IMAGE_ONLY_TASK.includes("image"), "the fixed line names what the model should do with the image");

// --- sourceAllowed -----------------------------------------------------------

ok(sourceAllowed(1568, 1568).ok, "a 2.4 megapixel source is allowed to decode");
ok(sourceAllowed(8000, 5000).ok, "exactly 40 megapixels is allowed");
ok(sourceAllowed(6000, 7000).reason === "area", "42 megapixels is refused before any canvas work");
ok(ATTACH_NOTES[sourceAllowed(6000, 7000).reason] && ATTACH_NOTES[sourceAllowed(6000, 7000).reason].includes("40"),
  "the area refusal has a note the user can read that names the limit");
ok(sourceAllowed("no", 10).reason === "area", "a junk source size is refused, not thrown on");

// --- notes ------------------------------------------------------------------

ok(ATTACH_NOTES.type && ATTACH_NOTES.size && ATTACH_NOTES.count && ATTACH_NOTES.base64 && ATTACH_NOTES.area,
  "every refusal reason has a note to show the user");
ok(!/resiz/i.test(ATTACH_NOTES.base64), "the base64 note is true for a file that was never resized");
ok(ATTACH_NOTES.base64.includes("5 MB"), "the base64 note names the real limit");

console.log(fail ? "\nSOME ATTACHMENT TESTS FAILED" : "\nALL ATTACHMENT TESTS PASSED");
process.exit(fail);
