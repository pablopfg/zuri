import { AGENT_INSTANCE_NAME, type ChatwootOwnerCode, type ChatwootOwnerStatus, hmacSha256Hex } from "@zuri/shared";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ZuriAgent } from "../src/agent/zuri-agent.ts";
import { MockAIProvider } from "../src/ai/mock.ts";
import { developmentOwnerNetwork, type SimulatedChatwoot } from "../src/chatwoot/dev-chatwoot-owner.ts";
import { InternalState } from "../src/db/internal-state.ts";
import { chatwootHookToken } from "../src/gates/chatwoot-owner.ts";
import { FakeNetwork } from "./flow-world.ts";
import { call, CSRF, errorBody, HUMAN_TOKEN, ORIGIN, signedCookies, TEST_EMAIL, TEST_PASSWORD, testEnv } from "./helpers.ts";

// The owner's Chatwoot through the Worker: Settings › Chatwoot and the inbox's return.

const IP = "192.0.2.191";
const CHATWOOT = "https://chat.exemplo.com.br";
const ADMIN_KEY = "chave-admin-exemplo-0123456789";
let cookie = "";
/** The notices the simulation would post to the return, posted by the test through the Worker. */
let outbox: { url: string; raw: string; headers: { signature: string; timestamp: string; delivery: string } }[] = [];
let chatwoot: SimulatedChatwoot;

const owner = () => testEnv.AGENT.get(testEnv.AGENT.idFromName(AGENT_INSTANCE_NAME));
const inOwner = <T>(fn: (agent: ZuriAgent) => T | Promise<T>) => runInDurableObject(owner(), (agent: ZuriAgent) => fn(agent));
const headers = (withCookie = true) => ({ ...CSRF, "content-type": "application/json", "cf-connecting-ip": IP, ...(withCookie ? { cookie } : {}) });
const api = (method: string, path: string, body?: unknown, withCookie = true) =>
  call(`${ORIGIN}/api${path}`, { method, headers: headers(withCookie), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const stale = () => inOwner((agent) => agent.store.db.run(`UPDATE zur_sessions SET confirmed_at = ?`, Date.now() - 16 * 60_000));
const fresh = () => inOwner((agent) => agent.store.db.run(`UPDATE zur_sessions SET confirmed_at = ?`, Date.now()));
const events = (kind: string) => inOwner((agent) => agent.store.db.one<{ n: number }>(`SELECT count(*) AS n FROM zur_auth_events WHERE kind = ?`, kind)?.n ?? 0);
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
const setupBody = { origin: CHATWOOT, accountId: 1, adminKey: ADMIN_KEY };

/** Posts what the simulated Chatwoot sent to the return, as the Chatwoot would. */
async function flush(): Promise<Response[]> {
  await sleep(150);
  const sent = outbox.splice(0);
  const answers: Response[] = [];
  for (const notice of sent) {
    answers.push(
      await call(notice.url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-chatwoot-signature": notice.headers.signature, "x-chatwoot-timestamp": notice.headers.timestamp, "x-chatwoot-delivery": notice.headers.delivery },
        body: notice.raw,
      }),
    );
  }
  await inOwner((agent) => agent.store.chatwootOwner.settled());
  return answers;
}

async function linked(): Promise<ChatwootOwnerStatus> {
  const res = await api("POST", "/chatwoot/owner/setup", { ...setupBody, ownerId: 7 });
  expect(res.status).toBe(201);
  await flush();
  await flush();
  const confirm = await api("POST", "/chatwoot/owner/confirm");
  expect(confirm.status).toBe(200);
  return (await confirm.json()) as ChatwootOwnerStatus;
}

beforeAll(async () => {
  const res = await call(`${ORIGIN}/api/auth/login`, {
    method: "POST",
    headers: headers(false),
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD, turnstileToken: HUMAN_TOKEN }),
  });
  expect(res.status).toBe(200);
  cookie = signedCookies(res);
});

beforeEach(async () => {
  outbox = [];
  await inOwner((agent) => {
    chatwoot = developmentOwnerNetwork(new FakeNetwork(), (url, raw, notice) => {
      outbox.push({ url, raw, headers: notice });
    });
    agent.store.flows.network = chatwoot;
    agent.store.chatwootOwner.testWaitMs = 2_000;
    agent.store.chatwootOwner.clearCounts();
    // The simulated model (the AI binding never runs in tests).
    agent.testProvider = new MockAIProvider();
  });
  await fresh();
});

afterEach(async () => {
  await inOwner((agent) => {
    const { db } = agent.store;
    const state = new InternalState(db);
    state.delete("chatwoot_owner");
    state.delete("chatwoot_conversation");
    state.delete("lockdown_until");
    agent.testProvider = null;
    for (const table of ["zur_flow_connections", "zur_auth_events", "zur_notices"]) db.run(`DELETE FROM ${table}`);
  });
});

describe("/api/chatwoot/owner: Settings › Chatwoot", () => {
  it("needs a session and the CSRF header, and refuses a token", async () => {
    expect((await api("GET", "/chatwoot/owner", undefined, false)).status).toBe(401);
    expect((await call(`${ORIGIN}/api/chatwoot/owner`, { headers: { cookie, "cf-connecting-ip": IP } })).status).toBe(403);
    expect((await call(`${ORIGIN}/api/chatwoot/owner`, { headers: { ...headers(), authorization: "Bearer x" } })).status).toBe(401);
    const res = await api("GET", "/chatwoot/owner");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(await res.json()).toMatchObject({ configured: false, credentialsAvailable: true, state: null });
  });

  it("asks for the password typed recently before anything that uses the key or changes who is answered", async () => {
    await stale();
    for (const [method, path, body] of [
      ["POST", "/chatwoot/owner/check", setupBody],
      ["POST", "/chatwoot/owner/setup", { ...setupBody, ownerId: 7 }],
      ["POST", "/chatwoot/owner/relink", undefined],
      ["POST", "/chatwoot/owner/confirm", undefined],
      ["PATCH", "/chatwoot/owner", { enabled: true }],
      ["POST", "/chatwoot/owner/test/full", { adminKey: ADMIN_KEY }],
      ["POST", "/chatwoot/owner/rotate", { adminKey: ADMIN_KEY }],
      ["POST", "/chatwoot/owner/repair", { adminKey: ADMIN_KEY }],
      ["POST", "/chatwoot/owner/unlock", undefined],
      ["DELETE", "/chatwoot/owner", undefined],
    ] as const) {
      const res = await api(method, path, body);
      expect(res.status, path).toBe(403);
      expect((await errorBody(res)).code, path).toBe("RECENT_AUTH_REQUIRED");
    }
    // Nothing reached the Chatwoot.
    expect(chatwoot.sim.inboxes.size).toBe(0);
    // Turning off asks for nothing.
    expect((await api("PATCH", "/chatwoot/owner", { enabled: false })).status).toBe(404);
  });

  it("validates every body: unknown fields, a bad address, a key with control characters, the size", async () => {
    for (const body of [
      { ...setupBody, extra: 1 },
      { ...setupBody, origin: "http://chat.exemplo.com.br" },
      { ...setupBody, accountId: 0 },
      { ...setupBody, adminKey: "chave\nquebrada" },
      { ...setupBody, adminKey: "" },
      { origin: CHATWOOT, accountId: 1 },
    ]) {
      const res = await api("POST", "/chatwoot/owner/check", body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    const huge = await api("POST", "/chatwoot/owner/check", { ...setupBody, adminKey: "a".repeat(5_000) });
    // Over the 4 KB of these bodies: refused as a bad body, before any field is read.
    expect(huge.status).toBe(400);
    expect((await api("PATCH", "/chatwoot/owner", { enabled: "sim" })).status).toBe(400);
    expect(chatwoot.sim.inboxes.size).toBe(0);
  });

  it("checks the key, sets up, links with the confirmation and records it with an alert; the key never comes back", async () => {
    const check = await api("POST", "/chatwoot/owner/check", setupBody);
    expect(await check.json()).toEqual({ profile: { id: 7, name: "Ana Martins", email: "ana@exemplo.com.br", administrator: true } });
    const res = await api("POST", "/chatwoot/owner/setup", { ...setupBody, ownerId: 7 });
    expect(res.status).toBe(201);
    const code = (await res.json()) as ChatwootOwnerCode;
    expect(code.status.state).toBe("code");
    expect(JSON.stringify(code)).not.toContain(ADMIN_KEY);
    // The code's notice and the owner's answer come back through the Worker.
    const answers = [...(await flush()), ...(await flush())];
    expect(answers.map((answer) => answer.status)).toEqual([200, 200, 200]);
    const status = (await (await api("GET", "/chatwoot/owner")).json()) as ChatwootOwnerStatus;
    expect(status).toMatchObject({ state: "confirm", candidate: { id: 7 } });
    expect(await events("chatwoot_owner_linked")).toBe(0);
    const confirmed = await api("POST", "/chatwoot/owner/confirm");
    expect(await confirmed.json()).toMatchObject({ state: "on", owner: { id: 7 } });
    expect(await events("chatwoot_owner_linked")).toBe(1);
    // A security notice, critical, with only the kind of event.
    expect(await inOwner((agent) => agent.store.db.all<{ params: string }>(`SELECT params FROM zur_notices WHERE kind = 'security'`).map((row) => row.params).join())).toContain("chatwoot_owner_linked");
    const stored = await inOwner((agent) => JSON.stringify([agent.store.db.all(`SELECT * FROM zur_settings`), agent.store.db.all(`SELECT * FROM zur_flow_connections`), agent.store.db.all(`SELECT * FROM zur_auth_events`)]));
    expect(stored).not.toContain(ADMIN_KEY);
    // The flows' credentials don't list the owner's.
    expect(((await (await api("GET", "/flows")).json()) as { connections: unknown[] }).connections).toEqual([]);
  });

  it("answers the owner and nobody else, through the return", async () => {
    await linked();
    const conversation = [...chatwoot.sim.contacts.values()][0]?.conversations[0] as number;
    await inOwner(async () => {
      await chatwoot.agentSays(conversation, "Oi, Zuri");
      await chatwoot.agentSays(conversation, "Sou o Rafael", { id: 9, name: "Rafael Souza" });
    });
    await flush();
    await inOwner((agent) => agent.store.chatwootOwner.settled());
    // The real runner took the owner's message once, in the app's "Chatwoot" conversation, and answered it there and in
    // the inbox; Rafael's never reached it.
    const turns = await inOwner((agent) =>
      agent.store.db.all<{ role: string; content: string }>(`SELECT m.role, m.content FROM zur_messages m JOIN zur_conversations c ON c.id = m.conversation_id WHERE c.title = 'Chatwoot' ORDER BY m.seq`),
    );
    expect(turns.filter((turn) => turn.role === "user").map((turn) => turn.content)).toEqual(["Oi, Zuri"]);
    const answer = turns.find((turn) => turn.role === "assistant")?.content ?? "";
    expect(answer.length).toBeGreaterThan(0);
    const messages = chatwoot.sim.messages.get(conversation) ?? [];
    expect(messages.filter((message) => message.message_type === 0).map((message) => message.content)).toContain(answer.trim().slice(0, 4_000));
    expect(JSON.stringify(await inOwner((agent) => agent.store.db.all(`SELECT content FROM zur_messages`)))).not.toContain("Sou o Rafael");
    const notices = await inOwner((agent) => agent.store.db.all<{ kind: string; body: string | null }>(`SELECT kind, body FROM zur_notices`));
    expect(notices.map((notice) => notice.kind)).toContain("chatwoot.stranger");
    expect(JSON.stringify(notices)).not.toContain("Rafael");
  });

  it("tests, turns off and on, records secrets and repair as changes, and forgets", async () => {
    await linked();
    const pending = api("POST", "/chatwoot/owner/test");
    await sleep(300);
    await flush();
    const test = (await (await pending).json()) as { ok: boolean };
    expect(test.ok).toBe(true);
    expect(await (await api("PATCH", "/chatwoot/owner", { enabled: false })).json()).toMatchObject({ state: "paused", pausedBy: "owner" });
    expect(await (await api("PATCH", "/chatwoot/owner", { enabled: true })).json()).toMatchObject({ state: "on" });
    const repaired = await api("POST", "/chatwoot/owner/repair", { adminKey: ADMIN_KEY });
    expect(repaired.status).toBe(200);
    expect(await events("chatwoot_owner_changed")).toBe(1);
    const unlocked = await api("POST", "/chatwoot/owner/unlock");
    expect(((await unlocked.json()) as ChatwootOwnerStatus).readLock.locked).toBe(false);
    expect(await events("chatwoot_owner_unlocked")).toBe(1);
    const relink = await api("POST", "/chatwoot/owner/relink");
    expect(((await relink.json()) as ChatwootOwnerCode).status.state).toBe("code");
    expect((await api("POST", "/chatwoot/owner/code")).status).toBe(200);
    const forgot = await api("DELETE", "/chatwoot/owner");
    expect(forgot.status).toBe(204);
    expect(await events("chatwoot_owner_removed")).toBe(1);
    expect(await (await api("GET", "/chatwoot/owner")).json()).toMatchObject({ configured: false });
    expect((await api("DELETE", "/chatwoot/owner")).status).toBe(404);
  });
});

describe("/api/chatwoot/owner/hook: the inbox's return", () => {
  const linkId = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";
  const hook = async (path: string, init: RequestInit = {}) => call(`${ORIGIN}${path}`, { method: "POST", ...init });
  const signed = async (raw: string, secret = "segredo") => {
    const ts = String(Math.floor(Date.now() / 1000));
    return { "content-type": "application/json", "x-chatwoot-signature": `sha256=${await hmacSha256Hex(secret, `${ts}.${raw}`)}`, "x-chatwoot-timestamp": ts };
  };

  it("refuses at the Worker a wrong token, a missing signature, a GET, another type and a body over 64 KB", async () => {
    const token = await chatwootHookToken(testEnv.SESSION_SECRET, linkId);
    const good = `/api/chatwoot/owner/hook/${linkId}/${token}`;
    expect((await hook(`/api/chatwoot/owner/hook/${linkId}/${"0".repeat(64)}`, { headers: await signed("{}"), body: "{}" })).status).toBe(403);
    expect((await hook(`/api/chatwoot/owner/hook/${linkId}/curto`, { headers: await signed("{}"), body: "{}" })).status).toBe(404);
    expect((await hook(good, { headers: { "content-type": "application/json" }, body: "{}" })).status).toBe(403);
    expect((await call(`${ORIGIN}${good}`)).status).toBe(404);
    expect((await hook(good, { headers: { ...(await signed("{}")), "content-type": "text/plain" }, body: "{}" })).status).toBe(400);
    const big = JSON.stringify({ x: "a".repeat(64 * 1024) });
    expect((await hook(good, { headers: await signed(big), body: big })).status).toBe(413);
    // SEC-A9-xx-5: a signature older than 5 minutes, or one that can't be one, never wakes the object (an unknown link would be 200 there).
    const old = { ...(await signed("{}")), "x-chatwoot-timestamp": String(Math.floor(Date.now() / 1000) - 6 * 60) };
    expect((await hook(good, { headers: old, body: "{}" })).status).toBe(401);
    expect((await hook(good, { headers: { ...(await signed("{}")), "x-chatwoot-signature": "sha256=curta" }, body: "{}" })).status).toBe(401);
    // The right token and a signature, for a link that isn't kept: an empty 200, nothing done.
    const res = await hook(good, { headers: await signed("{}"), body: "{}" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
  });

  it("passes a wrong signature for the kept link as 401", async () => {
    await linked();
    const id = JSON.parse((await inOwner((agent) => new InternalState(agent.store.db).get<string>("chatwoot_owner"))) as string).id as string;
    const path = `/api/chatwoot/owner/hook/${id}/${await chatwootHookToken(testEnv.SESSION_SECRET, id)}`;
    const raw = JSON.stringify({ event: "message_created", id: 1 });
    expect((await hook(path, { headers: await signed(raw, "segredo-falso"), body: raw })).status).toBe(401);
    expect(await (await api("GET", "/chatwoot/owner")).json()).toMatchObject({ state: "on" });
  });
});
