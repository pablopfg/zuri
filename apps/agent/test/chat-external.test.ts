import { describe, expect, it } from "vitest";
import { EXTERNAL_NOTE_CHARS, LOCAL_ONLY_TEXT } from "../src/ai/external.ts";
import { AgentRunner } from "../src/agent/runner.ts";
import { memoryPromptSection } from "../src/memory/recall.ts";
import type { AIProvider } from "../src/ai/provider.ts";
import { type ChatWorld, collect, ScriptedProvider, type Step, withChatWorld } from "./chat-world.ts";

// Step 21 (plan D3 to D5): a chat turn on a paid company's model gets the
// external profile; the same turn on Workers AI gets everything.

function runner(world: ChatWorld, provider: AIProvider) {
  return new AgentRunner({
    tools: world.services(),
    conversations: world.conversations,
    settings: () => world.settings,
    locale: () => "pt-BR",
    ai: () => world.ai(provider),
    agentName: undefined,
    clock: () => world.clock.now,
  });
}

async function turn(world: ChatWorld, provider: AIProvider, message: string, conversationId?: string) {
  const events = await collect(runner(world, provider).chat({ conversationId, message, signal: new AbortController().signal }));
  expect(events.at(-1)?.type).toBe("done");
  return events;
}

const callTools = (...calls: { name: string; input: unknown }[]): Step => () => ({ calls });
const say = (text: string): Step => () => ({ text });

function seed(world: ChatWorld) {
  const secret = world.memories.create({ content: "O código do cofre é 4417 e fica com a Ana", category: "fact" }).memory;
  world.memories.setLocalOnly(secret.id, { localOnly: true });
  world.memories.create({ content: "Prefere café do cofre sem açúcar", category: "preference" });
  const marked = world.productivity.notes.create({ title: "Cofre", content: "Combinação do cofre: 12-34-56" });
  world.productivity.notes.setLocalOnly(marked.id, { localOnly: true });
  const long = world.productivity.notes.create({ title: "Diário do cofre", content: `${"a".repeat(EXTERNAL_NOTE_CHARS)}FIM-DO-TEXTO` });
  return { marked, long };
}

describe("a chat turn on an external model", () => {
  it("never sends a marked memory or note, and cuts a long note", async () => {
    await withChatWorld(async (world) => {
      const { marked, long } = seed(world);
      const provider = new ScriptedProvider(
        [
          callTools(
            { name: "search_memories", input: { query: "cofre" } },
            { name: "search_notes", input: { query: "cofre" } },
            { name: "read_note", input: { id: marked.id } },
            { name: "read_note", input: { id: long.id } },
          ),
          say("Pronto."),
        ],
        { external: true, model: "anthropic/claude-haiku-5-5" },
      );
      await turn(world, provider, "O que você sabe do cofre?");
      const seen = JSON.stringify(provider.transcript);
      for (const leak of ["4417", "12-34-56", "FIM-DO-TEXTO"]) expect(seen, leak).not.toContain(leak);
      expect(seen).toContain(LOCAL_ONLY_TEXT);
      expect(seen).toContain("café do cofre");
      // The memory line is in the system prompt still, its text replaced.
      expect(provider.transcript.requests[0]?.system).toMatch(new RegExp(`local="1"[^>]*>${LOCAL_ONLY_TEXT.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&")}<`));
    });
  });

  it("hands Workers AI the whole context, marks and all", async () => {
    await withChatWorld(async (world) => {
      const { marked } = seed(world);
      const provider = new ScriptedProvider([callTools({ name: "read_note", input: { id: marked.id } }), say("Pronto.")]);
      await turn(world, provider, "O que você sabe do cofre?");
      const seen = JSON.stringify(provider.transcript);
      expect(seen).toContain("12-34-56");
      expect(seen).toContain("4417");
    });
  });

  it("hides a marked note's title too, wherever a tool lists or opens it", async () => {
    await withChatWorld(async (world) => {
      const marked = world.productivity.notes.create({ title: "Senha do alarme 7781", content: "nada" });
      world.productivity.notes.setLocalOnly(marked.id, { localOnly: true });
      const provider = new ScriptedProvider(
        [
          callTools(
            { name: "search_notes", input: { query: "alarme" } },
            { name: "read_note", input: { id: marked.id } },
            { name: "search", input: { query: "alarme" } },
          ),
          say("Pronto."),
        ],
        { external: true, model: "anthropic/claude-haiku-5-5" },
      );
      await turn(world, provider, "O que tem sobre o alarme?");
      expect(JSON.stringify(provider.transcript)).not.toContain("7781");
    });
  });

  it("never sends a marked memory's text through a proposal it made earlier in the conversation", async () => {
    await withChatWorld(async (world) => {
      const secret = world.memories.create({ content: "O código do portão é 9902", category: "fact" }).memory;
      world.memories.setLocalOnly(secret.id, { localOnly: true });
      const first = new ScriptedProvider([callTools({ name: "forget_memory", input: { id: secret.id } }), say("Propus apagar.")]);
      const events = await turn(world, first, "Esqueça o código do portão");
      const start = events.find((event) => event.type === "start") as { conversation: { id: string } } | undefined;
      const later = new ScriptedProvider([say("Certo.")], { external: true, model: "anthropic/claude-haiku-5-5" });
      await turn(world, later, "E agora?", start?.conversation.id);
      const seen = JSON.stringify(later.transcript);
      expect(seen).toContain("Proposal forget_memory");
      expect(seen).not.toContain("9902");
    });
  });

  it("keeps the mark on a corrected memory and on a note back from the trash, and never puts a marked text in another line", async () => {
    await withChatWorld(async (world) => {
      const old = world.memories.create({ content: "A senha do Wi-Fi é girassol22", category: "fact" }).memory;
      world.memories.setLocalOnly(old.id, { localOnly: true });
      const corrected = world.memories.correct(old.id, { content: "A senha do Wi-Fi é margarida33" }).memory;
      expect(corrected.localOnly).toBe(true);
      // Landing on a current duplicate marks it too.
      const twin = world.memories.create({ content: "Mora em Recife", category: "fact" }).memory;
      const marked = world.memories.create({ content: "Mora em Olinda", category: "fact" }).memory;
      world.memories.setLocalOnly(marked.id, { localOnly: true });
      expect(world.memories.correct(marked.id, { content: "Mora em Recife" }).memory).toMatchObject({ id: twin.id, localOnly: true });

      // The past fact's line names no replacement when either side is marked.
      const rows = world.db.all<Parameters<typeof memoryPromptSection>[0][number]>(`SELECT * FROM zur_memories`);
      const byId = new Map(rows.map((row) => [row.id, row]));
      const section = memoryPromptSection(rows, 10_000, (id) => byId.get(id) ?? null);
      expect(section).not.toMatch(/replaced_by="[^"]*margarida33/);
      expect(section).not.toMatch(/replaced_by="[^"]*Recife/);

      const note = world.productivity.notes.create({ title: "Cofre", content: "12-34-56" });
      world.productivity.notes.setLocalOnly(note.id, { localOnly: true });
      const item = world.productivity.notes.delete(note.id);
      world.productivity.trash.restore(item.id);
      expect(world.productivity.notes.get(note.id).localOnly).toBe(true);
    });
  });
});
