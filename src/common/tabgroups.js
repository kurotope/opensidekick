// Tab groups: the rules for the group the agent keeps its own tabs in.
// Pure (no chrome.*), so it is unit-tested under plain node. The group is the
// agent's footprint, not the user's: it holds only tabs the agent opened, and
// they are closed when the chat ends.

// A fixed title, not the task text. The title is browser UI — visible over the
// shoulder, on a shared screen, in a screenshot — and the system prompt invites
// users to paste credentials for a task, so the task text must not leak into it.
export const GROUP_TITLE = "OpenSidekick";
export const GROUP_COLOR = "blue";

// Chrome truncates group titles in the tab strip; keep ours inside that.
export const MAX_TITLE = 32;

// chrome.tabs.TAB_GROUP_ID_NONE: a tab that is not in any group.
export const TAB_GROUP_ID_NONE = -1;

/**
 * Which tracked tabs to close when the chat ends: the ones still in the group.
 * A tab the user dragged out of the group is no longer the agent's, so it stays
 * open. Order follows `tracked`, the order the tabs were opened.
 */
export function closeList(tracked, groupMembers) {
  const inGroup = new Set(groupMembers);
  return tracked.filter((id) => inGroup.has(id));
}

/**
 * The stored group state, or null if it is not a shape to trust. `groupId` is
 * null when the tabs are tracked but no group exists yet — the user closed the
 * group, which ungroups the tabs without closing them, so the list still matters.
 */
export function restoreGroup(raw) {
  if (!raw || typeof raw !== "object") return null;
  const { groupId, tabIds } = raw;
  const id = Number.isInteger(groupId) && groupId !== TAB_GROUP_ID_NONE ? groupId : null;
  if (!Array.isArray(tabIds)) return null;
  return { groupId: id, tabIds: tabIds.filter((i) => Number.isInteger(i) && i > 0) };
}
