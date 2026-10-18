// Context compaction: the token estimate, the cut plan, the digest, and the
// in-place rewrite of a conversation. Pure module, so this runs in plain Node.
import {
  estimateTokens,
  estimateMessage,
  estimateMessages,
  estimateContext,
  contextParts,
  contextWindowOf,
  contextBudget,
  planCompaction,
  shrinkTail,
  buildDigest,
  isContextOverflow,
  fallbackSummary,
  compactConversation,
  COMPACT_SYSTEM,
  SUMMARY_HEADER,
  SUMMARY_MAX_TOKENS,
  SHRINK_CHARS,
  IMAGE_TOKENS,
} from "../src/background/compact.js";
import { visibleTurns } from "../src/background/sessions.js";

let fail = 0;
const ok = (c, m) => {
  console.log((c ? "ok  : " : "FAIL: ") + m);
  if (!c) fail = 1;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const user = (c, extra = {}) => ({ role: "user", content: c, ...extra });
const asst = (c, toolCalls) => ({ role: "assistant", content: c || "", ...(toolCalls ? { toolCalls } : {}) });
const tool = (id, name, obj) => ({ role: "tool", toolCallId: id, name, content: JSON.stringify(obj) });

// ---- estimates ----
ok(estimateTokens("x".repeat(4000)) === 1000, "estimateTokens: 4 chars a token");
ok(estimateTokens("") === 0, "estimateTokens: empty is 0");
ok(estimateMessage(user("A")) === 5, "estimateMessage: 4 envelope + 1 token");
ok(estimateMessage(user("x".repeat(4000))) === 1004, "estimateMessage: content counted");
ok(
  estimateMessage(user("A", { images: [{ mediaType: "image/png", data: "AAA" }, { mediaType: "image/png", data: "AAA" }] })) ===
    5 + 2 * IMAGE_TOKENS,
  "estimateMessage: each image costs a flat block",
);
ok(
  estimateMessage(asst("", [{ id: "c1", name: "read_page", args: {} }])) > estimateMessage(asst("")),
  "estimateMessage: a tool call costs more than an empty turn",
);

const sys = "SYSTEM PROMPT " + "y".repeat(4000);
const tools = [{ name: "read_page", description: "d", parameters: { type: "object", properties: {} } }];
const est = estimateContext({ system: sys, tools, messages: [user("A")] });
ok(est > estimateMessages([user("A")]) + 1000, "estimateContext: system and tool defs count");
ok(estimateContext({ system: "", tools: [], messages: [user("A"), asst("x")] }) === estimateMessages([user("A"), asst("x")]), "estimateContext: no system/tools is just the messages");

// ---- contextParts: the split the occupancy card shows ----
const parts = contextParts({ system: sys, tools, messages: [user("A")] });
ok(parts.system + parts.tools + parts.messages === parts.total, "contextParts: the rows add up to the bar");
ok(parts.total === est, "contextParts: the split is the same arithmetic estimateContext does");
ok(parts.system === estimateTokens(sys) && parts.tools === estimateTokens(JSON.stringify(tools)), "contextParts: system and tool defs measured the way the request carries them");
ok(contextParts({ system: "", tools: [], messages: [user("A")] }).tools === 0, "contextParts: no tool defs is a 0 row, not a missing one");
ok(contextParts({ system: "", tools: [], messages: [] }).total === 0, "contextParts: an empty chat is 0");
ok(contextParts({ system: "", tools: [], messages: [{ role: "user", content: "A", images: [1, 2] }] }).messages === estimateMessages([{ role: "user", content: "A", images: [1, 2] }]), "contextParts: screenshots count in the messages row");
ok(contextParts({ system: "", tools: [], messages: [{ role: "user", content: "A", images: [1, 2] }] }).messages > estimateTokens("A") + 2 * IMAGE_TOKENS, "contextParts: a screenshot costs more than its text");

// ---- window and budget ----
ok(contextWindowOf({ settings: { contextWindow: 200000 } }) === 200000, "contextWindowOf: the user's window");
ok(contextWindowOf({ settings: {} }) === 128000, "contextWindowOf: the default when unset");
ok(contextWindowOf({}) === 128000, "contextWindowOf: no settings is the default");

// ---- budget ----
ok(contextBudget({ settings: { contextWindow: 128000, maxTokens: 4096 } }) === 128000 - 4096 - 4000, "contextBudget: window minus reply budget and reserve");
ok(contextBudget({ settings: { contextWindow: 8000, maxTokens: 4096 } }) === 2000, "contextBudget: floored at 2000");
ok(contextBudget({ settings: {} }) === 128000 - 4096 - 4000, "contextBudget: defaults when unset");

// ---- planCompaction ----
// 7 messages, 5 tokens each (tool is 7): total 32.
const convo = [user("A"), asst("x"), tool("c1", "click_element", { ok: true }), user("B"), asst("y"), user("C"), asst("z")];
const size = (i) => estimateMessages(convo.slice(i));
ok(size(3) === 20, "fixture: tail from the second user turn is 20 tokens");
ok(planCompaction(convo, 20) === 3, "planCompaction: earliest user boundary whose tail fits");
ok(planCompaction(convo, 10) === 5, "planCompaction: later boundary when the earlier tail is too big");
ok(planCompaction(convo, 100) === 3, "planCompaction: keeps the most verbatim tail that fits");
ok(planCompaction(convo, 5) === 5, "planCompaction: falls back to the last user turn");
ok(planCompaction([user("A"), asst("x"), tool("c1", "wait", { ok: true })], 1) === -1, "planCompaction: nothing to drop in a single turn");
ok(planCompaction([], 10) === -1, "planCompaction: empty conversation");
ok(planCompaction([asst("x"), tool("c1", "wait", { ok: true })], 10) === -1, "planCompaction: no user turn at all");
// The cut is always a user message, never an orphaned tool result.
for (const budget of [1, 5, 10, 20, 100]) {
  const cut = planCompaction(convo, budget);
  ok(cut < 0 || convo[cut].role === "user", `planCompaction: cut at budget ${budget} lands on a user turn`);
}

// ---- shrinkTail ----
const big = { ok: true, text: "z".repeat(40000) };
const tail = [user("A"), asst("x"), tool("c1", "get_page_text", big), user("B"), asst("y")];
const tailBefore = estimateMessages(tail);
const shrunk = shrinkTail(tail, 420);
ok(shrunk === 1, "shrinkTail: shortens the one oversized tool result");
ok(estimateMessages(tail) <= 420, "shrinkTail: tail now fits the budget");
ok(tail[2].content.length <= SHRINK_CHARS + 120, "shrinkTail: result content is shortened, not deleted");
ok(tail[3].content === "B" && tail[4].content === "y", "shrinkTail: the last exchange stays whole");
ok(shrinkTail(tail, 420) === 0, "shrinkTail: nothing left worth shrinking");
ok(estimateMessages(tail) < tailBefore, "shrinkTail: shrinks in place on the shared message objects");

// ---- buildDigest ----
const rich = [
  user("Find the cheapest room"),
  asst("Reading the page.", [{ id: "c1", name: "read_page", args: { ref: 3 } }]),
  tool("c1", "read_page", { ok: true, url: "https://hotel.example/rooms", elements: [{ ref: 3, name: "Deluxe — $120" }, { ref: 4, name: "Standard — $80" }] }),
  asst("", [{ id: "c2", name: "click_element", args: { ref: 4 } }]),
  tool("c2", "click_element", { ok: false, error: "Element not found" }),
  user("screenshot", { images: [{ mediaType: "image/png", data: "AAA" }], internal: true }),
  user("typed secret", { internal: true }),
];
const digest = buildDigest(rich);
ok(/USER: Find the cheapest room/.test(digest), "buildDigest: user turn kept");
ok(/ASSISTANT: Reading the page\./.test(digest), "buildDigest: assistant text kept");
ok(/calls read_page \{"ref":3\}/.test(digest), "buildDigest: tool call recorded");
ok(/TOOL read_page .*Deluxe — \$120/s.test(digest), "buildDigest: page facts carried through");
ok(/TOOL click_element .*Element not found/s.test(digest), "buildDigest: failures kept");
ok(/\(a screenshot was attached here\)/.test(digest), "buildDigest: image message becomes a placeholder");
ok(!/typed secret/.test(digest), "buildDigest: internal plumbing is not the user's words");
ok(buildDigest([user("A"), user("x".repeat(200000))]).length <= 30000 + 200, "buildDigest: capped at the digest limit");
const newestFirst = buildDigest([user("A"), user("B"), user("C"), user("D"), user("E")]);
ok(/USER: E/.test(newestFirst) && /USER: A/.test(newestFirst), "buildDigest: newest messages survive a cap");

// ---- isContextOverflow ----
const overflow = [
  "This model's maximum context length is 128000 tokens. However, your messages resulted in 150000 tokens",
  "prompt is too long: 210000 tokens > 200000 maximum",
  "context length exceeded",
  "input length and max_tokens exceed context limit: 130000 + 4096 > 128000",
  "number of tokens in prompt exceeds the context length",
  "Requested 200000 tokens, token limit is 128000",
];
for (const m of overflow) ok(isContextOverflow(m), `isContextOverflow: matches "${m.slice(0, 40)}…"`);
const notOverflow = [
  "no endpoints found that support tool",
  "This model does not support tools",
  "Provider request failed (401): invalid api key",
  "Provider request failed (429): rate limit exceeded",
  "Provider request failed (503): upstream unavailable",
];
for (const m of notOverflow) ok(!isContextOverflow(m), `isContextOverflow: rejects "${m.slice(0, 40)}…"`);

// ---- fallbackSummary ----
const fb = fallbackSummary(digest);
ok(/USER: Find the cheapest room/.test(fb), "fallbackSummary: keeps the user's request without a model");
ok(/TOOL click_element/.test(fb), "fallbackSummary: keeps the actions");

// ---- compactConversation ----
const provider = { type: "openai", baseUrl: "https://x/v1", apiKey: "k" };
const config = { activeModel: "m", settings: { contextWindow: 128000, maxTokens: 4096 } };
let captured = null;
globalThis.fetch = async (url, init) => {
  captured = { url, body: JSON.parse(init.body) };
  const stream = new ReadableStream({
    start(c) {
      const enc = new TextEncoder();
      c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: "Goal: cheapest room. Standard is $80." } }] })}\n\n`));
      c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ finish_reason: "stop" }] })}\n\n`));
      c.enqueue(enc.encode("data: [DONE]\n\n"));
      c.close();
    },
  });
  return new Response(stream, { status: 200 });
};

const long = [
  user("Find the cheapest room"),
  asst("", [{ id: "c1", name: "get_page_text", args: {} }]),
  tool("c1", "get_page_text", { ok: true, url: "https://hotel.example/", text: "Standard $80. Deluxe $120." + " filler".repeat(6000) }),
  user("Book the standard one"),
  asst("", [{ id: "c2", name: "click_element", args: { ref: 4 } }]),
  tool("c2", "click_element", { ok: true, clicked: "Book" }),
];
const r = await compactConversation({ conversation: long, provider, config, signal: undefined, tailBudget: 60 });
ok(r && r.dropped === 3, `compactConversation: drops the oldest 3 messages (got ${r ? r.dropped : "null"})`);
ok(r && r.kept === 3, "compactConversation: reports the messages kept verbatim");
ok(long[0].role === "user" && long[0].compacted === true && long[0].internal === true, "compactConversation: summary is an internal user message");
ok(long[0].content.startsWith(SUMMARY_HEADER), "compactConversation: summary is framed as notes, not instructions");
ok(/Goal: cheapest room/.test(long[0].content), "compactConversation: model summary is inserted");
ok(long.length === 4, "compactConversation: 3 dropped + 1 summary leaves 4 messages");
ok(
  long[1].content === "Book the standard one" && long[2].toolCalls[0].name === "click_element" && long[3].name === "click_element",
  "compactConversation: recent turns stay verbatim, tool calls and results paired",
);
ok(r.tokensAfter < r.tokensBefore, "compactConversation: the conversation got smaller");
ok(captured.url.endsWith("/chat/completions"), "compactConversation: one call to the configured provider");
ok(captured.body.tools === undefined, "compactConversation: the summariser call sends no tools");
ok(
  captured.body.messages[0].role === "system" && captured.body.messages[0].content === COMPACT_SYSTEM,
  "compactConversation: uses the compaction system prompt",
);
ok(/Standard \$80/.test(captured.body.messages[1].content), "compactConversation: the digest carries the page facts");
ok(r.fallback === false && r.sensitive === false, "compactConversation: clean run reports no fallback, no sensitive site");

// History keeps what the user sees: the summary is plumbing, so it never reaches disk.
const saved = visibleTurns(long);
ok(!saved.some((m) => /Compacted conversation summary/.test(m.content)), "compactConversation: summary is not saved to History");
ok(saved.some((m) => m.content === "Book the standard one"), "compactConversation: the user's turns are still saved");

// A sensitive site in the dropped range: the flag has to survive the drop.
const bank = [
  user("Check my balance"),
  asst("", [{ id: "c1", name: "read_page", args: {} }]),
  tool("c1", "read_page", { ok: true, url: "https://chase.com/accounts", elements: [{ ref: 1, name: "Balance $500" }] }),
  user("Now the card"),
  asst("Done."),
];
const rb = await compactConversation({ conversation: bank, provider, config, signal: undefined, tailBudget: 60 });
ok(rb && rb.sensitive === true, "compactConversation: reports a dropped sensitive-site result");

// Provider failure: the chat must keep running, with a no-model summary.
globalThis.fetch = async () => {
  throw new Error("Provider request failed (503): upstream unavailable");
};
const failing = [user("A"), asst("x"), tool("c1", "wait", { ok: true }), user("B"), asst("y")];
const rf = await compactConversation({ conversation: failing, provider, config, signal: undefined, tailBudget: 20 });
ok(rf && rf.fallback === true, "compactConversation: provider failure falls back, never throws");
ok(rf && rf.dropped === 3 && /USER: A/.test(failing[0].content), "compactConversation: fallback summary lists the dropped turns");

// Cancelled run: no provider call, no mutation.
const ctrl = new AbortController();
ctrl.abort();
const cancelled = [user("A"), asst("x"), tool("c1", "wait", { ok: true }), user("B"), asst("y")];
const rc = await compactConversation({ conversation: cancelled, provider, config, signal: ctrl.signal, tailBudget: 20 });
ok(rc === null, "compactConversation: an aborted signal compacts nothing");
ok(cancelled[0].content === "A", "compactConversation: the cancelled chat is untouched");

// Nothing to drop.
const tiny = [user("A"), asst("x")];
ok((await compactConversation({ conversation: tiny, provider, config, signal: undefined, tailBudget: 100 })) === null, "compactConversation: nothing to drop returns null");

console.log(fail ? "\nSOME COMPACTION TESTS FAILED" : "\nALL COMPACTION TESTS PASSED");
process.exit(fail);
