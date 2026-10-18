// Token counts ride on the chat index entry: they survive a worker restart,
// tolerate junk from storage, and are replaced (not added) on each save because
// the worker keeps the chat's running total and hands that total to planSave.

import { cleanUsage, readIndex, upsertSession, planSave, emptyIndex } from "../src/background/sessions.js";

let fail = 0;
const ok = (c, m) => { console.log((c ? "ok  : " : "FAIL: ") + m); if (!c) fail = 1; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const user = (content) => ({ role: "user", content });
const asst = (content) => ({ role: "assistant", content });

// ---- cleanUsage: what counts as a token count ----
ok(same(cleanUsage({ input: 120, output: 34 }), { input: 120, output: 34 }), "cleanUsage: good shape kept");
ok(cleanUsage({ input: 0, output: 0 }) === null, "cleanUsage: zeros are no counts");
ok(cleanUsage(null) === null, "cleanUsage: null in, null out");
ok(cleanUsage("1200 tok") === null, "cleanUsage: a string is not counts");
ok(same(cleanUsage({ input: 120, output: -5 }), { input: 120, output: 0 }), "cleanUsage: negative dropped to 0");
ok(same(cleanUsage({ input: 120.5, output: 34 }), { input: 0, output: 34 }), "cleanUsage: non-integer dropped to 0");
ok(same(cleanUsage({ input: 500, output: 0 }), { input: 500, output: 0 }), "cleanUsage: output-only counts kept");

// ---- readIndex: counts kept, junk dropped ----
const idx = readIndex({
  v: 1,
  currentId: "a",
  items: [
    { id: "a", title: "Chat A", createdAt: 10, updatedAt: 20, model: "m", provider: "P", usage: { input: 900, output: 120 } },
    { id: "b", title: "Chat B", updatedAt: 15, usage: { input: "many", output: null } },
    { id: "c", title: "Chat C", updatedAt: 14 },
  ],
});
ok(same(idx.items.find((i) => i.id === "a").usage, { input: 900, output: 120 }), "readIndex: counts kept on the entry");
ok(idx.items.find((i) => i.id === "b").usage === null, "readIndex: junk counts dropped to null");
ok(idx.items.find((i) => i.id === "c").usage === null, "readIndex: entry with no counts gets null");

// ---- upsertSession: the total replaces, the rest of the entry survives ----
const base = { v: 1, currentId: "a", items: [{ id: "a", title: "Chat A", createdAt: 10, updatedAt: 20, model: "m", provider: "P", usage: { input: 900, output: 120 } }] };
const up = upsertSession(base, { id: "a", title: "Chat A", createdAt: 1, updatedAt: 30, model: "m2", provider: "P2", usage: { input: 2000, output: 300 } });
const itemA = up.index.items.find((i) => i.id === "a");
ok(same(itemA.usage, { input: 2000, output: 300 }), "upsertSession: total replaces the stored counts");
ok(itemA.title === "Chat A" && itemA.createdAt === 10, "upsertSession: title and createdAt kept");
ok(itemA.model === "m2" && itemA.updatedAt === 30, "upsertSession: model and updatedAt updated");
const upJunk = upsertSession(base, { id: "a", title: "Chat A", createdAt: 1, updatedAt: 30, model: "m", provider: "P", usage: { input: -1 } });
ok(upJunk.index.items.find((i) => i.id === "a").usage === null, "upsertSession: junk counts stored as null");
const upNew = upsertSession(emptyIndex(), { id: "z", title: "New", createdAt: 5, updatedAt: 5, model: "m", provider: "P", usage: { input: 10, output: 2 } });
ok(same(upNew.index.items[0].usage, { input: 10, output: 2 }), "upsertSession: new entry carries counts");

// ---- planSave: the total lands on the entry, and a sensitive chat is removed ----
const convo = [user("summarize this page"), asst("Here is the summary.")];
const plan = planSave({
  index: emptyIndex(),
  sessionId: "s1",
  sensitive: false,
  conversation: convo,
  isCurrent: true,
  keepHistory: true,
  now: 100,
  model: "m",
  provider: "P",
  usage: { input: 1500, output: 210 },
});
ok(same(plan.index.items[0].usage, { input: 1500, output: 210 }), "planSave: counts stored with the chat");

// A second run in the same chat: the worker's total covers both runs.
const plan2 = planSave({
  index: plan.index,
  sessionId: "s1",
  sensitive: false,
  conversation: [...convo, user("more"), asst("done")],
  isCurrent: true,
  keepHistory: true,
  now: 200,
  model: "m",
  provider: "P",
  usage: { input: 3100, output: 420 },
});
ok(plan2.index.items.length === 1, "planSave: second run updates the same entry");
ok(same(plan2.index.items[0].usage, { input: 3100, output: 420 }), "planSave: second run's total replaces the first");

// A chat that never got counts (history off, provider silent) stores null, not zeros.
const plan3 = planSave({
  index: emptyIndex(),
  sessionId: "s2",
  sensitive: false,
  conversation: convo,
  isCurrent: true,
  keepHistory: true,
  now: 100,
  model: "m",
  provider: "P",
});
ok(plan3.index.items[0].usage === null, "planSave: no counts stored as null");

// The sensitive-site rule removes the chat outright, counts included.
const plan4 = planSave({
  index: plan.index,
  sessionId: "s1",
  sensitive: true,
  conversation: convo,
  isCurrent: true,
  keepHistory: true,
  now: 300,
  model: "m",
  provider: "P",
  usage: { input: 4000, output: 500 },
});
ok(!plan4.index.items.some((i) => i.id === "s1"), "planSave: sensitive chat removed with its counts");

console.log(fail ? "\nSOME USAGE CHECKS FAILED" : "\nALL USAGE CHECKS PASSED");
process.exitCode = fail;
