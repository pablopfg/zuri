import { hmacSha256Hex } from "@zuri/shared";
import type { FlowNetwork } from "../flows/connections.ts";
import { asCode } from "./owner-service.ts";

/**
 * The owner's Chatwoot in local development (a loopback http PUBLIC_URL):
 * `chat.exemplo.com.br` answers as a whole installation would, so `npm run dev`,
 * the e2e tests and the screenshots never reach a real one. The administrator
 * "Ana Martins" (agent 7) owns any key but two: `chave-recusada-exemplo` (401)
 * and `chave-atendente-exemplo` (an agent, not an administrator). When Zuri
 * sends the link code or the test message, the simulated owner answers: the
 * notice is signed with the inbox's secret and handed back to `deliver`, as the
 * Chatwoot would post it to the inbox's return address.
 */
const HOST = "chat.exemplo.com.br";

export interface Simulated {
  inboxes: Map<number, { identifier: string; secret: string; hmacToken: string; webhookUrl: string; members: number[]; hmacMandatory: boolean }>;
  contacts: Map<string, { identifier: string; inbox: number; conversations: number[] }>;
  messages: Map<number, { id: number; content: string; message_type: number; sender: { id: number; type: string; name: string } }[]>;
  next: number;
  /** The owner answers the link code on their own (development); tests turn it off to answer themselves. */
  autoAnswer: boolean;
  /** The code the app shows (owner-service tells it here only): the simulated owner types it after the code's message. */
  code: string | null;
  /** Notices scheduled and not delivered yet: the tests wait for none, never for a fixed time. */
  inflight: number;
}

/** The simulated installation, for the tests: its state and an agent who writes in a conversation. */
export interface SimulatedChatwoot extends FlowNetwork {
  sim: Simulated;
  /** An agent account writes in a conversation of the inbox (an outgoing message), and its notice goes out. */
  agentSays(conversation: number, content: string, sender?: { id: number; name: string }, options?: { private?: boolean }): Promise<number>;
}

export type Deliver = (url: string, raw: string, headers: { signature: string; timestamp: string; delivery: string }) => void;

export function developmentOwnerNetwork(base: FlowNetwork, deliver: Deliver, clock: () => number = Date.now): SimulatedChatwoot {
  const sim: Simulated = { inboxes: new Map(), contacts: new Map(), messages: new Map(), next: 100, autoAnswer: true, code: null, inflight: 0 };
  const id = () => ++sim.next;
  const later = (work: () => Promise<void>) => {
    sim.inflight++;
    setTimeout(() => {
      void work().finally(() => {
        sim.inflight--;
      });
    }, 50);
  };
  const json = (body: unknown, status = 200) => Response.json(body, { status });
  const inboxJson = (inboxId: number) => {
    const inbox = sim.inboxes.get(inboxId);
    return inbox
      ? { id: inboxId, name: "Zuri", channel_type: "Channel::Api", inbox_identifier: inbox.identifier, secret: inbox.secret, hmac_token: inbox.hmacToken, webhook_url: inbox.webhookUrl, hmac_mandatory: inbox.hmacMandatory }
      : null;
  };

  const notice = async (inboxId: number, conversation: number, message: { id: number; content: string; message_type: number; sender: { id: number; type: string; name: string } }, isPrivate = false) => {
    const inbox = sim.inboxes.get(inboxId);
    if (!inbox) return;
    const raw = JSON.stringify({
      event: "message_created",
      id: message.id,
      content: message.content,
      message_type: message.message_type === 1 ? "outgoing" : "incoming",
      private: isPrivate,
      inbox: { id: inboxId, name: "Zuri" },
      conversation: { id: conversation },
      sender: message.sender,
    });
    const timestamp = String(Math.floor(clock() / 1000));
    deliver(inbox.webhookUrl, raw, { signature: `sha256=${await hmacSha256Hex(inbox.secret, `${timestamp}.${raw}`)}`, timestamp, delivery: crypto.randomUUID() });
  };

  const answer = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const key = request.headers.get("api_access_token");
    const body = request.method === "GET" || request.method === "DELETE" ? {} : ((await request.json().catch(() => ({}))) as Record<string, unknown>);
    const path = url.pathname;
    if (path.startsWith("/api/v1/")) {
      if (!key || key === "chave-recusada-exemplo") return json({ error: "unauthorized" }, 401);
      if (path === "/api/v1/profile") {
        return json({ id: 7, name: "Ana Martins", email: "ana@exemplo.com.br", accounts: [{ id: 1, role: key === "chave-atendente-exemplo" ? "agent" : "administrator" }] });
      }
      if (key === "chave-atendente-exemplo") return json({ error: "unauthorized" }, 401);
      if (path === "/api/v1/accounts/1/inboxes" && request.method === "POST") {
        const inboxId = id();
        const channel = (body.channel ?? {}) as Record<string, unknown>;
        sim.inboxes.set(inboxId, {
          identifier: `caixa-${inboxId}-exemplo`,
          secret: `segredo-${inboxId}-exemplo`,
          hmacToken: `hmac-${inboxId}-exemplo`,
          webhookUrl: String(channel.webhook_url ?? ""),
          members: [],
          hmacMandatory: channel.hmac_mandatory === true,
        });
        return json(inboxJson(inboxId));
      }
      if (path === "/api/v1/accounts/1/inbox_members" && request.method === "PATCH") {
        const inbox = sim.inboxes.get(Number(body.inbox_id));
        if (!inbox) return json({ error: "not_found" }, 404);
        inbox.members = (body.user_ids as number[]) ?? [];
        return json({ payload: [] });
      }
      if (path === "/api/v1/accounts/1/agents") {
        return json([
          { id: 7, name: "Ana Martins", role: "administrator" },
          { id: 9, name: "Rafael Souza", role: "administrator" },
          { id: 11, name: "Bia Lopes", role: "agent" },
        ]);
      }
      const members = /^\/api\/v1\/accounts\/1\/inbox_members\/(\d+)$/.exec(path);
      if (members) {
        const inbox = sim.inboxes.get(Number(members[1]));
        return inbox ? json({ payload: inbox.members.map((member) => ({ id: member, name: member === 7 ? "Ana Martins" : "Bia Lopes", role: "agent" })) }) : json({ error: "not_found" }, 404);
      }
      const one = /^\/api\/v1\/accounts\/1\/inboxes\/(\d+)(\/reset_secret|\/rotate_hmac_token)?$/.exec(path);
      if (one) {
        const inboxId = Number(one[1]);
        const inbox = sim.inboxes.get(inboxId);
        if (!inbox) return json({ error: "not_found" }, 404);
        if (request.method === "DELETE") {
          sim.inboxes.delete(inboxId);
          return json({ message: "ok" });
        }
        if (one[2] === "/reset_secret") inbox.secret = `segredo-${inboxId}-${id()}-exemplo`;
        if (one[2] === "/rotate_hmac_token") inbox.hmacToken = `hmac-${inboxId}-${id()}-exemplo`;
        if (request.method === "PATCH") {
          const channel = (body.channel ?? {}) as Record<string, unknown>;
          if (typeof channel.webhook_url === "string") inbox.webhookUrl = channel.webhook_url;
          if (channel.hmac_mandatory === true) inbox.hmacMandatory = true;
        }
        return json(inboxJson(inboxId));
      }
      return json({ error: "not_found" }, 404);
    }
    const pub = /^\/public\/api\/v1\/inboxes\/([^/]+)(?:\/contacts(?:\/([^/]+)(?:\/conversations(?:\/(\d+)(?:\/(messages))?)?)?)?)?$/.exec(path);
    if (!pub) return json({ error: "not_found" }, 404);
    const [, identifier, sourceId, conversation, messages] = pub;
    const inboxEntry = [...sim.inboxes.entries()].find(([, inbox]) => inbox.identifier === identifier);
    if (!inboxEntry) return json({ error: "not_found" }, 404);
    const [inboxId, inbox] = inboxEntry;
    if (sourceId === undefined) {
      if (path.endsWith("/contacts") && request.method === "POST") {
        if (inbox.hmacMandatory && body.identifier_hash !== (await hmacSha256Hex(inbox.hmacToken, String(body.identifier)))) return json({ error: "hmac" }, 401);
        const source = crypto.randomUUID();
        sim.contacts.set(source, { identifier: String(body.identifier), inbox: inboxId, conversations: [] });
        return json({ source_id: source, id: id(), name: "Zuri" });
      }
      return json({ id: inboxId, name: "Zuri" });
    }
    const contact = sim.contacts.get(sourceId);
    if (!contact || contact.inbox !== inboxId) return json({ error: "not_found" }, 404);
    const hash = String(body.identifier_hash ?? url.searchParams.get("identifier_hash") ?? "");
    if (inbox.hmacMandatory && hash !== (await hmacSha256Hex(inbox.hmacToken, contact.identifier))) return json({ error: "hmac" }, 401);
    if (conversation === undefined) {
      if (request.method === "POST") {
        const display = id();
        contact.conversations.push(display);
        sim.messages.set(display, []);
        return json({ id: display, messages: [] });
      }
      return json(contact.conversations.map((display) => ({ id: display })));
    }
    const display = Number(conversation);
    const list = sim.messages.get(display);
    if (!list || !contact.conversations.includes(display)) return json({ error: "not_found" }, 404);
    if (messages === undefined) return json({ id: display, messages: [] });
    if (request.method === "GET") {
      const before = Number(url.searchParams.get("before") ?? Number.MAX_SAFE_INTEGER);
      return json(list.filter((message) => message.id < before).slice(-20));
    }
    const sent = { id: id(), content: String(body.content ?? ""), message_type: 0, sender: { id: 1, type: "contact", name: "Zuri" } };
    list.push(sent);
    // The Chatwoot posts the notice of every message after it answered the request.
    later(async () => {
      await notice(inboxId, display, sent);
      // The simulated owner reads the code in the app and answers it from their own account.
      const code = sim.code;
      if (sim.autoAnswer && code && asCode(code)) {
        sim.code = null;
        const reply = { id: id(), content: code, message_type: 1, sender: { id: 7, type: "user", name: "Ana Martins" } };
        list.push(reply);
        later(() => notice(inboxId, display, reply));
      }
    });
    return json(sent);
  };

  const agentSays = async (conversation: number, content: string, sender = { id: 7, name: "Ana Martins" }, options: { private?: boolean } = {}) => {
    const owner = [...sim.contacts.values()].find((contact) => contact.conversations.includes(conversation));
    const list = sim.messages.get(conversation);
    if (!owner || !list) throw new Error("no such conversation");
    const message = { id: id(), content, message_type: 1, sender: { ...sender, type: "user" } };
    // A private note never shows to the contact: the public API doesn't list it.
    if (!options.private) list.push(message);
    await notice(owner.inbox, conversation, message, options.private === true);
    return message.id;
  };

  return {
    sim,
    agentSays,
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request && init === undefined ? input : new Request(input, init);
      if (new URL(request.url).hostname === HOST && (request.url.includes("/public/api/v1/") || request.url.includes("/api/v1/profile") || /\/api\/v1\/accounts\/1\/(inbox_members|agents|inboxes\/\d+|inboxes$)/.test(request.url))) {
        if (new URL(request.url).pathname === "/api/v1/accounts/1/inboxes" && request.method === "GET") return base.fetch(request);
        return answer(request);
      }
      return base.fetch(request);
    }) as typeof fetch,
    resolve: base.resolve,
  };
}
