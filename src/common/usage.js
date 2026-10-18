// Token accounting for a chat: the one shape counts are kept in, and the two
// readings the UI shows. No chrome.* APIs here, so all of it is unit-tested in
// Node — the percentage rules are the kind of thing a browser test is bad at
// and a node check is good at.

/**
 * Token counts a chat has used, in one shape: { input, output, cached, write }
 * or null. Storage hands back anything, so junk counts are dropped rather than
 * shown: a number that is not a non-negative integer is not a token count.
 *
 * `input` is what the model processed, so cache reads and writes count into it.
 * `cached` is the slice the server read from its own cache, `write` the slice
 * it wrote into the cache; the two are disjoint parts of input, so each is
 * clamped to what is left. A server that reports no cache data leaves the field
 * out, which is how the UI tells "no cache data" from "cache hit 0%".
 */
export function cleanUsage(u) {
  if (!u || typeof u !== "object") return null;
  const n = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);
  const input = n(u.input);
  const output = n(u.output);
  if (!input && !output) return null;
  const cached = Math.min(n(u.cached), input);
  const write = Math.min(n(u.write), input - cached);
  const out = { input, output };
  if (cached) out.cached = cached;
  if (write) out.write = write;
  return out;
}

/** Input tokens the server did not read from, or write into, its own cache. */
export function uncachedInput(u) {
  return u.input - (u.cached || 0) - (u.write || 0);
}

/**
 * Cache reads as a share of the prompt, as text, or null when the server
 * reported no cache data: a server that never reports it reads 0%, which is the
 * app's silence, not the user's behaviour, so the UI says nothing about cache.
 *
 * A partial hit is never rounded up to 100%. 100% is printed only when every
 * prompt token was read from the cache; a 99.96% hit gets the decimals it needs
 * to stay honest, because a meter that says 100% when the user paid for
 * uncached tokens is the same class of lie as a cache hit of 0%.
 */
export function cacheHitText(u) {
  if (!u || !u.cached || !u.input) return null;
  if (u.cached >= u.input) return "100";
  // Percentage units at d decimals, rounded half up, until a decimal is needed
  // to keep the answer below 100.
  for (let d = 0; d <= 6; d++) {
    const f = 10 ** d;
    const units = Math.round((u.cached * 100 * f) / u.input);
    if (units < 100 * f) {
      const text = (units / f).toFixed(d);
      return d === 0 ? text : text.replace(/\.?0+$/, "");
    }
  }
  return "99.999999";
}
