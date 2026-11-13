import { describe, expect, it } from "vitest";
import { ChatwootCallError, chatwootCall, cleanName, type OwnerCallDeps } from "../src/chatwoot/owner-client.ts";
import { ADMIN_KEY, ORIGIN, OWNER_ID, type OwnerWorld, withOwnerWorld } from "./chatwoot-owner-world.ts";
import { FakeNetwork } from "./flow-world.ts";

// The edges of the owner's Chatwoot: how each answer of the Chatwoot is read, and the paths that only fail.

function deps(network: FakeNetwork, max = 20): OwnerCallDeps & { used: () => number } {
  let used = 0;
  return {
    network,
    development: false,
    hosts: new Map(),
    meter: {
      room: (n) => used + n <= max,
      take: () => {
        used++;
      },
    },
    used: () => used,
  };
}

const call = (network: FakeNetwork, max?: number) => chatwootCall(ORIGIN, { method: "GET", path: "/api/v1/profile", adminKey: "k" }, deps(network, max));

function intercept(world: OwnerWorld, match: (request: Request) => boolean, answer: (request: Request) => Response | Promise<Response>) {
  const base = world.chatwoot.fetch;
  world.chatwoot.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request && init === undefined ? input : new Request(input, init);
    return match(request) ? answer(request) : base(request);
  }) as typeof fetch;
  return () => {
    world.chatwoot.fetch = base;
  };
}

describe("a call to the Chatwoot", () => {
  it("names each refusal by its status and never reads its body", async () => {
    const network = new FakeNetwork();
    for (const [status, problem] of [
      [401, "refused"],
      [403, "refused"],
      [404, "not_found"],
      [400, "rejected"],
      [422, "rejected"],
      [429, "unavailable"],
      [500, "unavailable"],
      [301, "redirect"],
    ] as const) {
      network.handlers.set("chat.exemplo.com.br", () => new Response("eco da chave k", { status, headers: status === 301 ? { location: "/x" } : {} }));
      await expect(call(network)).rejects.toMatchObject({ problem, status });
    }
  });

  it("reads JSON up to its limit; an empty answer is null, anything else is bad_answer or too_large", async () => {
    const network = new FakeNetwork();
    network.handlers.set("chat.exemplo.com.br", () => new Response(""));
    expect(await call(network)).toEqual({ status: 200, body: null });
    network.handlers.set("chat.exemplo.com.br", () => new Response("<html>"));
    await expect(call(network)).rejects.toMatchObject({ problem: "bad_answer" });
    network.handlers.set("chat.exemplo.com.br", () => new Response(`"${"a".repeat(300 * 1024)}"`));
    await expect(call(network)).rejects.toMatchObject({ problem: "too_large" });
  });

  it("is unavailable when the network fails, a timeout when it gives up, and checks the host once per request", async () => {
    const network = new FakeNetwork();
    // No handler: the fetch throws.
    await expect(call(network)).rejects.toMatchObject({ problem: "unavailable" });
    network.handlers.set("chat.exemplo.com.br", () => {
      throw new DOMException("late", "TimeoutError");
    });
    await expect(call(network)).rejects.toMatchObject({ problem: "timeout" });
    network.handlers.set("chat.exemplo.com.br", () => Response.json({}));
    const same = deps(network);
    await chatwootCall(ORIGIN, { method: "GET", path: "/a" }, same);
    await chatwootCall(ORIGIN, { method: "GET", path: "/b" }, same);
    // Two lookups (A and AAAA) once, plus the two calls.
    expect(same.used()).toBe(4);
    network.resolve = async () => {
      throw new Error("SERVFAIL");
    };
    await expect(call(network)).rejects.toMatchObject({ problem: "dns" });
  });

  it("stops at the request's count of calls, before anything goes out", async () => {
    const network = new FakeNetwork();
    network.handlers.set("chat.exemplo.com.br", () => Response.json({}));
    await expect(call(network, 1)).rejects.toMatchObject({ problem: "calls_limit" });
    await expect(call(network, 2)).rejects.toMatchObject({ problem: "calls_limit" });
    expect(network.requests).toHaveLength(0);
    expect((await call(network, 3)).status).toBe(200);
  });

  it("never leaves the address given, and cleans names", async () => {
    const network = new FakeNetwork();
    await expect(chatwootCall(ORIGIN, { method: "GET", path: "https://outro.exemplo.com.br/x" }, deps(network))).rejects.toBeInstanceOf(ChatwootCallError);
    await expect(chatwootCall(ORIGIN, { method: "GET", path: "//outro.exemplo.com.br/x" }, deps(network))).rejects.toMatchObject({ problem: "origin" });
    expect(network.requests).toHaveLength(0);
    expect(cleanName("  Ana\u0000‮  Martins ")).toBe("Ana Martins");
    expect([...cleanName("a".repeat(200))]).toHaveLength(80);
  });
});

describe("the owner's channel, when things fail", () => {
  it("reports the kept access unreadable and refuses what needs it", async () => {
    await withOwnerWorld(async (world) => {
      await world.link();
      world.db.run(`UPDATE zur_flow_connections SET credential = 'estragado'`);
      await expect(world.owner.test()).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
      await expect(world.owner.relink()).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
      // A notice can't be checked without the secret: dropped quietly.
      expect(await world.owner.receive(JSON.parse(world.state.get<string>("chatwoot_owner") as string).id, "{}", { signature: null, timestamp: null, delivery: null })).toBe(200);
      // Repair makes the access again from the Chatwoot.
      await world.owner.repair({ adminKey: ADMIN_KEY });
      expect((await world.owner.test()).ok).toBe(true);
    });
  });

  it("asks for Repair first when the pause needs it, and the switch does nothing to a link not confirmed", async () => {
    await withOwnerWorld(async (world) => {
      await world.owner.setup({ origin: ORIGIN, accountId: 1, adminKey: ADMIN_KEY, ownerId: OWNER_ID });
      expect(world.owner.setEnabled(false)).toMatchObject({ state: "code" });
      expect(() => world.owner.setEnabled(true)).toThrow(expect.objectContaining({ code: "CONFLICT" }));
      await world.settle();
      world.owner.confirm();
      const inbox = world.chatwoot.sim.inboxes.get(world.owner.status().inboxId as number) as { secret: string };
      inbox.secret = "trocado";
      await world.owner.test();
      await expect(world.owner.relink()).rejects.toMatchObject({ code: "CONFLICT" });
    });
  });

  it("says which step stopped when new secrets are refused, and the test stops where it can't go on", async () => {
    await withOwnerWorld(async (world) => {
      await world.link();
      await expect(world.owner.rotate("chave-recusada-exemplo")).rejects.toMatchObject({ details: { step: "inbox", problem: "refused", undone: false } });
      await expect(world.owner.fullTest("chave-recusada-exemplo")).resolves.toMatchObject({
        ok: false,
        checks: expect.arrayContaining([expect.objectContaining({ check: "webhook", ok: false, problem: "refused" })]),
      });
      // The conversation gone: the test stops there, without sending its message.
      const restore = intercept(world, (request) => request.method === "GET" && /\/conversations\/\d+$/.test(new URL(request.url).pathname), () => new Response(null, { status: 404 }));
      const test = await world.owner.test();
      expect(test.checks.at(-1)).toMatchObject({ check: "conversation", ok: false });
      expect(test.paused).toBeNull();
      restore();
      // The Chatwoot down: only "reach", failed.
      intercept(world, () => true, () => new Response(null, { status: 502 }));
      expect((await world.owner.test()).checks).toEqual([{ check: "reach", ok: false, problem: "unavailable" }]);
    });
  });

  it("opens the conversation again when sending the answer finds it gone", async () => {
    await withOwnerWorld(async (world) => {
      await world.link();
      let refused = 0;
      intercept(
        world,
        (request) => request.method === "POST" && /\/messages$/.test(new URL(request.url).pathname) && refused === 0,
        () => {
          refused++;
          return new Response(null, { status: 404 });
        },
      );
      const before = world.conversationId();
      await world.chatwoot.agentSays(before, "oi");
      await world.settle();
      expect(world.conversationId()).not.toBe(before);
      expect(world.messages().map((message) => message.content)).toEqual(["A conversa anterior sumiu, então abri esta. Pode escrever aqui.", "Olá, Ana."]);
    });
  });

  it("ignores an empty message, and nothing goes out when the link was forgotten during the turn", async () => {
    await withOwnerWorld(async (world) => {
      await world.link();
      await world.chatwoot.agentSays(world.conversationId(), "   ");
      await world.settle();
      expect(world.runner.turns).toHaveLength(0);
      let release: () => void = () => undefined;
      world.runner.hold = new Promise((done) => {
        release = done;
      });
      const count = world.messages().length;
      await world.chatwoot.agentSays(world.conversationId(), "oi");
      await new Promise((done) => setTimeout(done, 200));
      world.owner.forget();
      release();
      await world.settle(0);
      expect(world.messages()).toHaveLength(count + 1);
    });
  });

  it("checks the link's conversation when someone writes in another one, and leaves it when it is there", async () => {
    await withOwnerWorld(async (world) => {
      await world.link();
      const before = world.conversationId();
      const contact = [...world.chatwoot.sim.contacts.values()][0] as { conversations: number[] };
      // Another conversation of the same contact (kept first, so the helper still finds the link's).
      contact.conversations.unshift(7000);
      world.chatwoot.sim.messages.set(7000, []);
      await world.chatwoot.agentSays(7000, "oi");
      await world.settle();
      expect(world.owner.status().log[0]?.event).not.toBe("recreated");
      expect(world.conversationId()).toBe(before);
      expect(world.notices).toEqual([]);
    });
  });
});
