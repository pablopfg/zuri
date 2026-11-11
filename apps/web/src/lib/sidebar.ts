const KEY = "zuri.sidebar";

type Store = Pick<Storage, "getItem" | "setItem">;

function local(): Store | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

/** Whether the owner left the sidebar collapsed on this device (a look, like the theme). */
export function readSidebarCollapsed(store: Store | null = local()): boolean {
  try {
    return store?.getItem(KEY) === "collapsed";
  } catch {
    return false;
  }
}

export function saveSidebarCollapsed(collapsed: boolean, store: Store | null = local()): void {
  try {
    store?.setItem(KEY, collapsed ? "collapsed" : "expanded");
  } catch {
    // Storage off (private mode): the choice lasts until the tab closes.
  }
}

const GROUPS_KEY = `${KEY}.groups`;

/**
 * The groups of the menu the owner left closed on this device: the keys of
 * their titles (lib/nav.ts), one after the other. A group is closed while its
 * key is in there; anything else stored names no group and changes nothing.
 */
export function readClosedGroups(store: Store | null = local()): string {
  try {
    return store?.getItem(GROUPS_KEY) ?? "";
  } catch {
    return "";
  }
}

/** Closes the group if it is open and opens it if it is closed; returns the new list, already saved. */
export function flipGroup(closed: string, group: string, store: Store | null = local()): string {
  const next = closed.includes(group) ? closed.replaceAll(group, "") : closed + group;
  try {
    store?.setItem(GROUPS_KEY, next);
  } catch {
    // Storage off (private mode): the choice lasts until the tab closes.
  }
  return next;
}

/** The storage event key, so other tabs follow the change. */
export const SIDEBAR_KEY = KEY;
