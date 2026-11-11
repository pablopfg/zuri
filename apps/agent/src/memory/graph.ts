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
import { anyWordQuery, fold, tokens } from "./text.ts";

/**
 * The map of the memory (Sinal, S06): what each memory is linked to, worked
 * out from what is already stored. No AI and no table of its own:
 *
 * - "version" and "review" are real links (a fact that replaced another, a conflict waiting);
 * - "near" joins two memories with at least two meaningful words in common;
 * - a folder is a hub of the memories that say its whole name;
 * - a conversation, a task or a note is a hub of the memories that share two words with its title;
 * - a contact (Sinal, S10) is a hub of the one memory being looked at, when that memory says the
 *   contact's whole name, or a first name only one contact has.
 *
 * Every read is bounded (rule P2): one page of memories and one of each hub kind.
 * The folders have no index by status: that read walks at most the table's own
 * ceiling (STORAGE_LIMITS.projects) when most of them are archived.
 */

/** Newest rows of each hub kind looked at. */
export const HUB_ROWS = 100;
/** Meaningful words two texts must share to be linked. */
const SHARED_MIN = 2;
/** Links kept per memory, strongest first: a common word must not draw a hairball. */
const NEAR_PER_MEMORY = 5;
const HUBS_PER_MEMORY = 6;
/** Words of one memory that count (SEC-A13-01): 160 long texts with the same words must not hold the object's only thread. */
export const WORDS_PER_MEMORY = 40;
/** Full-text matches looked at around one memory. */
const AROUND_CANDIDATES = 30;
/** Newest matches ranked for them: a word in every memory must not cost a read of 200 of them at each click. */
const AROUND_WINDOW = 60;
/** A hub's label on the wire: the start of the title is enough to recognise it. */
const LABEL_MAX = 120;

/** Capitalised words of the chosen memory looked up among the contacts' first names. */
export const CONTACT_PROBES = 8;
/** Contacts read per word: with more than one sharing a first name, only a whole name links. */
const CONTACT_ROWS = 4;
/** Contacts linked to one memory. */
const CONTACTS_PER_MEMORY = 3;

interface HubRow {
  kind: MemoryHubKind;
  id: string;
  label: string;
}

function loadHubs(db: Database): HubRow[] {
  const rows = (kind: MemoryHubKind, sql: string) => db.all<{ id: string; label: string }>(sql, HUB_ROWS).map((row) => ({ kind, id: row.id, label: row.label }));
  return [
    ...rows("folder", `SELECT id, name AS label FROM zur_projects WHERE status != 'archived' ORDER BY id LIMIT ?`),
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
  const words = new Map(memories.map((m) => [m.id, new Set([...tokens(m.content)].slice(0, WORDS_PER_MEMORY))]));
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
    // The folders first: a one-word name scores less than any title and must not lose its place to six notes.
    const folderFirst = (h: HubRow) => (h.kind === "folder" ? 0 : 1);
    found.sort((a, b) => folderFirst(a.hub) - folderFirst(b.hub) || b.score - a.score);
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

const nameWords = (text: string): string[] => fold(text).match(/[\p{L}\p{N}]+/gu) ?? [];

/**
 * The words of a memory worth looking up as somebody's first name: the ones
 * written with a capital, folded, each once, in the order they come.
 */
export function contactProbes(content: string): string[] {
  const out = new Set<string>();
  for (const word of content.match(/\p{Lu}[\p{L}\p{N}]{2,}/gu) ?? []) {
    out.add(fold(word));
    if (out.size === CONTACT_PROBES) break;
  }
  return [...out];
}

/**
 * Which of the contacts found for one first name a memory talks about. A
 * contact whose every name is in the memory ("Ana Souza") always counts; a
 * first name alone ("Ana") counts only when a single contact answers to it,
 * since two Anas cannot be told apart. Pure.
 */
export function namedContacts<T extends { name: string }>(content: string, probe: string, found: T[]): T[] {
  const said = new Set(nameWords(content));
  // An e-mail or a phone standing for a missing name is no name: "Contato" must not find contato@exemplo.com.br.
  const candidates = found.filter((contact) => !contact.name.includes("@") && nameWords(contact.name)[0] === probe);
  const whole = candidates.filter((contact) => {
    const words = nameWords(contact.name);
    return words.length > 1 && words.every((word) => said.has(word));
  });
  if (whole.length > 0) return whole;
  return candidates.length === 1 && found.length < CONTACT_ROWS ? candidates : [];
}

/**
 * The contacts the chosen memory names. Each probe reads a few rows by the
 * index of the name (rule P2), never the whole copy: a contact is found by
 * how its name starts, so "Dra. Helena" is not found by "Helena".
 */
function contactHubs(db: Database, content: string): HubRow[] {
  const out = new Map<string, HubRow>();
  for (const probe of contactProbes(content)) {
    const found = db.all<{ id: string; name: string }>(
      `SELECT id, display_name AS name FROM zur_contacts WHERE search_name >= ? AND search_name < ? ORDER BY search_name, id LIMIT ?`,
      probe,
      `${probe}\uffff`,
      CONTACT_ROWS,
    );
    for (const contact of namedContacts(content, probe, found)) out.set(contact.id, { kind: "contact", id: contact.id, label: contact.name });
    if (out.size >= CONTACTS_PER_MEMORY) break;
  }
  return [...out.values()].slice(0, CONTACTS_PER_MEMORY);
}

/** The newest memories and their links, or one memory and what touches it. */
export function memoryGraph(db: Database, repo: MemoryRepository, lifecycle: MemoryLifecycle, around?: string, contactsOn?: () => boolean): MemoryGraph {
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
  // The contacts are the chosen memory's alone: the whole map never looks them up (up to 5,000 names against every memory).
  // SEC-S10-02: a copy left behind by an account that lost its permission is not shown here either.
  const contacts = (contactsOn?.() ? contactHubs(db, center.content) : []).map((hub): MemoryHub => ({ id: `contact:${hub.id}`, kind: "contact", ref: hub.id, label: [...hub.label].slice(0, LABEL_MAX).join("") }));
  return {
    memories: [...candidates.values()].filter((m) => touching.has(m.id)).map(toMemory),
    hubs: [...all.hubs.filter((h) => touching.has(h.id)), ...contacts],
    links: [...all.links.filter((l) => touching.has(l.from) && touching.has(l.to)), ...contacts.map((hub): MemoryLink => ({ from: center.id, to: hub.id, kind: "hub" }))],
    truncated: false,
  };
}
