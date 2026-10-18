// The pure token accounting module: what counts as a token count, and the two
// readings the UI shows. The percentage rules are the point of this file — a
// browser test is bad at checking that a meter never rounds a partial hit to
// 100%, and a node check is good at it.

import { cleanUsage, cacheHitText, uncachedInput } from "../src/common/usage.js";

let fail = 0;
const ok = (c, m) => { console.log((c ? "ok  : " : "FAIL: ") + m); if (!c) fail = 1; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- cleanUsage: what counts as a token count ----
ok(same(cleanUsage({ input: 120, output: 34 }), { input: 120, output: 34 }), "cleanUsage: good shape kept");
ok(cleanUsage({ input: 0, output: 0 }) === null, "cleanUsage: zeros are no counts");
ok(cleanUsage(null) === null, "cleanUsage: null in, null out");
ok(cleanUsage("1200 tok") === null, "cleanUsage: a string is not counts");
ok(same(cleanUsage({ input: 120, output: -5 }), { input: 120, output: 0 }), "cleanUsage: negative dropped to 0");
ok(same(cleanUsage({ input: 120.5, output: 34 }), { input: 0, output: 34 }), "cleanUsage: non-integer dropped to 0");
ok(same(cleanUsage({ input: 500, output: 0 }), { input: 500, output: 0 }), "cleanUsage: output-only counts kept");

// ---- cached / write: the cache slices of input ----
ok(same(cleanUsage({ input: 1000, output: 20, cached: 900 }), { input: 1000, output: 20, cached: 900 }), "cleanUsage: cached slice kept");
ok(same(cleanUsage({ input: 100, output: 5, cached: 400 }), { input: 100, output: 5, cached: 100 }), "cleanUsage: cached clamped to input");
ok(same(cleanUsage({ input: 100, output: 5, cached: 0 }), { input: 100, output: 5 }), "cleanUsage: zero cached leaves the field out (no cache data, not 0%)");
ok(same(cleanUsage({ input: 100, output: 5, cached: "many" }), { input: 100, output: 5 }), "cleanUsage: junk cached dropped");
ok(same(cleanUsage({ input: 100, output: 5, cached: -3 }), { input: 100, output: 5 }), "cleanUsage: negative cached dropped");
ok(same(cleanUsage({ input: 1000, output: 20, cached: 800, write: 100 }), { input: 1000, output: 20, cached: 800, write: 100 }), "cleanUsage: write slice kept");
ok(same(cleanUsage({ input: 100, output: 5, cached: 80, write: 50 }), { input: 100, output: 5, cached: 80, write: 20 }), "cleanUsage: write clamped to the input cached leaves");
ok(same(cleanUsage({ input: 100, output: 5, write: 0 }), { input: 100, output: 5 }), "cleanUsage: zero write leaves the field out");
ok(same(cleanUsage({ input: 100, output: 5, write: "many" }), { input: 100, output: 5 }), "cleanUsage: junk write dropped");

// ---- uncachedInput: what the server had to compute ----
ok(uncachedInput({ input: 1000, cached: 800, write: 100 }) === 100, "uncachedInput: reads and writes both subtracted");
ok(uncachedInput({ input: 1000, cached: 400 }) === 600, "uncachedInput: no write bucket");
ok(uncachedInput({ input: 1000 }) === 1000, "uncachedInput: no cache data means all input is uncached");

// ---- cacheHitText: the share the user reads ----
ok(cacheHitText({ input: 1000, output: 20 }) === null, "cacheHitText: no cache data says nothing");
ok(cacheHitText({ input: 1000, output: 20, cached: 0 }) === null, "cacheHitText: zero cached says nothing, not 0%");
ok(cacheHitText({ input: 0, output: 0, cached: 0 }) === null, "cacheHitText: no prompt means no share");
ok(cacheHitText({ input: 1000, output: 20, cached: 1000 }) === "100", "cacheHitText: every token cached is 100%");
ok(cacheHitText({ input: 1200, output: 45, cached: 1000 }) === "83", "cacheHitText: 1000 of 1200 rounds to 83%");
ok(cacheHitText({ input: 3, output: 1, cached: 1 }) === "33", "cacheHitText: small counts round down");
ok(cacheHitText({ input: 10000, output: 20, cached: 9995 }) === "99.95", "cacheHitText: a partial hit is not rounded up to 100%");
ok(cacheHitText({ input: 10000, output: 20, cached: 9990 }) === "99.9", "cacheHitText: one decimal is enough when it keeps the answer below 100");
ok(cacheHitText({ input: 1000000, output: 20, cached: 999999 }) === "99.9999", "cacheHitText: 99.9999% stays 99.9999, not 100");
ok(cacheHitText({ input: 100000000, output: 20, cached: 99999999 }) === "99.999999", "cacheHitText: the honest floor for a near-perfect hit");

console.log(fail ? "\nSOME ACCOUNTING CHECKS FAILED" : "\nALL ACCOUNTING CHECKS PASSED");
process.exitCode = fail;
