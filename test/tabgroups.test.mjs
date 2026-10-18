import { GROUP_TITLE, GROUP_COLOR, MAX_TITLE, TAB_GROUP_ID_NONE, closeList, restoreGroup } from "../src/common/tabgroups.js";

let fail = 0;
const ok = (c, m) => { console.log((c ? "ok  : " : "FAIL: ") + m); if (!c) fail = 1; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// --- the group's identity ---
{
  ok(GROUP_TITLE.length <= MAX_TITLE, `GROUP_TITLE fits Chrome's title truncation (${GROUP_TITLE.length} <= ${MAX_TITLE})`);
  ok(
    ["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"].includes(GROUP_COLOR),
    `GROUP_COLOR is one of Chrome's group colours (got "${GROUP_COLOR}")`,
  );
  ok(TAB_GROUP_ID_NONE === -1, "TAB_GROUP_ID_NONE is Chrome's -1 for an ungrouped tab");
}

// --- closeList: close the agent's tabs that are still in the group ---
{
  ok(same(closeList([11, 12, 13], [11, 12, 13]), [11, 12, 13]), "closeList: every tracked tab in the group is closed");
}
{
  // The user dragged tab 12 out of the group: it is theirs now, so it stays open.
  ok(same(closeList([11, 12, 13], [11, 13]), [11, 13]), "closeList: a tab dragged out of the group is not closed");
}
{
  ok(same(closeList([13, 11, 12], [11, 12, 13]), [13, 11, 12]), "closeList: order follows the order the tabs were opened");
}
{
  ok(same(closeList([11, 12], []), []), "closeList: an empty group closes nothing");
}
{
  ok(same(closeList([], [11]), []), "closeList: nothing tracked closes nothing");
}
{
  // A tab the user added to the group is not the agent's, so it is not closed.
  ok(same(closeList([11], [11, 4, 5]), [11]), "closeList: a tab the user put in the group is not closed");
}
{
  ok(same(closeList([11, 12], [12]), [12]), "closeList: a tab the user closed is not in the list");
}

// --- restoreGroup: the shape stored in chrome.storage.session ---
{
  ok(same(restoreGroup({ groupId: 7, tabIds: [11, 12] }), { groupId: 7, tabIds: [11, 12] }), "restoreGroup: a good shape is kept");
}
{
  // The user closed the group: Chrome ungroups the tabs without closing them,
  // so the tracked list still has to survive.
  ok(same(restoreGroup({ groupId: null, tabIds: [11, 12] }), { groupId: null, tabIds: [11, 12] }), "restoreGroup: a closed group keeps the tracked tabs");
}
{
  ok(same(restoreGroup({ groupId: TAB_GROUP_ID_NONE, tabIds: [11] }), { groupId: null, tabIds: [11] }), "restoreGroup: -1 is read as no group, tabs kept");
}
{
  ok(restoreGroup({ groupId: 7, tabIds: "11,12" }) === null, "restoreGroup: a non-list of tabs is refused, not thrown on");
}
{
  ok(restoreGroup(null) === null && restoreGroup("7") === null, "restoreGroup: a missing or non-object value is refused");
}
{
  ok(same(restoreGroup({ groupId: 7, tabIds: [11, 0, -3, "12", 13] }), { groupId: 7, tabIds: [11, 13] }), "restoreGroup: junk tab ids are dropped, order kept");
}
{
  ok(same(restoreGroup({ tabIds: [] }), { groupId: null, tabIds: [] }), "restoreGroup: an empty list of tabs is a valid empty state");
}

console.log(fail ? "\nSOME TAB GROUP TESTS FAILED" : "\nALL TAB GROUP TESTS PASSED");
process.exit(fail);
