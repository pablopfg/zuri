import { OUTBOX_LIMITS, outboxListQuerySchema } from "@zuri/shared";
import { describe, expect, it } from "vitest";
import { phoneVariants } from "../src/flows/chatwoot.ts";
import { inWake, WAKE_NOTICE_RESERVE, WAKE_SUBREQUESTS, WakeBudget } from "../src/agent/wake-budget.ts";
import { Outbox, type OutboxInput, type OutboxNotice, OutboxRefused, uniformBelow } from "../src/crm/outbox.ts";
import { type FlowWorld, withFlowWorld } from "./flow-world.ts";

// PR S19: the outbox. One message at a time per Chatwoot credential, the credential's gap apart, and never twice.

const HOST = "chat.exemplo.com.br";
const MINUTE = 60_000;

interface Chatwoot {
  contacts: { id: number; phone_number: string; custom_attributes?: Record<string, unknown> }[];
  conversations: { id: number; inbox_id: number; status: string; contact: number }[];
  messages: { id: number; conversation: number; content: string; message_type: number; created_at: number }[];
  /** What the next requests answer instead, in order, matched by method and the end of the path. */
  faults: { method: string; path: RegExp; answer: () => Response | Promise<Response> }[];
  /** Milliseconds each answer takes (the test's clock moves by it). */
  delay: number;
}

interface World extends FlowWorld {
  outbox: Outbox;
  told: OutboxNotice[];
  chatwoot: string;
  cw: Chatwoot;
  /** Another service on the same tables: a second wake at the same time. */
  other(): Outbox;
}

function withWorld<T>(fn: (world: World) => T | Promise<T>): Promise<T> {
  return withFlowWorld(async (base) => {
    const cw: Chatwoot = { contacts: [], conversations: [], messages: [], faults: [], delay: 0 };
    base.network.handlers.set(HOST, async (request) => {
      const url = new URL(request.url);
      base.clock.now += cw.delay;
      const fault = cw.faults.findIndex((entry) => entry.method === request.method && entry.path.test(url.pathname));
      if (fault >= 0) return (cw.faults.splice(fault, 1)[0] as Chatwoot["faults"][number]).answer();
      const path = url.pathname.replace("/api/v1/accounts/3", "");
      if (path === "/contacts/search") {
        const q = url.searchParams.get("q") ?? "";
        return Response.json({ payload: cw.contacts.filter((contact) => contact.phone_number.replace(/\D/g, "").endsWith(q)) });
      }
      if (path === "/contacts" && request.method === "POST") {
        const body = (await request.json()) as { phone_number: string };
        const id = 100 + cw.contacts.length;
        cw.contacts.push({ id, phone_number: body.phone_number });
        return Response.json({ payload: { contact: { id } } });
      }
      const conversations = /^\/contacts\/(\d+)\/conversations$/.exec(path);
      if (conversations) return Response.json({ payload: cw.conversations.filter((item) => item.contact === Number(conversations[1])) });
      if (path === "/conversations" && request.method === "POST") {
        const body = (await request.json()) as { inbox_id: number; contact_id: number };
        const id = 200 + cw.conversations.length;
        cw.conversations.push({ id, inbox_id: body.inbox_id, status: "open", contact: body.contact_id });
        return Response.json({ id });
      }
      const messages = /^\/conversations\/(\d+)\/messages$/.exec(path);
      if (messages) {
        const conversation = Number(messages[1]);
        if (request.method === "GET") return Response.json({ payload: cw.messages.filter((item) => item.conversation === conversation) });
        const body = (await request.json()) as { content: string };
        const id = 300 + cw.messages.length;
        cw.messages.push({ id, conversation, content: body.content, message_type: 1, created_at: Math.floor(base.clock.now / 1000) });
        return Response.json({ id });
      }
      return Response.json({ error: "not_found" }, { status: 404 });
    });
    const chatwoot = await base.connections.create(
      { kind: "chatwoot", name: "Chatwoot do consultório", origin: `https://${HOST}`, accountId: 3, credential: "chave-do-agente-zuri-4f2a" },
      { development: false },
    );
    base.db.run(`UPDATE zur_flow_connections SET meta = json_set(meta, '$.inboxId', 7, '$.inboxName', 'WhatsApp') WHERE id = ?`, chatwoot);
    const told: OutboxNotice[] = [];
    const make = () =>
      new Outbox({
        db: base.db,
        connections: base.connections,
        callDeps: (calls) => base.flows.automationCallDeps(calls),
        timeZone: () => "America/Sao_Paulo",
        lockdown: () => base.lockdown.active,
        notify: (notice) => told.push(notice),
        clock: () => base.clock.now,
        random: () => 0,
      });
    return fn({ ...base, outbox: make(), told, chatwoot, cw, other: make });
  });
}

let keys = 0;
function input(world: World, patch: Partial<OutboxInput> = {}): OutboxInput {
  keys++;
  return { automationId: "review-request", connectionId: world.chatwoot, key: `2026-11-03:${keys}`, label: `Pessoa ${keys}`, phone: `+5511987650${String(keys).padStart(3, "0")}`, text: `Olá, Pessoa ${keys}`, bulk: true, ...patch };
}

const sends = (world: World) => world.network.requests.filter((request) => request.method === "POST" && /\/messages$/.test(new URL(request.url).pathname));
const job = (world: World, id: string) => world.db.one<Record<string, unknown>>(`SELECT * FROM zur_outbox WHERE id = ?`, id);
const only = (world: World) => world.db.one<Record<string, unknown>>(`SELECT * FROM zur_outbox ORDER BY created_at LIMIT 1`) as Record<string, unknown>;
const queue = (world: World) => world.db.one<Record<string, unknown>>(`SELECT * FROM zur_outbox_queues WHERE connection_id = ?`, world.chatwoot) as Record<string, unknown>;
const steps = (world: World, id: string) => world.db.all<{ kind: string }>(`SELECT kind FROM zur_outbox_steps WHERE outbox_id = ? ORDER BY id`, id).map((step) => step.kind);
const timeout = () => Promise.reject(new DOMException("timed out", "TimeoutError"));

describe("enqueue", () => {
  it("takes a key once; the same key again is skipped, never a second row", () =>
    withWorld((world) => {
      const first = input(world);
      expect(world.outbox.enqueue(first)).toBe("queued");
      expect(world.outbox.enqueue({ ...first, text: "Outro texto" })).toBe("skipped");
      expect(world.db.one<{ n: number }>(`SELECT count(*) AS n FROM zur_outbox`)?.n).toBe(1);
      // Another automation may use the same key: keys are its own.
      expect(world.outbox.enqueue({ ...first, automationId: "birthday" })).toBe("queued");
    }));

  it("refuses what it never takes: phone out of E.164, empty or too long text (n, n+1), a window already over", () =>
    withWorld((world) => {
      expect(() => world.outbox.enqueue(input(world, { phone: "11987654321" }))).toThrow(OutboxRefused);
      expect(() => world.outbox.enqueue(input(world, { text: "   " }))).toThrow(OutboxRefused);
      expect(world.outbox.enqueue(input(world, { text: "a".repeat(OUTBOX_LIMITS.text) }))).toBe("queued");
      expect(() => world.outbox.enqueue(input(world, { text: "a".repeat(OUTBOX_LIMITS.text + 1) }))).toThrow(OutboxRefused);
      expect(() => world.outbox.enqueue(input(world, { notAfter: new Date(world.clock.now - 1).toISOString() }))).toThrow(OutboxRefused);
      expect(() => world.outbox.enqueue(input(world, { label: "\u0000​" }))).toThrow(OutboxRefused);
    }));

  it("holds 60 new messages a day for all automations together (60 queued, the 61st waits for tomorrow)", () =>
    withWorld((world) => {
      for (let n = 0; n < OUTBOX_LIMITS.perDay; n++) expect(world.outbox.enqueue(input(world, { automationId: n % 2 ? "birthday" : "review-request" }))).toBe("queued");
      expect(world.outbox.enqueue(input(world))).toBe("cap");
      world.clock.now += 24 * 60 * MINUTE;
      expect(world.outbox.enqueue(input(world))).toBe("queued");
    }));
});

describe("sending", () => {
  it("finds or creates the contact and the conversation, sends, and forgets the text and the phone", () =>
    withWorld(async (world) => {
      world.outbox.enqueue(input(world));
      expect(await world.outbox.tick()).toBe(true);
      const sent = only(world);
      expect(sent).toMatchObject({ status: "sent", grp: "sent", attempts: 1, phone: null, text: null, contact_id: 100, conversation_id: 200, message_id: 300 });
      expect(world.cw.messages).toHaveLength(1);
      expect(steps(world, sent.id as string)).toEqual(["queued", "sent"]);
      expect(world.db.one(`SELECT sent, failed, skipped, ms_n FROM zur_outbox_days`)).toEqual({ sent: 1, failed: 0, skipped: 0, ms_n: 1 });
      // Never the key in the logs of the calls: the account is the credential's own.
      for (const request of world.network.requests) expect(new URL(request.url).pathname.startsWith("/api/v1/accounts/3/")).toBe(true);
    }));

  it("one message per credential, the bulk gap apart (n−1 s waits, n s sends); one person's gap is the shorter one", () =>
    withWorld(async (world) => {
      world.outbox.enqueue(input(world));
      world.outbox.enqueue(input(world));
      await world.outbox.tick();
      expect(sends(world)).toHaveLength(1);
      await world.outbox.tick();
      expect(sends(world)).toHaveLength(1);
      // The draw is 0: the gap's "from", 30 s by default.
      world.clock.now += 29_000;
      await world.outbox.tick();
      expect(sends(world)).toHaveLength(1);
      world.clock.now += 1_000;
      expect(world.outbox.nextDue()).toBe(new Date(world.clock.now).toISOString());
      await world.outbox.tick();
      expect(sends(world)).toHaveLength(2);
      world.clock.now += 30_000;
      world.outbox.enqueue(input(world, { bulk: false }));
      await world.outbox.tick();
      world.outbox.enqueue(input(world, { bulk: false }));
      world.clock.now += 1_999;
      await world.outbox.tick();
      expect(sends(world)).toHaveLength(3);
      world.clock.now += 1;
      await world.outbox.tick();
      expect(sends(world)).toHaveLength(4);
    }));

  it("a confirmation goes before a review request queued earlier", () =>
    withWorld(async (world) => {
      const review = input(world);
      world.outbox.enqueue(review);
      world.clock.now += 1_000;
      const confirmation = input(world, { automationId: "appointment-confirmation" });
      world.outbox.enqueue(confirmation);
      expect(world.outbox.status().queue.map((item) => item.label)).toEqual([confirmation.label, review.label]);
      await world.outbox.tick();
      expect(world.cw.messages[0]?.content).toBe(confirmation.text);
    }));

  it("two wakes at once: only one wins the reservation, one message goes", () =>
    withWorld(async (world) => {
      world.outbox.enqueue(input(world));
      world.outbox.enqueue(input(world));
      await Promise.all([world.outbox.tick(), world.other().tick(), world.other().tick()]);
      expect(sends(world)).toHaveLength(1);
      expect(world.db.one<{ n: number }>(`SELECT count(*) AS n FROM zur_outbox WHERE status = 'queued'`)?.n).toBe(1);
    }));

  it("a second wake that reads the same free time in the middle of the first: the reservation and the claim let only one through", () =>
    withWorld(async (world) => {
      world.outbox.enqueue(input(world));
      world.outbox.enqueue(input(world));
      let inner: Promise<boolean> | null = null;
      // The other wake runs right after this one read the queue and before it reserves: both saw the same free time.
      const racing = new Outbox({
        db: world.db,
        connections: {
          find: (id) => {
            inner ??= world.other().tick();
            return world.connections.find(id);
          },
          fixed: (...args) => world.connections.fixed(...args),
        },
        callDeps: (calls) => world.flows.automationCallDeps(calls),
        timeZone: () => "America/Sao_Paulo",
        lockdown: () => false,
        notify: () => {},
        clock: () => world.clock.now,
        random: () => 0,
      });
      expect(await racing.tick()).toBe(false);
      expect(await inner).toBe(true);
      expect(sends(world)).toHaveLength(1);
      expect(world.db.one<{ n: number }>(`SELECT count(*) AS n FROM zur_outbox WHERE status = 'queued' AND attempts = 0`)?.n).toBe(1);
    }));

  it("doesn't wait the gap when nothing has gone yet, and waits it after a failure too", () =>
    withWorld(async (world) => {
      world.cw.faults.push({ method: "GET", path: /search$/, answer: () => new Response("x", { status: 500 }) });
      world.outbox.enqueue(input(world));
      world.outbox.enqueue(input(world));
      await world.outbox.tick();
      expect(queue(world).next_free_at).toBe(new Date(world.clock.now + 30_000).toISOString());
      await world.outbox.tick();
      expect(sends(world)).toHaveLength(0);
    }));

  it("finds the contact by either form of a Brazilian mobile (with and without the 9th digit)", () =>
    withWorld(async (world) => {
      expect(phoneVariants("+5511987654321")).toEqual(["5511987654321", "551187654321"]);
      expect(phoneVariants("+551187654321")).toEqual(["551187654321", "5511987654321"]);
      expect(phoneVariants("+551133334444")).toEqual(["551133334444"]);
      world.cw.contacts.push({ id: 55, phone_number: "+551187654321" });
      world.outbox.enqueue(input(world, { phone: "+5511987654321" }));
      await world.outbox.tick();
      expect(only(world)).toMatchObject({ status: "sent", contact_id: 55 });
      expect(world.cw.contacts).toHaveLength(1);
    }));

  it("a contact marked crmBloqueado in the Chatwoot never gets it", () =>
    withWorld(async (world) => {
      world.cw.contacts.push({ id: 56, phone_number: "+5511987654322", custom_attributes: { crmBloqueado: true } });
      world.outbox.enqueue(input(world, { phone: "+5511987654322" }));
      await world.outbox.tick();
      expect(only(world)).toMatchObject({ status: "blocked", grp: "skipped", text: null, phone: null });
      expect(sends(world)).toHaveLength(0);
    }));

  it("reuses the open conversation in the credential's inbox, never one of another inbox or a resolved one", () =>
    withWorld(async (world) => {
      world.cw.contacts.push({ id: 57, phone_number: "+5511987654323" });
      world.cw.conversations.push({ id: 900, inbox_id: 8, status: "open", contact: 57 }, { id: 901, inbox_id: 7, status: "resolved", contact: 57 }, { id: 902, inbox_id: 7, status: "open", contact: 57 });
      world.outbox.enqueue(input(world, { phone: "+5511987654323" }));
      await world.outbox.tick();
      expect(only(world)).toMatchObject({ status: "sent", conversation_id: 902 });
    }));
});

describe("nothing twice", () => {
  it("no answer to the message's POST: checked before trying again, and found there it is never sent again", () =>
    withWorld(async (world) => {
      world.outbox.enqueue(input(world));
      // The Chatwoot keeps the message but the answer never comes back.
      world.cw.faults.push({
        method: "POST",
        path: /messages$/,
        answer: async () => {
          world.cw.messages.push({ id: 777, conversation: 200, content: (only(world).text as string) ?? "", message_type: 1, created_at: Math.floor(world.clock.now / 1000) });
          return timeout();
        },
      });
      await world.outbox.tick();
      const row = only(world);
      expect(row).toMatchObject({ status: "checking", attempts: 1 });
      expect(steps(world, row.id as string)).toEqual(["queued", "uncertain"]);
      world.clock.now += 2 * MINUTE;
      await world.outbox.tick();
      expect(only(world)).toMatchObject({ status: "sent", message_id: 777, text: null });
      expect(steps(world, row.id as string)).toEqual(["queued", "uncertain", "found_sent"]);
      expect(world.cw.messages).toHaveLength(1);
    }));

  it("a 5xx to the POST that really didn't keep it: checked, not found, sent once on the second try", () =>
    withWorld(async (world) => {
      world.outbox.enqueue(input(world));
      world.cw.faults.push({ method: "POST", path: /messages$/, answer: () => new Response("x", { status: 502 }) });
      await world.outbox.tick();
      world.clock.now += 2 * MINUTE - 1;
      await world.outbox.tick();
      expect(only(world).status).toBe("checking");
      world.clock.now += 1;
      await world.outbox.tick();
      expect(only(world)).toMatchObject({ status: "sent", attempts: 2 });
      expect(world.cw.messages).toHaveLength(1);
    }));

  it("a 4xx to the POST is a clear no: a failed try, sent on the next without checking", () =>
    withWorld(async (world) => {
      world.outbox.enqueue(input(world));
      world.cw.faults.push({ method: "POST", path: /messages$/, answer: () => new Response("x", { status: 422 }) });
      await world.outbox.tick();
      expect(only(world)).toMatchObject({ status: "queued", attempts: 1 });
    }));

  it("an object that stopped mid-send: 'sending' for 2 minutes becomes 'checking', then is looked for", () =>
    withWorld(async (world) => {
      world.outbox.enqueue(input(world));
      const id = only(world).id as string;
      world.db.run(`UPDATE zur_outbox SET status = 'sending', attempts = 1, sending_at = ? WHERE id = ?`, new Date(world.clock.now).toISOString(), id);
      expect(world.outbox.nextDue()).toBe(new Date(world.clock.now + 2 * MINUTE).toISOString());
      world.clock.now += 2 * MINUTE - 1;
      await world.outbox.tick();
      expect(job(world, id)?.status).toBe("sending");
      world.clock.now += 2;
      await world.outbox.tick();
      expect(steps(world, id)).toContain("uncertain");
      expect(job(world, id)?.status).toBe("sent");
      expect(world.cw.messages).toHaveLength(1);
    }));

  it("an uncertain third try is only checked, never sent a fourth time", () =>
    withWorld(async (world) => {
      world.outbox.enqueue(input(world));
      const id = only(world).id as string;
      for (let n = 0; n < 3; n++) world.cw.faults.push({ method: "POST", path: /messages$/, answer: () => new Response("x", { status: 503 }) });
      await world.outbox.tick();
      for (const wait of [2, 4, 4]) {
        world.clock.now += wait * MINUTE;
        world.db.run(`UPDATE zur_outbox_queues SET failed_streak = 0, last_failed_id = NULL`);
        await world.outbox.tick();
      }
      expect(job(world, id)).toMatchObject({ status: "failed", attempts: 3 });
      expect(sends(world)).toHaveLength(3);
      expect(world.told).toContainEqual({ kind: "failed", automationId: "review-request" });
    }));
});

describe("failures", () => {
  it("3 tries, 2 and 4 minutes apart; then 'Falhou', a notice, and 'Tentar de novo' puts it back with the same key", () =>
    withWorld(async (world) => {
      world.outbox.enqueue(input(world));
      const id = only(world).id as string;
      for (let n = 0; n < 3; n++) world.cw.faults.push({ method: "GET", path: /search$/, answer: () => new Response("x", { status: 500 }) });
      await world.outbox.tick();
      expect(job(world, id)).toMatchObject({ status: "queued", attempts: 1, available_at: new Date(world.clock.now + 2 * MINUTE).toISOString() });
      world.clock.now += 2 * MINUTE;
      await world.outbox.tick();
      expect(job(world, id)).toMatchObject({ attempts: 2, available_at: new Date(world.clock.now + 4 * MINUTE).toISOString() });
      world.clock.now += 4 * MINUTE;
      await world.outbox.tick();
      expect(job(world, id)).toMatchObject({ status: "failed", grp: "failed", attempts: 3 });
      expect(job(world, id)?.text).not.toBeNull();
      expect(world.told).toEqual([{ kind: "failed", automationId: "review-request" }]);
      expect(world.outbox.detail(id).canRetry).toBe(true);
      expect(world.db.one(`SELECT failed FROM zur_outbox_days`)).toEqual({ failed: 1 });
      world.outbox.retry(id);
      expect(world.db.one(`SELECT failed FROM zur_outbox_days`)).toEqual({ failed: 0 });
      expect(() => world.outbox.retry(id)).toThrow(expect.objectContaining({ code: "CONFLICT", messageKey: "error.outboxNoRetry" }));
      expect(world.db.all<{ kind: string }>(`SELECT kind FROM zur_activity WHERE kind = 'crm.outbox_retried'`)).toHaveLength(1);
      world.clock.now += MINUTE;
      await world.outbox.tick();
      expect(job(world, id)?.status).toBe("sent");
      expect(steps(world, id)).toEqual(["queued", "failed_try", "failed_try", "failed_try", "gave_up", "retried", "sent"]);
    }));

  it("one message failing its tries doesn't stop the queue; two different ones in a row do, with a notice", () =>
    withWorld(async (world) => {
      const fail = () => world.cw.faults.push({ method: "GET", path: /search$/, answer: () => new Response("x", { status: 500 }) });
      world.outbox.enqueue(input(world));
      fail();
      fail();
      await world.outbox.tick();
      world.clock.now += 2 * MINUTE;
      await world.outbox.tick();
      expect(queue(world)).toMatchObject({ stopped_at: null, failed_streak: 1 });
      world.outbox.enqueue(input(world));
      fail();
      world.clock.now += 30_000;
      await world.outbox.tick();
      expect(queue(world)).toMatchObject({ stopped_reason: "failures" });
      expect(world.told).toContainEqual({ kind: "stopped", connectionId: world.chatwoot, name: "Chatwoot do consultório", reason: "failures" });
      expect(world.outbox.status()).toMatchObject({ state: "stopped", stopReason: "failures" });
      world.clock.now += 10 * MINUTE;
      await world.outbox.tick();
      expect(sends(world)).toHaveLength(0);
      expect(world.outbox.stopped()).toBe(true);
      world.outbox.resume();
      expect(world.outbox.stopped()).toBe(false);
      // The first message after "Retomar" still waits the smallest bulk gap.
      await world.outbox.tick();
      expect(sends(world)).toHaveLength(0);
      world.clock.now += 30_000;
      await world.outbox.tick();
      expect(sends(world)).toHaveLength(1);
    }));

  it("a refused key stops at once, without spending the message's try", () =>
    withWorld(async (world) => {
      world.outbox.enqueue(input(world));
      world.cw.faults.push({ method: "GET", path: /search$/, answer: () => new Response("x", { status: 401 }) });
      await world.outbox.tick();
      expect(only(world)).toMatchObject({ status: "queued", attempts: 0 });
      expect(world.outbox.status()).toMatchObject({ state: "stopped", stopReason: "credential" });
      // A stopped queue asks no wake but the one its message loses its turn at (7 days on, SEC-A12-01).
      expect(world.outbox.nextDue()).toBe(new Date(world.clock.now + OUTBOX_LIMITS.maxWaitDays * 86_400_000).toISOString());
    }));

  it("an answer out of shape stops the queue (bad_answer)", () =>
    withWorld(async (world) => {
      world.outbox.enqueue(input(world));
      world.cw.faults.push({ method: "GET", path: /search$/, answer: () => Response.json({ payload: "nada" }) });
      await world.outbox.tick();
      expect(world.outbox.status().stopReason).toBe("bad_answer");
    }));

  it("a credential gone or without an inbox stops the queue as a credential problem", () =>
    withWorld(async (world) => {
      world.db.run(`UPDATE zur_flow_connections SET meta = json_remove(meta, '$.inboxId') WHERE id = ?`, world.chatwoot);
      world.outbox.enqueue(input(world));
      await world.outbox.tick();
      expect(world.outbox.status().stopReason).toBe("credential");
      world.outbox.resume();
      world.connections.remove(world.chatwoot);
      world.clock.now += 31_000;
      world.told.length = 0;
      await world.outbox.tick();
      expect(world.told[0]).toMatchObject({ kind: "stopped", reason: "credential" });
    }));

  it("slow: above 5 s on average over the last 5 answers, the gap doubles; it comes back by itself", () =>
    withWorld(async (world) => {
      world.cw.delay = 1_300;
      for (let n = 0; n < 7; n++) world.outbox.enqueue(input(world));
      for (let n = 0; n < 5; n++) {
        await world.outbox.tick();
        world.clock.now += 60_000;
      }
      // 4 calls of 1.3 s each for a new contact; the message's own POST took 1.3 s: not slow yet.
      expect(world.outbox.status().state).toBe("running");
      world.db.run(`UPDATE zur_outbox_queues SET recent_ms = '[5001,5001,5001,5001,5001]'`);
      expect(world.outbox.status()).toMatchObject({ state: "slow", averageMs: 5001 });
      world.cw.delay = 0;
      const before = world.clock.now;
      await world.outbox.tick();
      expect(queue(world).next_free_at).toBe(new Date(before + 60_000).toISOString());
      world.db.run(`UPDATE zur_outbox_queues SET recent_ms = '[5000,5000,5000,5000,5000]'`);
      expect(world.outbox.status().state).toBe("running");
    }));
});

describe("time, pause and lockdown", () => {
  it("a message that would lose its hour doesn't go: it becomes 'Não saiu', without its text", () =>
    withWorld(async (world) => {
      world.outbox.enqueue(input(world, { notAfter: new Date(world.clock.now + 15 * MINUTE).toISOString(), notBefore: new Date(world.clock.now + 10 * MINUTE).toISOString() }));
      world.outbox.enqueue(input(world, { notAfter: new Date(world.clock.now + 20 * MINUTE).toISOString() }));
      expect(world.outbox.nextDue()).toBe(new Date(world.clock.now).toISOString());
      world.db.run(`UPDATE zur_outbox_queues SET next_free_at = ?`, new Date(world.clock.now + 30 * MINUTE).toISOString());
      world.clock.now += 20 * MINUTE;
      await world.outbox.tick();
      expect(world.db.all(`SELECT status, grp, text FROM zur_outbox`)).toEqual([
        { status: "expired", grp: "skipped", text: null },
        { status: "expired", grp: "skipped", text: null },
      ]);
      expect(sends(world)).toHaveLength(0);
      expect(world.db.one(`SELECT skipped FROM zur_outbox_days`)).toEqual({ skipped: 2 });
    }));

  it("'Pausar envios' holds everything and no wake is asked for; resuming sends again", () =>
    withWorld(async (world) => {
      world.outbox.enqueue(input(world));
      world.outbox.pause();
      expect(world.outbox.status()).toMatchObject({ state: "paused", lockdown: false, waiting: 1 });
      // No wake while paused but the hour the message loses its turn, a week on.
      expect(world.outbox.nextDue()).toBe(new Date(world.clock.now + OUTBOX_LIMITS.maxWaitDays * 86_400_000).toISOString());
      expect(await world.outbox.tick()).toBe(false);
      expect(world.outbox.stopped()).toBe(false);
      world.outbox.resume();
      world.clock.now += 30_000;
      await world.outbox.tick();
      expect(sends(world)).toHaveLength(1);
      expect(world.db.all<{ kind: string }>(`SELECT kind FROM zur_activity WHERE kind LIKE 'crm.outbox%' ORDER BY id`).map((row) => row.kind)).toEqual(["crm.outbox_paused", "crm.outbox_resumed"]);
    }));

  it("S19-CF1: no room left in the wake: no reservation, no claim, nothing written; the next wake sends", () =>
    withWorld(async (world) => {
      world.outbox.enqueue(input(world));
      const before = queue(world).next_free_at ?? null;
      const tight = new WakeBudget();
      // Flows and automations went first: fewer than a send's 8 calls are left.
      tight.take(WAKE_SUBREQUESTS - WAKE_NOTICE_RESERVE - 7);
      expect(await inWake(tight, () => world.outbox.tick())).toBe(false);
      expect(only(world)).toMatchObject({ status: "queued", attempts: 0 });
      expect(queue(world)?.next_free_at ?? null).toBe(before);
      expect(world.network.requests).toHaveLength(0);
      expect(await inWake(new WakeBudget(), () => world.outbox.tick())).toBe(true);
      expect(sends(world)).toHaveLength(1);
    }));

  it("S19-CF3: 'Retomar envios' with nothing paused or stopped writes nothing and logs nothing", () =>
    withWorld(async (world) => {
      world.outbox.enqueue(input(world));
      await world.outbox.tick();
      const before = { ...queue(world) };
      world.outbox.resume();
      expect(queue(world)).toEqual(before);
      expect(world.db.one(`SELECT count(*) AS n FROM zur_activity WHERE kind = 'crm.outbox_resumed'`)).toEqual({ n: 0 });
    }));

  it("the lockdown holds everything without waking every minute", () =>
    withWorld(async (world) => {
      world.outbox.enqueue(input(world));
      world.lockdown.active = true;
      expect(world.outbox.nextDue()).toBeNull();
      expect(await world.outbox.tick()).toBe(false);
      expect(world.outbox.status()).toMatchObject({ state: "paused", lockdown: true });
      expect(world.network.requests).toHaveLength(0);
    }));

  it("a due message waiting 15 minutes with nothing going out: one notice, and again only after a message leaves", () =>
    withWorld(async (world) => {
      world.outbox.enqueue(input(world));
      world.db.run(`INSERT INTO zur_outbox_queues (connection_id, next_free_at, updated_at) VALUES (?, ?, ?) ON CONFLICT (connection_id) DO UPDATE SET next_free_at = excluded.next_free_at`, world.chatwoot, new Date(world.clock.now + 40 * MINUTE).toISOString(), new Date(world.clock.now).toISOString());
      world.clock.now += 15 * MINUTE - 1;
      await world.outbox.tick();
      expect(world.told).toEqual([]);
      world.clock.now += 1;
      await world.outbox.tick();
      await world.outbox.tick();
      expect(world.told).toEqual([{ kind: "stalled" }]);
      // It leaves; a new stall later is a new occurrence, told once more.
      world.db.run(`UPDATE zur_outbox_queues SET next_free_at = NULL`);
      await world.outbox.tick();
      expect(sends(world)).toHaveLength(1);
      world.outbox.enqueue(input(world));
      world.db.run(`UPDATE zur_outbox_queues SET next_free_at = ?`, new Date(world.clock.now + 40 * MINUTE).toISOString());
      world.clock.now += 15 * MINUTE;
      await world.outbox.tick();
      expect(world.told).toEqual([{ kind: "stalled" }, { kind: "stalled" }]);
    }));
});

describe("reading", () => {
  it("history by period and group, 50 a page with a cursor; no text and no phone in the answers", () =>
    withWorld(async (world) => {
      for (let n = 0; n < OUTBOX_LIMITS.page + 1; n++) {
        world.outbox.enqueue(input(world));
        world.clock.now += 1_000;
      }
      const first = world.outbox.list(outboxListQuerySchema.parse({}));
      expect(first.rows).toHaveLength(OUTBOX_LIMITS.page);
      expect(first.cursor).not.toBeNull();
      const second = world.outbox.list(outboxListQuerySchema.parse({ cursor: first.cursor }));
      expect(second.rows).toHaveLength(1);
      expect(second.cursor).toBeNull();
      expect(new Set([...first.rows, ...second.rows].map((row) => row.id)).size).toBe(OUTBOX_LIMITS.page + 1);
      await world.outbox.tick();
      const json = JSON.stringify([world.outbox.list(outboxListQuerySchema.parse({ period: "30d" })), world.outbox.status(), world.outbox.detail(first.rows[0]?.id as string)]);
      expect(json).not.toMatch(/\+5511|98765|Olá/);
      expect(world.outbox.list(outboxListQuerySchema.parse({ filter: "sent" })).rows).toHaveLength(1);
      expect(world.outbox.list(outboxListQuerySchema.parse({ filter: "failed" })).rows).toHaveLength(0);
      expect(world.outbox.list(outboxListQuerySchema.parse({})).counts).toMatchObject({ sent: 1, failed: 0, skipped: 0 });
    }));

  it("periods follow the owner's day: today starts at 00:00 in São Paulo, 7 days are today and the 6 before", () =>
    withWorld((world) => {
      // 2026-11-03 02:59 UTC is still 2026-11-02 in São Paulo.
      world.clock.now = Date.parse("2026-11-03T02:59:00.000Z");
      world.outbox.enqueue(input(world));
      world.clock.now = Date.parse("2026-11-03T03:00:00.000Z");
      world.outbox.enqueue(input(world));
      expect(world.outbox.list(outboxListQuerySchema.parse({ period: "today" })).rows).toHaveLength(1);
      expect(world.outbox.list(outboxListQuerySchema.parse({ period: "7d" })).rows).toHaveLength(2);
      world.clock.now += 6 * 24 * 60 * MINUTE;
      expect(world.outbox.list(outboxListQuerySchema.parse({ period: "7d" })).rows).toHaveLength(1);
      expect(world.outbox.list(outboxListQuerySchema.parse({ period: "30d" })).rows).toHaveLength(2);
    }));

  it("7 days are 7 calendar days even across a 23 h day (a time zone with daylight saving)", () =>
    withWorld((world) => {
      let now = 0;
      const ny = new Outbox({
        db: world.db,
        connections: world.connections,
        callDeps: (calls) => world.flows.automationCallDeps(calls),
        timeZone: () => "America/New_York",
        lockdown: () => false,
        notify: () => {},
        clock: () => now,
        random: () => 0,
      });
      // 09/03 23:30 and 10/03 00:30 in New York; the clocks go forward on 14/03.
      now = Date.parse("2027-03-10T04:30:00.000Z");
      ny.enqueue(input(world));
      now = Date.parse("2027-03-10T05:30:00.000Z");
      ny.enqueue(input(world));
      // 16/03 00:30 there: 7 days are 10/03 to 16/03, so only the second.
      now = Date.parse("2027-03-16T04:30:00.000Z");
      expect(ny.list(outboxListQuerySchema.parse({ period: "7d" })).rows).toHaveLength(1);
    }));

  it("the check finds the message even when the Chatwoot tidied its line endings", () =>
    withWorld(async (world) => {
      const text = "Olá,\r\nsua consulta é amanhã. ";
      world.outbox.enqueue(input(world, { text }));
      world.cw.faults.push({
        method: "POST",
        path: /\/messages$/,
        answer: () => {
          world.cw.messages.push({ id: 900, conversation: 200, content: "Olá,\nsua consulta é amanhã.", message_type: 1, created_at: Math.floor(world.clock.now / 1000) });
          return new Response("{}", { status: 502 });
        },
      });
      await world.outbox.tick();
      world.clock.now += 3 * MINUTE;
      await world.outbox.tick();
      expect(only(world)).toMatchObject({ status: "sent" });
      expect(world.cw.messages).toHaveLength(1);
    }));

  it("a conversation deleted in the Chatwoot: the 404 forgets it and the next try opens another", () =>
    withWorld(async (world) => {
      world.outbox.enqueue(input(world));
      world.cw.faults.push({ method: "POST", path: /\/messages$/, answer: () => new Response("{}", { status: 404 }) });
      await world.outbox.tick();
      expect(only(world)).toMatchObject({ status: "queued", conversation_id: null });
      // Gone in the Chatwoot too: the next try finds none open and opens one.
      world.cw.conversations.length = 0;
      world.clock.now += 3 * MINUTE;
      await world.outbox.tick();
      expect(only(world)).toMatchObject({ status: "sent", conversation_id: 200 });
    }));

  it("refuses a cursor or a period out of shape", () => {
    expect(outboxListQuerySchema.safeParse({ cursor: "'; DROP" }).success).toBe(false);
    expect(outboxListQuerySchema.safeParse({ period: "365d" }).success).toBe(false);
    expect(outboxListQuerySchema.safeParse({ filter: "everything" }).success).toBe(false);
  });

  it("forgets after its time: rows after 180 days, a failed message's text after 7", () =>
    withWorld(async (world) => {
      world.outbox.enqueue(input(world));
      const id = only(world).id as string;
      world.db.run(`UPDATE zur_outbox SET status = 'failed', grp = 'failed' WHERE id = ?`, id);
      world.clock.now += 7 * 24 * 60 * MINUTE + 1;
      await world.outbox.tick();
      expect(job(world, id)).toMatchObject({ text: null, phone: null });
      expect(world.outbox.detail(id).canRetry).toBe(false);
      world.clock.now += 174 * 24 * 60 * MINUTE;
      await world.outbox.tick();
      expect(job(world, id)).toBeNull();
      expect(world.db.one<{ n: number }>(`SELECT count(*) AS n FROM zur_outbox_steps WHERE outbox_id = ?`, id)?.n).toBe(0);
    }));
});

describe("security audit (PR S19)", () => {
  /** A first POST that reaches the Chatwoot but answers 502: the message is there, the queue doesn't know. */
  const lostAnswer = (world: World) =>
    world.cw.faults.push({
      method: "POST",
      path: /\/messages$/,
      answer: () => {
        world.cw.messages.push({ id: 900, conversation: 200, content: only(world).text as string, message_type: 1, created_at: Math.floor(world.clock.now / 1000) });
        return new Response("{}", { status: 502 });
      },
    });

  it("S19-SEC-A8-01: a check that fails before its POST stays a check; the message never goes twice", () =>
    withWorld(async (world) => {
      world.outbox.enqueue(input(world));
      lostAnswer(world);
      await world.outbox.tick();
      expect(only(world).status).toBe("checking");
      world.cw.faults.push({ method: "GET", path: /\/messages$/, answer: () => new Response("{}", { status: 503 }) });
      world.clock.now += 3 * MINUTE;
      await world.outbox.tick();
      expect(only(world).status).toBe("checking");
      world.clock.now += 5 * MINUTE;
      await world.outbox.tick();
      expect(only(world).status).toBe("sent");
      expect(world.cw.messages).toHaveLength(1);
      expect(steps(world, only(world).id as string).at(-1)).toBe("found_sent");
    }));

  it("S19-SEC-A8-01: 'Tentar de novo' after an uncertain POST checks the conversation before sending", () =>
    withWorld(async (world) => {
      world.outbox.enqueue(input(world));
      lostAnswer(world);
      await world.outbox.tick();
      const id = only(world).id as string;
      // The two checks left fail too (each is a try): "Falhou", but it may have left.
      for (let n = 0; n < 2; n++) {
        world.cw.faults.push({ method: "GET", path: /\/messages$/, answer: () => new Response("{}", { status: 503 }) });
        world.clock.now += 5 * MINUTE;
        await world.outbox.tick();
      }
      expect(job(world, id)).toMatchObject({ status: "failed" });
      world.outbox.retry(id);
      world.clock.now += 5 * MINUTE;
      await world.outbox.tick();
      expect(job(world, id)).toMatchObject({ status: "sent" });
      expect(world.cw.messages).toHaveLength(1);
    }));

  it("S19-SEC-A8-02: an object that stops during a check still looks from the first POST's time", () =>
    withWorld(async (world) => {
      world.outbox.enqueue(input(world));
      lostAnswer(world);
      await world.outbox.tick();
      const id = only(world).id as string;
      world.clock.now += 5 * MINUTE;
      // The wake that took the check died mid-call: 'sending' with a new sending_at.
      world.db.run(`UPDATE zur_outbox SET status = 'sending', sending_at = ? WHERE id = ?`, new Date(world.clock.now).toISOString(), id);
      world.clock.now += 3 * MINUTE;
      await world.outbox.tick();
      world.clock.now += 5 * MINUTE;
      await world.outbox.tick();
      expect(job(world, id)).toMatchObject({ status: "sent" });
      expect(world.cw.messages).toHaveLength(1);
    }));

  it("S19-SEC-A8-03: a contact marked crmBloqueado between two tries never gets it", () =>
    withWorld(async (world) => {
      const phone = "+5511987654399";
      world.cw.contacts.push({ id: 77, phone_number: phone });
      world.outbox.enqueue(input(world, { phone }));
      world.cw.faults.push({ method: "POST", path: /\/messages$/, answer: () => new Response("{}", { status: 422 }) });
      await world.outbox.tick();
      expect(only(world).contact_id).toBe(77);
      (world.cw.contacts[0] as { custom_attributes?: Record<string, unknown> }).custom_attributes = { crmBloqueado: true };
      world.clock.now += 3 * MINUTE;
      await world.outbox.tick();
      expect(only(world)).toMatchObject({ status: "blocked", phone: null, text: null });
      expect(world.cw.messages).toHaveLength(0);
    }));

  it("S19-SEC-A12-01: a message in a stopped queue forgets its phone and text after 7 days", () =>
    withWorld(async (world) => {
      world.outbox.enqueue(input(world));
      world.cw.faults.push({ method: "GET", path: /\/contacts\/search$/, answer: () => new Response("{}", { status: 401 }) });
      await world.outbox.tick();
      expect(queue(world).stopped_at).not.toBeNull();
      world.clock.now += OUTBOX_LIMITS.maxWaitDays * 24 * 60 * MINUTE - 1000;
      await world.outbox.tick();
      expect(only(world)).toMatchObject({ grp: "waiting" });
      world.clock.now += 1000;
      await world.outbox.tick();
      expect(only(world)).toMatchObject({ status: "expired", grp: "skipped", phone: null, text: null });
    }));

  it("S19-SEC-A8-04: what a paused or turned-off automation queued is held, without waking every minute", () =>
    withWorld(async (world) => {
      let live = false;
      const outbox = new Outbox({
        db: world.db,
        connections: world.connections,
        callDeps: (calls) => world.flows.automationCallDeps(calls),
        timeZone: () => "America/Sao_Paulo",
        lockdown: () => false,
        notify: () => {},
        clock: () => world.clock.now,
        random: () => 0,
        active: (automationId) => live && automationId === "review-request",
      });
      outbox.enqueue(input(world));
      expect(await outbox.tick()).toBe(false);
      expect(sends(world)).toHaveLength(0);
      // Only the hour it loses its turn, a week on.
      expect(outbox.nextDue()).toBe(new Date(world.clock.now + OUTBOX_LIMITS.maxWaitDays * 86_400_000).toISOString());
      live = true;
      expect(await outbox.tick()).toBe(true);
      expect(sends(world)).toHaveLength(1);
    }));
});

describe("the gap's random part (CodeQL js/biased-cryptographic-random)", () => {
  it("stays in [0, range) and reaches both ends", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 400; i++) {
      const value = uniformBelow(3);
      expect(Number.isInteger(value) && value >= 0 && value < 3).toBe(true);
      seen.add(value);
    }
    expect([...seen].sort()).toEqual([0, 1, 2]);
    expect(uniformBelow(1)).toBe(0);
  });
});
