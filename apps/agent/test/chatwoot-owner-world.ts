import { runInDurableObject } from "cloudflare:test";
import type { AgentRunner, TurnInput } from "../src/agent/runner.ts";
import type { ZuriAgent } from "../src/agent/zuri-agent.ts";
import { ConversationRepository } from "../src/chat/conversations.ts";
import { developmentOwnerNetwork, type SimulatedChatwoot } from "../src/chatwoot/dev-chatwoot-owner.ts";
import { ChatwootOwner } from "../src/chatwoot/owner-service.ts";
import { Database } from "../src/db/database.ts";
import { InternalState } from "../src/db/internal-state.ts";
import { migrate } from "../src/db/migrations.ts";
import { FlowConnections } from "../src/flows/connections.ts";
import { chatwootHookPath, isChatwootHookToken } from "../src/gates/chatwoot-owner.ts";
import { Productivity } from "../src/productivity/index.ts";
import { FakeNetwork } from "./flow-world.ts";
import { testEnv } from "./helpers.ts";

/** The test's Chatwoot: chat.exemplo.com.br, simulated as in local development (src/chatwoot/dev-chatwoot-owner.ts). */
export const ORIGIN = "https://chat.exemplo.com.br";
export const ADMIN_KEY = "chave-admin-exemplo-0123456789";
/** Ana Martins, agent 7, the key's owner in the simulation. */
export const OWNER_ID = 7;

type Event = { type: "text"; delta: string } | { type: "approval" } | { type: "error"; message: string } | { type: "done"; message: { status: string } };

/** A runner that answers with fixed events and records each turn. */
export class FakeRunner {
  readonly turns: TurnInput[] = [];
  events: Event[] = [
    { type: "text", delta: "Olá, Ana." },
    { type: "done", message: { status: "complete" } },
  ];
  /** Waits until this resolves before the last event (a slow turn). */
  hold: Promise<void> | null = null;
  fail: Error | null = null;
  chat(input: TurnInput): AsyncIterable<Event> {
    this.turns.push(input);
    const self = this;
    return (async function* () {
      if (self.fail) throw self.fail;
      for (const [index, event] of self.events.entries()) {
        if (index === self.events.length - 1 && self.hold) await self.hold;
        yield event;
      }
    })();
  }
}

export interface OwnerWorld {
  db: Database;
  state: InternalState;
  connections: FlowConnections;
  owner: ChatwootOwner;
  chatwoot: SimulatedChatwoot;
  network: FakeNetwork;
  runner: FakeRunner;
  conversations: ConversationRepository;
  notices: { kind: string; reason?: string }[];
  lockdown: { active: boolean };
  /** Moves the service's clock (the simulation signs with the real one). */
  clock: { shift: number };
  activeRuns: Map<string, AbortController>;
  /** Waits until the simulation's notices (50 ms each) arrived and the work they started ended. */
  settle(ms?: number): Promise<void>;
  /** Setup through to the code, the owner's answer and the confirmation: the channel on. */
  link(): Promise<void>;
  /** The conversation's messages in the simulation (what Zuri and the agents wrote). */
  messages(): { id: number; content: string; message_type: number; sender: { id: number } }[];
  conversationId(): number;
}

let objects = 0;
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

export function withOwnerWorld<T>(fn: (world: OwnerWorld) => T | Promise<T>, options: { credentialKey?: string | undefined } = {}): Promise<T> {
  const stub = testEnv.AGENT.get(testEnv.AGENT.idFromName(`chatwoot-owner-test-${++objects}`));
  return runInDurableObject(stub, async (_agent: ZuriAgent, storage) => {
    const db = new Database(storage.storage);
    migrate(db);
    const clock = { shift: 0 };
    const tick = () => Date.now() + clock.shift;
    const state = new InternalState(db);
    const key = "credentialKey" in options ? options.credentialKey : testEnv.MCP_CREDENTIAL_KEY;
    const connections = new FlowConnections(db, key, tick);
    const productivity = new Productivity(db, { timeZone: () => "America/Sao_Paulo", clock: tick });
    const conversations = new ConversationRepository(db, productivity.storage, () => "pt-BR");
    const network = new FakeNetwork();
    const runner = new FakeRunner();
    const notices: { kind: string; reason?: string }[] = [];
    const lockdown = { active: false };
    const activeRuns = new Map<string, AbortController>();
    const pending: Promise<unknown>[] = [];
    let owner: ChatwootOwner | null = null;
    const chatwoot = developmentOwnerNetwork(network, (address, raw, headers) => {
      const hook = chatwootHookPath(new URL(address).pathname);
      if (!hook) return;
      pending.push(
        (async () => {
          if (owner && (await isChatwootHookToken(hook.linkId, hook.token, testEnv.SESSION_SECRET))) await owner.receive(hook.linkId, raw, headers);
        })(),
      );
    }, tick);
    owner = new ChatwootOwner({
      state,
      connections,
      network: () => chatwoot,
      development: () => false,
      publicUrl: () => new URL(testEnv.PUBLIC_URL as string),
      sessionSecret: () => testEnv.SESSION_SECRET,
      locale: () => "pt-BR",
      lockdown: () => lockdown.active,
      runner: () => runner as unknown as AgentRunner,
      conversations: () => conversations,
      activeRuns,
      notify: (notice) => notices.push(notice),
      keepAlive: (work) => {
        pending.push(work());
      },
      clock: tick,
    });
    owner.testWaitMs = 1_000;
    const service = owner;
    // Until the simulation has no notice on its way and the work they started ended: never a fixed wait.
    const settle = async (ms = 0) => {
      await sleep(ms);
      for (;;) {
        while (pending.length > 0) await Promise.allSettled(pending.splice(0));
        await service.settled();
        if (chatwoot.sim.inflight === 0 && pending.length === 0) return;
        await sleep(5);
      }
    };
    const conversationId = () => {
      const contact = [...chatwoot.sim.contacts.values()].at(-1);
      const id = contact?.conversations.at(-1);
      if (id === undefined) throw new Error("no conversation yet");
      return id;
    };
    const world: OwnerWorld = {
      db,
      state,
      connections,
      owner: service,
      chatwoot,
      network,
      runner,
      conversations,
      notices,
      lockdown,
      clock,
      activeRuns,
      settle,
      conversationId,
      messages: () => chatwoot.sim.messages.get(conversationId()) ?? [],
      link: async () => {
        await service.setup({ origin: ORIGIN, accountId: 1, adminKey: ADMIN_KEY, ownerId: OWNER_ID });
        await settle();
        service.confirm();
      },
    };
    return fn(world);
  });
}
