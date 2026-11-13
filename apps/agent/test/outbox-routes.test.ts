import { AGENT_INSTANCE_NAME, type OutboxDetail, type OutboxList, type OutboxStatusInfo } from "@zuri/shared";
import { runInDurableObject } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ZuriAgent } from "../src/agent/zuri-agent.ts";
import { FakeNetwork } from "./flow-world.ts";
import { call, CSRF, errorBody, HUMAN_TOKEN, ORIGIN, signedCookies, TEST_EMAIL, TEST_PASSWORD, testEnv } from "./helpers.ts";

// PR S19: CRM › Envios through the Worker, as the screen calls it.

const IP = "192.0.2.183";
let cookie = "";
let chatwoot = "";
const owner = () => testEnv.AGENT.get(testEnv.AGENT.idFromName(AGENT_INSTANCE_NAME));
const inOwner = <T>(fn: (agent: ZuriAgent) => T | Promise<T>) => runInDurableObject(owner(), (agent: ZuriAgent) => fn(agent));
const headers = (withCookie = true) => ({ ...CSRF, "content-type": "application/json", "cf-connecting-ip": IP, ...(withCookie ? { cookie } : {}) });
const api = (method: string, path: string, withCookie = true) => call(`${ORIGIN}/api${path}`, { method, headers: headers(withCookie) });
const stale = () => inOwner((agent) => agent.store.db.run(`UPDATE zur_sessions SET confirmed_at = ?`, Date.now() - 16 * 60_000));
const fresh = () => inOwner((agent) => agent.store.db.run(`UPDATE zur_sessions SET confirmed_at = ?`, Date.now()));
const json = async <T>(res: Response) => (await res.json()) as T;

beforeAll(async () => {
  const res = await call(`${ORIGIN}/api/auth/login`, { method: "POST", headers: headers(false), body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD, turnstileToken: HUMAN_TOKEN }) });
  expect(res.status).toBe(200);
  cookie = signedCookies(res);
});

beforeEach(async () => {
  chatwoot = await inOwner(async (agent) => {
    const network = new FakeNetwork();
    network.handlers.set("chat.exemplo.com.br", () => new Response("x", { status: 500 }));
    agent.store.flows.network = network;
    const { db } = agent.store;
    for (const table of ["zur_outbox", "zur_outbox_queues", "zur_outbox_days", "zur_flow_connections"]) db.run(`DELETE FROM ${table}`);
    db.run(`UPDATE zur_outbox_state SET paused_at = NULL`);
    const id = await agent.store.flows.connections.create({ kind: "chatwoot", name: "Chatwoot", origin: "https://chat.exemplo.com.br", accountId: 1, credential: "chave-do-agente-zuri-4f2a" }, { development: false });
    agent.store.outbox.enqueue({ automationId: "review-request", connectionId: id, key: "2026-11-03:a", label: "Pessoa de exemplo", phone: "+5511987654321", text: "Olá, Pessoa", bulk: true });
    return id;
  });
  await fresh();
});

describe("CRM › Envios routes", () => {
  it("need the session", async () => {
    for (const [method, path] of [["GET", "/outbox/status"], ["GET", "/outbox"], ["GET", "/outbox/qualquer"], ["POST", "/outbox/pause"], ["POST", "/outbox/resume"], ["POST", "/outbox/qualquer/retry"]] as const) {
      expect((await api(method, path, false)).status).toBe(401);
    }
  });

  it("status, history and detail; never the text or the phone", async () => {
    const status = await json<OutboxStatusInfo>(await api("GET", "/outbox/status"));
    expect(status).toMatchObject({ state: "running", waiting: 1, connection: { id: chatwoot, name: "Chatwoot" } });
    const list = await json<OutboxList>(await api("GET", "/outbox?period=7d&filter=all"));
    expect(list.rows).toHaveLength(1);
    const detail = await json<OutboxDetail>(await api("GET", `/outbox/${list.rows[0]?.id}`));
    expect(detail.steps.map((step) => step.kind)).toEqual(["queued"]);
    expect(JSON.stringify([status, list, detail])).not.toMatch(/\+5511|987654321|Olá/);
    expect((await api("GET", "/outbox?period=365d")).status).toBe(400);
    expect((await api("GET", "/outbox/..%2Fx")).status).toBe(404);
    expect((await api("GET", "/outbox/nada")).status).toBe(404);
  });

  it("pause asks for nothing; resuming a stop by the breaker takes the password typed recently", async () => {
    await stale();
    expect((await json<OutboxStatusInfo>(await api("POST", "/outbox/pause"))).state).toBe("paused");
    expect((await json<OutboxStatusInfo>(await api("POST", "/outbox/resume"))).state).toBe("running");
    await inOwner((agent) => agent.store.db.run(`UPDATE zur_outbox_queues SET stopped_at = ?, stopped_reason = 'failures'`, new Date().toISOString()));
    const refused = await api("POST", "/outbox/resume");
    expect(refused.status).toBe(403);
    expect((await errorBody(refused)).code).toBe("RECENT_AUTH_REQUIRED");
    // Refused, nothing moved: the queue is still stopped.
    expect(await inOwner((agent) => agent.store.outbox.stopped())).toBe(true);
    await fresh();
    expect((await json<OutboxStatusInfo>(await api("POST", "/outbox/resume"))).state).toBe("running");
  });

  it("'Tentar de novo' only for a failed one, once", async () => {
    const id = await inOwner((agent) => agent.store.db.one<{ id: string }>(`SELECT id FROM zur_outbox`)?.id as string);
    const early = await api("POST", `/outbox/${id}/retry`);
    expect(early.status).toBe(409);
    await inOwner((agent) => agent.store.db.run(`UPDATE zur_outbox SET status = 'failed', grp = 'failed', attempts = 3`));
    const again = await json<OutboxDetail>(await api("POST", `/outbox/${id}/retry`));
    expect(again).toMatchObject({ status: "queued", attempts: 0, canRetry: false });
    expect((await api("POST", `/outbox/${id}/retry`)).status).toBe(409);
  });
});
