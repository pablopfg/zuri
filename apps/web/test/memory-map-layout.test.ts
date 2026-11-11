import { describe, expect, it } from "vitest";
import { layout } from "../src/pages/memory/map-layout.ts";

describe("the memory map's layout", () => {
  const ids = Array.from({ length: 200 }, (_, i) => `n${i}`);
  const links = ids.slice(1).map((id, i) => ({ from: id, to: `n${Math.floor(i / 3)}` }));

  it("puts every point inside the unit square, each on its own spot, and always the same", () => {
    const first = layout(ids, links);
    expect(first.size).toBe(200);
    const spots = new Set<string>();
    for (const point of first.values()) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(1);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(1);
      expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true);
      spots.add(`${point.x.toFixed(4)},${point.y.toFixed(4)}`);
    }
    expect(spots.size).toBe(200);
    expect([...layout(ids, links)]).toEqual([...first]);
  });

  it("draws linked points closer than loose ones", () => {
    const at = layout(["a", "b", "c", "d", "e", "f"], [{ from: "a", to: "b" }]);
    const far = (p: string, q: string) => Math.hypot((at.get(p)?.x ?? 0) - (at.get(q)?.x ?? 0), (at.get(p)?.y ?? 0) - (at.get(q)?.y ?? 0));
    for (const other of ["c", "d", "e", "f"]) expect(far("a", "b")).toBeLessThan(far("a", other));
  });

  it("copes with nothing, with one point, and with links to points that aren't there", () => {
    expect(layout([], []).size).toBe(0);
    expect(layout(["a"], [{ from: "a", to: "a" }]).get("a")).toEqual({ x: 0.5, y: 0.5 });
    expect(layout(["a", "b"], [{ from: "a", to: "gone" }]).size).toBe(2);
  });
});
