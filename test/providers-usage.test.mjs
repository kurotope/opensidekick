// Token counts come back in the stream, and the provider layer has to read them
// out of three different shapes: OpenAI's usage chunk, Ollama's field names,
// Anthropic's split across message_start and message_delta. Mock servers say it
// each way, and the normalized result is checked.

import http from "node:http";
import { callModel } from "../src/background/providers.js";

let fail = 0;
const ok = (c, m) => {
  console.log((c ? "ok  : " : "FAIL: ") + m);
  if (!c) fail = 1;
};
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m);

function sse(res, chunks) {
  res.writeHead(200, { "content-type": "text/event-stream" });
  for (const c of chunks) res.write("data: " + JSON.stringify(c) + "\n\n");
  res.write("data: [DONE]\n\n");
  res.end();
}

// A server that answers with fixed chunks, recording each request body.
const servers = [];
function serve(chunksFor) {
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const o = JSON.parse(body || "{}");
      server.bodies.push(o);
      chunksFor(o, res, server.bodies.length);
    });
  });
  server.bodies = [];
  servers.push(server);
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r(server)));
}
const openaiFor = (s) => ({ type: "openai", baseUrl: `http://127.0.0.1:${s.address().port}/v1`, apiKey: "k" });
const anthropicFor = (s) => ({ type: "anthropic", baseUrl: `http://127.0.0.1:${s.address().port}/v1`, apiKey: "k" });

const say = (text) => [
  { choices: [{ delta: { content: text } }] },
  { choices: [{ finish_reason: "stop" }] },
];

// ---- OpenAI: the usage chunk carries no choices, so it sits after the last one ----
const openai = await serve((o, res) =>
  sse(res, [...say("hello"), { usage: { prompt_tokens: 120, completion_tokens: 34 } }]),
);
const r1 = await callModel(openaiFor(openai), { model: "m", messages: [{ role: "user", content: "hi" }] });
eq(r1.usage, { input: 120, output: 34, cached: 0 }, "openai: prompt/completion tokens normalized");
eq(r1.content, "hello", "openai: text still streamed");
eq(openai.bodies[0].stream_options, { include_usage: true }, "openai: usage asked for in the request");

// ---- Ollama's OpenAI-compatible endpoint names the fields differently ----
const ollama = await serve((o, res) =>
  sse(res, [...say("local"), { usage: { prompt_eval_count: 800, eval_count: 40 } }]),
);
const r2 = await callModel(openaiFor(ollama), { model: "qwen3-vl:8b-instruct", messages: [{ role: "user", content: "hi" }] });
eq(r2.usage, { input: 800, output: 40, cached: 0 }, "ollama: eval-count fields normalized to input/output");

// ---- Anthropic: input in message_start, output cumulative in message_delta ----
const anthropic = await serve((o, res) =>
  sse(res, [
    { type: "message_start", message: { usage: { input_tokens: 1000, cache_read_input_tokens: 5000, cache_creation_input_tokens: 200 } } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "claude" } },
    { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 10 } },
    { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 150 } },
    { type: "message_stop" },
  ]),
);
const r3 = await callModel(anthropicFor(anthropic), { model: "claude", maxTokens: 100, messages: [{ role: "user", content: "hi" }] });
eq(r3.usage, { input: 6200, output: 150, cached: 5000 }, "anthropic: cache reads fold into input and are kept as the cached slice, output takes the cumulative total");
eq(r3.content, "claude", "anthropic: text still streamed");

// ---- Cache reads: three names for the same slice of input ----
const cachedSrv = await serve((o, res) =>
  sse(res, [...say("cached"), { usage: { prompt_tokens: 1000, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 900, cache_write_tokens: 40 } } }]),
);
const r7 = await callModel(openaiFor(cachedSrv), { model: "m", messages: [{ role: "user", content: "hi" }] });
eq(r7.usage, { input: 1000, output: 20, cached: 900 }, "openai: cached_tokens read out of prompt_tokens_details");

// DeepSeek and Groq put the hit count at the top level of usage.
const hitSrv = await serve((o, res) =>
  sse(res, [...say("hit"), { usage: { prompt_tokens: 600, completion_tokens: 12, prompt_cache_hit_tokens: 512, prompt_cache_miss_tokens: 88 } }]),
);
const r8 = await callModel(openaiFor(hitSrv), { model: "m", messages: [{ role: "user", content: "hi" }] });
eq(r8.usage, { input: 600, output: 12, cached: 512 }, "top-level prompt_cache_hit_tokens read (DeepSeek/Groq shape)");

// Kimi documents the hit count as a top-level cached_tokens on the final chunk.
const kimiSrv = await serve((o, res) =>
  sse(res, [...say("kimi"), { usage: { prompt_tokens: 800, completion_tokens: 30, cached_tokens: 640 } }]),
);
const r8b = await callModel(openaiFor(kimiSrv), { model: "m", messages: [{ role: "user", content: "hi" }] });
eq(r8b.usage, { input: 800, output: 30, cached: 640 }, "top-level cached_tokens read (Kimi shape)");

// A server claiming more cached than input: a slice can't exceed the whole.
const overSrv = await serve((o, res) =>
  sse(res, [...say("over"), { usage: { prompt_tokens: 100, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 400 } } }]),
);
const r9 = await callModel(openaiFor(overSrv), { model: "m", messages: [{ role: "user", content: "hi" }] });
eq(r9.usage, { input: 100, output: 5, cached: 100 }, "cached clamped to input");

// A cache WRITE is not a hit: Anthropic bills it above the input rate, so
// counting it as cached inflates the percentage the user reads.
const writeSrv = await serve((o, res) =>
  sse(res, [
    { type: "message_start", message: { usage: { input_tokens: 900, cache_creation_input_tokens: 100 } } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "w" } },
    { type: "message_delta", delta: {}, usage: { output_tokens: 5 } },
  ]),
);
const r10 = await callModel(anthropicFor(writeSrv), { model: "claude", maxTokens: 100, messages: [{ role: "user", content: "hi" }] });
eq(r10.usage, { input: 1000, output: 5, cached: 0 }, "cache write counted into input, not as a cache hit");

// Anthropic reports cache fields in message_delta too, so the merge has to keep
// the larger snapshot rather than the last one.
const lateSrv = await serve((o, res) =>
  sse(res, [
    { type: "message_start", message: { usage: { input_tokens: 100, cache_read_input_tokens: 800 } } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "late" } },
    { type: "message_delta", delta: {}, usage: { output_tokens: 3, cache_read_input_tokens: 800 } },
  ]),
);
const r11 = await callModel(anthropicFor(lateSrv), { model: "claude", maxTokens: 100, messages: [{ role: "user", content: "hi" }] });
eq(r11.usage, { input: 900, output: 3, cached: 800 }, "cache read in message_delta merges as the larger snapshot");

// ---- Nothing reported: null, not zeros, so the UI says nothing ----
const silent = await serve((o, res) => sse(res, say("no counts")));
const r4 = await callModel(openaiFor(silent), { model: "m", messages: [{ role: "user", content: "hi" }] });
ok(r4.usage === null, "no usage chunk: usage is null");

const zeros = await serve((o, res) => sse(res, [...say("zero"), { usage: { prompt_tokens: 0, completion_tokens: 0 } }]));
const r5 = await callModel(openaiFor(zeros), { model: "m", messages: [{ role: "user", content: "hi" }] });
ok(r5.usage === null, "all-zero usage: usage is null");

// ---- A server that rejects stream_options: the task survives, the counts are lost ----
const strict = await serve((o, res, n) => {
  if (n === 1 && o.stream_options) {
    res.writeHead(400, { "content-type": "application/json" });
    return res.end(JSON.stringify({ error: { message: "Unsupported parameter: stream_options" } }));
  }
  return sse(res, say("retry worked"));
});
const r6 = await callModel(openaiFor(strict), { model: "m", messages: [{ role: "user", content: "hi" }] });
eq(r6.content, "retry worked", "rejected stream_options: request retried without it");
ok(strict.bodies.length === 2, "rejected stream_options: exactly two requests");
ok(strict.bodies[1].stream_options === undefined, "retry: stream_options dropped");
ok(r6.usage === null, "rejected stream_options: no counts, no failure");

for (const s of servers) s.close(); // open listeners keep node alive
console.log(fail ? "\nSOME PROVIDER-USAGE CHECKS FAILED" : "\nALL PROVIDER-USAGE CHECKS PASSED");
process.exit(fail);
