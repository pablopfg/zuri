import { describe, expect, it } from "vitest";
import { flipGroup, readClosedGroups, readSidebarCollapsed, saveSidebarCollapsed } from "../src/lib/sidebar.ts";

function memory() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
}

describe("sidebar preference", () => {
  it("starts expanded when nothing was saved", () => {
    expect(readSidebarCollapsed(memory())).toBe(false);
  });

  it("remembers collapsing and expanding again", () => {
    const store = memory();
    saveSidebarCollapsed(true, store);
    expect(readSidebarCollapsed(store)).toBe(true);
    saveSidebarCollapsed(false, store);
    expect(readSidebarCollapsed(store)).toBe(false);
  });

  it("treats an unknown stored value as expanded", () => {
    const store = memory();
    store.setItem("zuri.sidebar", "garbage");
    expect(readSidebarCollapsed(store)).toBe(false);
  });

  it("keeps working when storage is missing or throws", () => {
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(readSidebarCollapsed(broken)).toBe(false);
    expect(() => saveSidebarCollapsed(true, broken)).not.toThrow();
    expect(readSidebarCollapsed(null)).toBe(false);
    expect(() => saveSidebarCollapsed(true, null)).not.toThrow();
  });
});

describe("closed groups of the menu", () => {
  const MY_DAY = "web.nav.groupMyDay";
  const RELATIONS = "web.nav.groupRelations";
  const shut = (closed: string) => [MY_DAY, RELATIONS].filter((group) => closed.includes(group));

  it("starts with every group open", () => {
    expect(readClosedGroups(memory())).toBe("");
  });

  it("closes one group, then the other, and opens each again, saving every step", () => {
    const store = memory();
    let closed = flipGroup(readClosedGroups(store), MY_DAY, store);
    expect(shut(closed)).toEqual([MY_DAY]);
    expect(shut(readClosedGroups(store))).toEqual([MY_DAY]);
    closed = flipGroup(closed, RELATIONS, store);
    expect(shut(readClosedGroups(store))).toEqual([MY_DAY, RELATIONS]);
    closed = flipGroup(closed, MY_DAY, store);
    expect(shut(readClosedGroups(store))).toEqual([RELATIONS]);
    closed = flipGroup(closed, RELATIONS, store);
    expect(closed).toBe("");
    expect(readClosedGroups(store)).toBe("");
  });

  it("opens a group stored more than once with a single click", () => {
    const store = memory();
    expect(flipGroup(MY_DAY + RELATIONS + MY_DAY, MY_DAY, store)).toBe(RELATIONS);
  });

  it("keeps anything else stored there as it is: it names no group", () => {
    const store = memory();
    store.setItem("zuri.sidebar.groups", "<img src=x onerror=alert(1)>");
    const closed = readClosedGroups(store);
    expect(shut(closed)).toEqual([]);
    expect(shut(flipGroup(closed, MY_DAY, store))).toEqual([MY_DAY]);
  });

  it("does not touch the rail's own choice", () => {
    const store = memory();
    saveSidebarCollapsed(true, store);
    flipGroup("", MY_DAY, store);
    expect(readSidebarCollapsed(store)).toBe(true);
    expect(store.data.get("zuri.sidebar")).toBe("collapsed");
  });

  it("keeps working when storage is missing or throws", () => {
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(readClosedGroups(broken)).toBe("");
    expect(readClosedGroups(null)).toBe("");
    // The choice still holds until the tab closes.
    expect(flipGroup("", MY_DAY, broken)).toBe(MY_DAY);
    expect(flipGroup(MY_DAY, MY_DAY, null)).toBe("");
  });
});
