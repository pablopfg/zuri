import { CHATWOOT_OWNER_LIMITS, hmacSha256Hex, TELEGRAM_LIMITS } from "@zuri/shared";
import { describe, expect, it } from "vitest";
import { plausibleChatwootNotice } from "../src/gates/chatwoot-owner.ts";
import { ADMIN_KEY, ORIGIN, OWNER_ID, type OwnerWorld, withOwnerWorld } from "./chatwoot-owner-world.ts";

// What the QA review and the security audit of the owner's Chatwoot found, each kept fixed by a test
// (docs/planos/zuri-no-chatwoot.md, section 15). Ids: SEC-A5-xx-n from the audit, QA-n from the review.

const L = CHATWOOT_OWNER_LIMITS;
const HOUR = 3_600_000;
const setupInput = { origin: ORIGIN, accountId: 1, adminKey: ADMIN_KEY, ownerId: OWNER_ID };

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
const path = (request: Request) => new URL(request.url).pathname;
const readBack = (request: Request) => request.method === "GET" && /\/conversations\/\d+\/messages$/.test(path(request));
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
const keptLink = (world: OwnerWorld) => JSON.parse(world.state.get<string>("chatwoot_owner") as string) as { id: string; inboxId: number; conversationId: number; seen: string[] };
const inboxOf = (world: OwnerWorld) => world.chatwoot.sim.inboxes.get(keptLink(world).inboxId) as { secret: string; hmacToken: string; webhookUrl: string };
const sentByZuri = (world: OwnerWorld) => world.messages().filter((message) => message.message_type === 0).length;

/** Holds the read back of the next message until `release` is called: the window where other requests come in. */
function holdReadBack(world: OwnerWorld) {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  let reached: () => void = () => undefined;
  const waiting = new Promise<void>((done) => {
    reached = done;
  });
  const base = world.chatwoot.fetch;
  const restore = intercept(world, readBack, async (request) => {
    reached();
    await gate;
    restore();
    return base(request);
  });
  return { waiting, release };
}

describe("SEC-A5-xx-1: the read lock, as the bot's", () => {
  it("answers only 'destrave no app' after the hours without use, and the app opens it for 12 hours", async () => {
    await withOwnerWorld(async (world) => {
      await world.link();
      const lock = world.owner.status().readLock;
      expect(lock).toMatchObject({ locked: false, hours: TELEGRAM_LIMITS.readLockHours.default });
      // Just under the hours is still open; a second over locks it.
      world.clock.shift = 12 * HOUR - 1_000;
      expect(world.owner.status().readLock.locked).toBe(false);
      world.clock.shift = 12 * HOUR + 1_000;
      expect(world.owner.status().readLock).toMatchObject({ locked: true });
      await world.chatwoot.agentSays(world.conversationId(), "o que tem na minha agenda?");
      await world.settle();
      expect(world.runner.turns).toHaveLength(0);
      expect(world.messages().at(-1)?.content).toBe("A leitura está travada: passaram 12 h sem uso. Destrave no app para eu voltar a responder: https://zuri.exemplo.com.br/configuracoes/chatwoot");
      expect(world.owner.status().log[0]).toMatchObject({ event: "locked", ok: false });
      // Writing while locked never counts as use: still locked.
      expect(world.owner.status().readLock.locked).toBe(true);
      const opened = world.owner.unlock();
      expect(opened.readLock.locked).toBe(false);
      expect(Date.parse(opened.readLock.openUntil as string) - (Date.now() + world.clock.shift)).toBeGreaterThanOrEqual(TELEGRAM_LIMITS.unlockMs - 1_000);
      await world.chatwoot.agentSays(world.conversationId(), "o que tem na minha agenda?");
      await world.settle();
      expect(world.runner.turns).toHaveLength(1);
    });
  });

  it("uses the bot's hours, and a lockdown that ended locks it again whatever was open", async () => {
    await withOwnerWorld(async (world) => {
      await world.link();
      world.state.set("bot_read_lock_hours", 1);
      world.clock.shift = HOUR + 1_000;
      expect(world.owner.status().readLock).toMatchObject({ locked: true, hours: 1 });
      world.owner.unlock();
      expect(world.owner.status().readLock.locked).toBe(false);
      world.state.set("lockdown_exited_at", new Date(Date.now() + world.clock.shift + 1_000).toISOString());
      world.clock.shift += 2_000;
      expect(world.owner.status().readLock.locked).toBe(true);
      // A broken date fails closed.
      const link = JSON.parse(world.state.get<string>("chatwoot_owner") as string) as Record<string, unknown>;
      world.state.delete("lockdown_exited_at");
      world.state.set("chatwoot_owner", JSON.stringify({ ...link, lastUsedAt: "não é data", unlockedUntil: null }));
      expect(world.owner.status().readLock.locked).toBe(true);
    });
  });

  it("can't be unlocked before an account is confirmed", async () => {
    await withOwnerWorld(async (world) => {
      world.chatwoot.sim.autoAnswer = false;
      await world.owner.setup(setupInput);
      expect(() => world.owner.unlock()).toThrow(expect.objectContaining({ code: "CONFLICT" }));
      expect(world.owner.status().readLock).toEqual({ locked: false, openUntil: null, hours: 12 });
    });
  });
});

describe("SEC-A5-xx-2: the code shows only in the app", () => {
  it("never writes a new code or the one of 'Conectar outra conta' in the conversation", async () => {
    await withOwnerWorld(async (world) => {
      await world.link();
      world.chatwoot.sim.autoAnswer = false;
      const relinked = await world.owner.relink();
      const all = JSON.stringify([...world.chatwoot.sim.messages.values()]);
      expect(all).not.toContain(relinked.code);
      expect(world.messages().at(-1)?.content).toMatch(/^Para conectar, responda aqui, com a sua conta, o código que aparece no app da Zuri\./);
      // Whoever answers without the app's code gets nowhere.
      await world.chatwoot.agentSays(world.conversationId(), "ABCDEFGH", { id: 9, name: "Rafael Souza" });
      await world.settle();
      expect(world.owner.status().state).toBe("code");
    });
  });
});

describe("SEC-A5-xx-3 and QA-1: a notice acts once", () => {
  it("drops the same message signed again, and a notice of Zuri's own message never opens the vault", async () => {
    await withOwnerWorld(async (world) => {
      await world.link();
      await world.chatwoot.agentSays(world.conversationId(), "uma vez");
      await world.settle();
      expect(world.runner.turns).toHaveLength(1);
      expect(keptLink(world).seen.filter((entry) => entry.startsWith("m"))).not.toHaveLength(0);
      // Zuri's own message comes back; with no test waiting, nothing is opened for it.
      let opened = 0;
      const open = world.connections.openOwner.bind(world.connections);
      world.connections.openOwner = (row) => {
        opened++;
        return open(row);
      };
      const link = keptLink(world);
      const raw = JSON.stringify({ event: "message_created", id: 5, message_type: "incoming", private: false, inbox: { id: link.inboxId }, conversation: { id: link.conversationId } });
      expect(await world.owner.receive(link.id, raw, { signature: null, timestamp: null, delivery: null })).toBe(200);
      expect(opened).toBe(0);
    });
  });
});

describe("SEC-A5-xx-4, QA-3 and QA-4: the test", () => {
  it("is never failed by a forged notice, and a notice that doesn't come is a timeout, never changed secrets", async () => {
    await withOwnerWorld(async (world) => {
      await world.link();
      world.owner.testWaitMs = 300;
      const link = keptLink(world);
      // The Chatwoot doesn't send the test's notice: the test waits its time and says timeout.
      inboxOf(world).webhookUrl = "https://outro.exemplo.com.br/x";
      const running = world.owner.test();
      // Meanwhile someone posts junk to the return, with any message id.
      await sleep(50);
      const junk = JSON.stringify({ event: "message_created", id: 1, message_type: "incoming", inbox: { id: link.inboxId }, conversation: { id: link.conversationId } });
      expect(await world.owner.receive(link.id, junk, { signature: `sha256=${"0".repeat(64)}`, timestamp: String(Math.floor(Date.now() / 1000)), delivery: null })).toBe(401);
      const test = await running;
      expect(test.checks.at(-1)).toEqual({ check: "signature", ok: false, problem: "timeout" });
      expect(test.paused).toBeNull();
      expect(world.owner.status()).toMatchObject({ state: "on", pausedBy: null });
    });
  });

  it("pauses only when the notice of its own message comes with another signature", async () => {
    await withOwnerWorld(async (world) => {
      await world.link();
      inboxOf(world).secret = "trocado-no-chatwoot";
      const test = await world.owner.test();
      expect(test.checks.at(-1)).toMatchObject({ check: "signature", ok: false });
      expect(test.checks.at(-1)?.problem).toBeUndefined();
      expect(test.paused).toBe("signature");
    });
  });

  it("runs one at a time: a second one is refused and the channel stays on", async () => {
    await withOwnerWorld(async (world) => {
      await world.link();
      const [first, second] = await Promise.allSettled([world.owner.test(), world.owner.test()]);
      expect(first).toMatchObject({ status: "fulfilled", value: { ok: true, paused: null } });
      expect(second).toMatchObject({ status: "rejected", reason: { code: "CONFLICT", messageKey: "error.chatwootOwner.testing" } });
      expect(world.owner.status()).toMatchObject({ state: "on", pausedBy: null });
      // New secrets while a test runs: refused before anything changes in the Chatwoot.
      const secret = inboxOf(world).secret;
      const [, rotate] = await Promise.allSettled([world.owner.test(), world.owner.rotate(ADMIN_KEY)]);
      expect(rotate).toMatchObject({ status: "rejected", reason: { code: "CONFLICT" } });
      expect(inboxOf(world).secret).toBe(secret);
    });
  });
});

describe("QA-2: new secrets that stop in between", () => {
  it("keep the new signing secret at once, so the channel still hears the Chatwoot", async () => {
    await withOwnerWorld(async (world) => {
      await world.link();
      const inbox = inboxOf(world);
      const restore = intercept(world, (request) => path(request).endsWith("/rotate_hmac_token"), () => new Response(null, { status: 503 }));
      await expect(world.owner.rotate(ADMIN_KEY)).rejects.toMatchObject({ details: { step: "inbox", problem: "unavailable" } });
      restore();
      const kept = await world.connections.openOwner(world.connections.ownerRow() as never);
      expect(kept?.secret).toBe(inbox.secret);
      expect(kept?.hmacToken).toBe(inbox.hmacToken);
      await world.chatwoot.agentSays(world.conversationId(), "ainda me ouve?");
      await world.settle();
      expect(world.runner.turns).toHaveLength(1);
    });
  });
});

describe("QA-5: the contact's HMAC token changed in the Chatwoot", () => {
  it("pauses for new secrets and tells the owner, instead of going quiet", async () => {
    await withOwnerWorld(async (world) => {
      await world.link();
      inboxOf(world).hmacToken = "trocado-no-chatwoot";
      await world.chatwoot.agentSays(world.conversationId(), "oi");
      await world.settle();
      expect(world.runner.turns).toHaveLength(0);
      expect(world.owner.status()).toMatchObject({ state: "paused", pausedBy: "hmac" });
      expect(world.notices.at(-1)).toEqual({ kind: "chatwoot.paused", reason: "hmac" });
    });
  });
});

describe("QA-6: the lockdown leaves the channel mute in every state", () => {
  it("never takes the code nor answers it, and never opens a conversation again", async () => {
    await withOwnerWorld(async (world) => {
      world.chatwoot.sim.autoAnswer = false;
      const { code } = await world.owner.setup(setupInput);
      await world.settle();
      const before = sentByZuri(world);
      world.lockdown.active = true;
      await world.chatwoot.agentSays(world.conversationId(), code);
      await world.settle();
      expect(world.owner.status().state).toBe("code");
      expect(sentByZuri(world)).toBe(before);
      world.lockdown.active = false;
      world.chatwoot.sim.autoAnswer = true;
    });
    await withOwnerWorld(async (world) => {
      await world.link();
      const contact = [...world.chatwoot.sim.contacts.values()][0] as { conversations: number[] };
      const old = world.conversationId();
      world.chatwoot.sim.messages.delete(old);
      contact.conversations.unshift(7000);
      world.chatwoot.sim.messages.set(7000, []);
      world.lockdown.active = true;
      await world.chatwoot.agentSays(7000, "oi");
      await world.settle();
      expect(world.owner.status().log[0]?.event).not.toBe("recreated");
      expect(contact.conversations).toEqual([7000, old]);
      expect(world.notices).toEqual([]);
    });
  });
});

describe("QA-7: two setups at the same time", () => {
  it("make one inbox; the second is refused before anything goes out", async () => {
    await withOwnerWorld(async (world) => {
      world.chatwoot.sim.autoAnswer = false;
      const results = await Promise.allSettled([world.owner.setup(setupInput), world.owner.setup(setupInput)]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(results.find((result) => result.status === "rejected")).toMatchObject({ reason: { code: "CONFLICT" } });
      expect(world.chatwoot.sim.inboxes.size).toBe(1);
    });
  });
});

describe("Cloudflare review 1: writes after a wait on the network", () => {
  it("keep the switch turned off while the message was read back, and nothing goes out", async () => {
    await withOwnerWorld(async (world) => {
      await world.link();
      const hold = holdReadBack(world);
      await world.chatwoot.agentSays(world.conversationId(), "oi");
      await hold.waiting;
      world.owner.setEnabled(false);
      hold.release();
      await world.settle();
      expect(world.owner.status()).toMatchObject({ state: "paused", pausedBy: "owner" });
      expect(world.runner.turns).toHaveLength(0);
    });
  });

  it("never bring back a link forgotten while the message was read back", async () => {
    await withOwnerWorld(async (world) => {
      await world.link();
      const hold = holdReadBack(world);
      await world.chatwoot.agentSays(world.conversationId(), "oi");
      await hold.waiting;
      world.owner.forget();
      hold.release();
      await world.settle();
      expect(world.state.get("chatwoot_owner")).toBeUndefined();
      expect(world.owner.status().configured).toBe(false);
      expect(world.runner.turns).toHaveLength(0);
    });
  });

  it("keep a code asked again while the old one was checked: the old one no longer counts", async () => {
    await withOwnerWorld(async (world) => {
      world.chatwoot.sim.autoAnswer = false;
      const first = await world.owner.setup(setupInput);
      await world.settle();
      const hold = holdReadBack(world);
      await world.chatwoot.agentSays(world.conversationId(), first.code);
      await hold.waiting;
      await world.owner.newCode();
      hold.release();
      await world.settle();
      expect(world.owner.status().state).toBe("code");
    });
  });
});

describe("SEC-A9-xx-5: the Worker's first look at a notice", () => {
  it("takes only a signature that could be one, inside the 5 minutes", async () => {
    const now = Date.now();
    const ts = (ms: number) => String(Math.floor(ms / 1000));
    const signature = `sha256=${await hmacSha256Hex("k", "x")}`;
    expect(plausibleChatwootNotice(signature, ts(now), now)).toBe(true);
    expect(plausibleChatwootNotice(signature, ts(now - L.signatureSkewMs + 1_000), now)).toBe(true);
    expect(plausibleChatwootNotice(signature, ts(now - L.signatureSkewMs - 1_000), now)).toBe(false);
    expect(plausibleChatwootNotice(signature, ts(now + L.signatureSkewMs + 1_000), now)).toBe(false);
    expect(plausibleChatwootNotice(null, ts(now), now)).toBe(false);
    expect(plausibleChatwootNotice("sha256=zz", ts(now), now)).toBe(false);
    expect(plausibleChatwootNotice(signature, null, now)).toBe(false);
    expect(plausibleChatwootNotice(signature, "12.5", now)).toBe(false);
  });
});
