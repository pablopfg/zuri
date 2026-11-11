import { MEMORY_GRAPH_HUBS_MAX, type MemoryHubKind } from "@zuri/shared";
import { describe, expect, it } from "vitest";
import { linkMemories, WORDS_PER_MEMORY } from "../src/memory/graph.ts";
import type { MemoryRow } from "../src/memory/repository.ts";

// The rules that draw the map of the memory (Sinal, S06), without a database.

const memory = (id: string, content: string, superseded_by: string | null = null): MemoryRow => ({
  id,
  content,
  category: "fact",
  origin: "app",
  author: "owner",
  status: "active",
  superseded_by,
  valid_from: null,
  valid_until: null,
  dedupe_key: 0,
  local_only: 0,
  created_at: "2026-11-01T12:00:00.000Z",
  updated_at: "2026-11-01T12:00:00.000Z",
});
const hub = (kind: MemoryHubKind, id: string, label: string) => ({ kind, id, label });
const kinds = (links: { from: string; to: string; kind: string }[], kind: string) => links.filter((l) => l.kind === kind);

describe("links among memories", () => {
  it("need two meaningful words in common: one is not enough", () => {
    const one = linkMemories([memory("a", "Gosta de pescar no rio"), memory("b", "Comprou vara de pescar")], [], []);
    expect(one.links).toEqual([]);
    const two = linkMemories([memory("a", "Gosta de pescar no rio Tibagi"), memory("b", "Vai pescar no Tibagi em maio")], [], []);
    expect(two.links).toEqual([{ from: "a", to: "b", kind: "near" }]);
  });

  it("a version and a pending review are links of their own, drawn once", () => {
    const rows = [memory("old", "Trabalha na padaria Trigo Dourado", "new"), memory("new", "Trabalha na livraria Entrelinhas"), memory("x", "Mora em Curitiba"), memory("y", "Mora em Londrina")];
    const { links } = linkMemories(rows, [], [{ memory_id: "x", other_id: "y" }, { memory_id: "x", other_id: "gone" }]);
    expect(links).toContainEqual({ from: "old", to: "new", kind: "version" });
    expect(links).toContainEqual({ from: "x", to: "y", kind: "review" });
    // The review with a memory that did not come is left out, and no pair is drawn twice.
    expect(links.filter((l) => l.to === "gone" || l.from === "gone")).toEqual([]);
    expect(new Set(links.map((l) => [l.from, l.to].sort().join("|"))).size).toBe(links.length);
  });

  it("keeps the five nearest of each memory", () => {
    const center = memory("c", "Planeja a viagem para Lisboa em dezembro");
    const others = Array.from({ length: 7 }, (_, i) => memory(`m${i}`, `Viagem para Lisboa parte numero${i}`));
    // Only the centre: the others are too many for one another as well, so count the centre's own picks.
    const { links } = linkMemories([center, ...others], [], []);
    const perMemory = new Map<string, number>();
    for (const l of kinds(links, "near")) perMemory.set(l.from, (perMemory.get(l.from) ?? 0) + 1);
    expect(perMemory.get("c")).toBe(5);
  });

  it("SEC-A13-01: only the first words of a long memory count", () => {
    const filler = Array.from({ length: WORDS_PER_MEMORY }, (_, i) => `palavra${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}x`).join(" ");
    const inside = linkMemories([memory("a", `Tibagi pescaria ${filler}`), memory("b", "Tibagi pescaria")], [], []);
    expect(kinds(inside.links, "near")).toHaveLength(1);
    // The same two words after the fortieth are not looked at.
    const outside = linkMemories([memory("a", `${filler} Tibagi pescaria`), memory("b", "Tibagi pescaria")], [], []);
    expect(outside.links).toEqual([]);
  });
});

describe("links to folders, conversations, tasks and notes", () => {
  it("a folder needs its whole name, a title needs two words", () => {
    const rows = [memory("a", "Está cuidando da mudança de apartamento")];
    const hubs = [
      hub("folder", "f1", "Mudança"),
      hub("folder", "f2", "Mudança de escritório"),
      hub("conversation", "c1", "Mudança de apartamento em março"),
      hub("task", "t1", "Pintar o apartamento"),
      hub("note", "n1", "Lista da mudança do apartamento"),
      hub("note", "n2", "   "),
    ];
    const out = linkMemories(rows, hubs, []);
    expect(out.hubs.map((h) => h.id).sort()).toEqual(["conversation:c1", "folder:f1", "note:n1"]);
    expect(out.hubs.find((h) => h.id === "conversation:c1")).toEqual({ id: "conversation:c1", kind: "conversation", ref: "c1", label: "Mudança de apartamento em março" });
    expect(kinds(out.links, "hub")).toHaveLength(3);
  });

  it("keeps six per memory, and the folder among them", () => {
    const rows = [memory("a", "Está cuidando da mudança de apartamento")];
    const notes = Array.from({ length: 7 }, (_, i) => hub("note", `n${i}`, `Mudança apartamento parte ${i}`));
    const out = linkMemories(rows, [...notes, hub("folder", "f", "Mudança")], []);
    expect(out.hubs).toHaveLength(6);
    expect(out.hubs.map((h) => h.id)).toContain("folder:f");
  });

  it("keeps the 40 hubs with the most memories", () => {
    const rows = [memory("a", "Reforma da cozinha nova"), memory("b", "Reforma da cozinha velha"), ...Array.from({ length: MEMORY_GRAPH_HUBS_MAX + 1 }, (_, i) => memory(`s${i}`, `Assunto unico${i} tema${i}`))];
    const hubs = [hub("note", "busy", "Reforma da cozinha"), ...Array.from({ length: MEMORY_GRAPH_HUBS_MAX + 1 }, (_, i) => hub("note", `h${String(i).padStart(2, "0")}`, `Assunto unico${i} tema${i}`))];
    const out = linkMemories(rows, hubs, []);
    expect(out.hubs).toHaveLength(MEMORY_GRAPH_HUBS_MAX);
    expect(out.hubs.map((h) => h.id)).toContain("note:busy");
    // Every hub link ends at a hub that stayed.
    const kept = new Set(out.hubs.map((h) => h.id));
    for (const l of kinds(out.links, "hub")) expect(kept.has(l.to), l.to).toBe(true);
  });

  it("cuts a long title at 120 characters, without splitting an emoji", () => {
    const title = `Viagem Lisboa ${"🙂".repeat(130)}`;
    const out = linkMemories([memory("a", "Viagem para Lisboa")], [hub("note", "n", title)], []);
    expect([...(out.hubs[0]?.label ?? "")]).toHaveLength(120);
    expect(out.hubs[0]?.label.endsWith("🙂")).toBe(true);
  });
});
