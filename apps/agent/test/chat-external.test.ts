import { describe, expect, it } from "vitest";
import { EXTERNAL_NOTE_CHARS, LOCAL_ONLY_TEXT } from "../src/ai/external.ts";
import { AgentRunner } from "../src/agent/runner.ts";
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

async function turn(world: ChatWorld, provider: AIProvider, message: string) {
  const events = await collect(runner(world, provider).chat({ conversationId: undefined, message, signal: new AbortController().signal }));
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
      expect(provider.transcript.requests[0]?.system).toMatch(new RegExp(`local="1"[^>]*>${LOCAL_ONLY_TEXT.replace(/[()]/g, "\\$&")}<`));
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
});
