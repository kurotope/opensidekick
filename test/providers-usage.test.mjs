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
eq(r1.usage, { input: 120, output: 34 }, "openai: prompt/completion tokens normalized");
eq(r1.content, "hello", "openai: text still streamed");
eq(openai.bodies[0].stream_options, { include_usage: true }, "openai: usage asked for in the request");

// ---- Ollama's OpenAI-compatible endpoint names the fields differently ----
const ollama = await serve((o, res) =>
  sse(res, [...say("local"), { usage: { prompt_eval_count: 800, eval_count: 40 } }]),
);
const r2 = await callModel(openaiFor(ollama), { model: "qwen3-vl:8b-instruct", messages: [{ role: "user", content: "hi" }] });
eq(r2.usage, { input: 800, output: 40 }, "ollama: eval-count fields normalized to input/output");

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
eq(r3.usage, { input: 6200, output: 150 }, "anthropic: cache tokens fold into input, output takes the cumulative total");
eq(r3.content, "claude", "anthropic: text still streamed");

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
