import {
  MEMORY_GRAPH_HUBS_MAX,
  MEMORY_GRAPH_MEMORIES_MAX,
  type MemoryGraph,
  type MemoryHub,
  type MemoryHubKind,
  type MemoryLink,
  MEMORY_REVIEWS_LIST_MAX,
} from "@zuri/shared";
import type { Database } from "../db/database.ts";
import type { MemoryLifecycle } from "./lifecycle.ts";
import { type MemoryRepository, type MemoryRow, toMemory } from "./repository.ts";
import { anyWordQuery, tokens } from "./text.ts";

/**
 * The map of the memory (Sinal, S06): what each memory is linked to, worked
 * out from what is already stored. No AI and no table of its own:
 *
 * - "version" and "review" are real links (a fact that replaced another, a conflict waiting);
 * - "near" joins two memories with at least two meaningful words in common;
 * - a folder is a hub of the memories that say its whole name;
 * - a conversation, a task or a note is a hub of the memories that share two words with its title.
 *
 * Every read is bounded (rule P2): one page of memories and one of each hub kind.
 */

/** Newest rows of each hub kind looked at. */
export const HUB_ROWS = 100;
/** Meaningful words two texts must share to be linked. */
const SHARED_MIN = 2;
/** Links kept per memory, strongest first: a common word must not draw a hairball. */
const NEAR_PER_MEMORY = 5;
const HUBS_PER_MEMORY = 6;
/** Full-text matches looked at around one memory. */
const AROUND_CANDIDATES = 30;
/** Newest matches ranked for them: a word in every memory must not cost a read of 200 of them at each click. */
const AROUND_WINDOW = 60;
/** A hub's label on the wire: the start of the title is enough to recognise it. */
const LABEL_MAX = 120;

interface HubRow {
  kind: MemoryHubKind;
  id: string;
  label: string;
}

function loadHubs(db: Database): HubRow[] {
  const rows = (kind: MemoryHubKind, sql: string) => db.all<{ id: string; label: string }>(sql, HUB_ROWS).map((row) => ({ kind, id: row.id, label: row.label }));
  return [
    ...rows("folder", `SELECT id, name AS label FROM zur_projects WHERE status != 'archived' LIMIT ?`),
    ...rows("conversation", `SELECT id, title AS label FROM zur_conversations ORDER BY updated_at DESC, id DESC LIMIT ?`),
    // Open tasks, by the partial index of the deadline: the ones with a date first.
    ...rows("task", `SELECT id, title AS label FROM zur_tasks WHERE status != 'done' ORDER BY due_at DESC LIMIT ?`),
    ...rows("note", `SELECT id, title AS label FROM zur_notes ORDER BY updated_at DESC LIMIT ?`),
  ];
}

const shared = (a: Set<string>, b: Set<string>): number => {
  let n = 0;
  for (const word of a) if (b.has(word)) n++;
  return n;
};

/** The links among these memories and hubs. Pure: the same rows always give the same map. */
export function linkMemories(memories: MemoryRow[], hubs: HubRow[], reviews: { memory_id: string; other_id: string }[]): { hubs: MemoryHub[]; links: MemoryLink[] } {
  const ids = new Set(memories.map((m) => m.id));
  const words = new Map(memories.map((m) => [m.id, tokens(m.content)]));
  const links: MemoryLink[] = [];
  const paired = new Set<string>();
  const pair = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const join = (from: string, to: string, kind: MemoryLink["kind"]) => {
    if (from === to || paired.has(pair(from, to))) return;
    paired.add(pair(from, to));
    links.push({ from, to, kind });
  };

  for (const m of memories) if (m.superseded_by && ids.has(m.superseded_by)) join(m.id, m.superseded_by, "version");
  for (const r of reviews) if (ids.has(r.memory_id) && ids.has(r.other_id)) join(r.memory_id, r.other_id, "review");

  // Word → memories that have it: each memory is compared only with the ones that share a word.
  const byWord = new Map<string, string[]>();
  for (const [id, set] of words) {
    for (const word of set) {
      const list = byWord.get(word);
      if (list) list.push(id);
      else byWord.set(word, [id]);
    }
  }
  for (const m of memories) {
    const count = new Map<string, number>();
    for (const word of words.get(m.id) ?? []) for (const other of byWord.get(word) ?? []) if (other !== m.id) count.set(other, (count.get(other) ?? 0) + 1);
    const near = [...count].filter(([, n]) => n >= SHARED_MIN).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    for (const [other] of near.slice(0, NEAR_PER_MEMORY)) join(m.id, other, "near");
  }

  const hubLinks: { memory: string; hub: HubRow; score: number }[] = [];
  const titled = hubs.map((hub) => ({ hub, set: tokens(hub.label) })).filter((h) => h.set.size > 0);
  for (const m of memories) {
    const mine = words.get(m.id) ?? new Set<string>();
    const found: { hub: HubRow; score: number }[] = [];
    for (const { hub, set } of titled) {
      const n = shared(set, mine);
      // A folder's name is short ("Saúde"): the whole name must be there. A title needs two words.
      if (hub.kind === "folder" ? n === set.size : n >= SHARED_MIN) found.push({ hub, score: n });
    }
    found.sort((a, b) => b.score - a.score);
    for (const f of found.slice(0, HUBS_PER_MEMORY)) hubLinks.push({ memory: m.id, ...f });
  }
  // The hubs with the most memories stay when there are too many.
  const degree = new Map<string, number>();
  const key = (hub: HubRow) => `${hub.kind}:${hub.id}`;
  for (const l of hubLinks) degree.set(key(l.hub), (degree.get(key(l.hub)) ?? 0) + 1);
  const kept = new Set([...degree].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, MEMORY_GRAPH_HUBS_MAX).map(([id]) => id));
  const out = new Map<string, MemoryHub>();
  for (const l of hubLinks) {
    const id = key(l.hub);
    if (!kept.has(id)) continue;
    out.set(id, { id, kind: l.hub.kind, ref: l.hub.id, label: [...l.hub.label].slice(0, LABEL_MAX).join("") });
    links.push({ from: l.memory, to: id, kind: "hub" });
  }
  return { hubs: [...out.values()], links };
}

/** The newest memories and their links, or one memory and what touches it. */
export function memoryGraph(db: Database, repo: MemoryRepository, lifecycle: MemoryLifecycle, around?: string): MemoryGraph {
  const reviews = repo.listReviews(MEMORY_REVIEWS_LIST_MAX);
  if (!around) {
    const rows = repo.list({ filter: "all", limit: MEMORY_GRAPH_MEMORIES_MAX + 1 });
    const memories = rows.slice(0, MEMORY_GRAPH_MEMORIES_MAX);
    return { memories: memories.map(toMemory), ...linkMemories(memories, loadHubs(db), reviews), truncated: rows.length > memories.length };
  }
  const history = lifecycle.history(around);
  const center = history.memory;
  const candidates = new Map<string, MemoryRow>([[center.id, center]]);
  for (const m of [...history.previous, ...history.next]) candidates.set(m.id, m);
  const partners = reviews.flatMap((r) => (r.memory_id === center.id ? [r.other_id] : r.other_id === center.id ? [r.memory_id] : []));
  for (const m of repo.many(partners).values()) candidates.set(m.id, m);
  const match = anyWordQuery(center.content);
  if (match) for (const m of repo.match(match, { filter: "all", limit: AROUND_CANDIDATES, window: AROUND_WINDOW })) candidates.set(m.id, m);

  const all = linkMemories([...candidates.values()], loadHubs(db), reviews);
  // Only what touches the chosen memory, and the links among those.
  const touching = new Set([center.id]);
  for (const l of all.links) {
    if (l.from === center.id) touching.add(l.to);
    else if (l.to === center.id) touching.add(l.from);
  }
  return {
    memories: [...candidates.values()].filter((m) => touching.has(m.id)).map(toMemory),
    hubs: all.hubs.filter((h) => touching.has(h.id)),
    links: all.links.filter((l) => touching.has(l.from) && touching.has(l.to)),
    truncated: false,
  };
}
