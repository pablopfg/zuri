import { AGENT_INSTANCE_NAME, type CrmAutomation, type CrmAutomationActivity, type CrmAutomationList } from "@zuri/shared";
import { runInDurableObject } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ZuriAgent } from "../src/agent/zuri-agent.ts";
import { EXAMPLE_AUTOMATION } from "../src/crm/automations/example.ts";
import { useCatalog } from "./crm-automations-world.ts";
import { FakeNetwork } from "./flow-world.ts";
import { call, CSRF, errorBody, HUMAN_TOKEN, ORIGIN, TEST_EMAIL, TEST_PASSWORD, testEnv, signedCookies } from "./helpers.ts";

// PR S18: the CRM's automations through the Worker, as CRM › Automações calls them.

const IP = "192.0.2.182";
let cookie = "";
let chatwoot = "";
const owner = () => testEnv.AGENT.get(testEnv.AGENT.idFromName(AGENT_INSTANCE_NAME));
const inOwner = <T>(fn: (agent: ZuriAgent) => T | Promise<T>) => runInDurableObject(owner(), (agent: ZuriAgent) => fn(agent));
const headers = (withCookie = true) => ({ ...CSRF, "content-type": "application/json", "cf-connecting-ip": IP, ...(withCookie ? { cookie } : {}) });
const api = (method: string, path: string, body?: unknown, withCookie = true) =>
  call(`${ORIGIN}/api${path}`, { method, headers: headers(withCookie), ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }) });
const stale = () => inOwner((agent) => agent.store.db.run(`UPDATE zur_sessions SET confirmed_at = ?`, Date.now() - 16 * 60_000));
const fresh = () => inOwner((agent) => agent.store.db.run(`UPDATE zur_sessions SET confirmed_at = ?`, Date.now()));
const json = async <T>(res: Response) => (await res.json()) as T;

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
  chatwoot = await inOwner(async (agent) => {
    const network = new FakeNetwork();
    network.handlers.set("chat.exemplo.com.br", () => Response.json({ payload: [{ id: 7, name: "WhatsApp", channel_type: "Channel::Api" }] }));
    agent.store.flows.network = network;
    const { db } = agent.store;
    for (const table of ["zur_crm_automations", "zur_crm_automation_runs", "zur_crm_automation_effects", "zur_crm_automation_days", "zur_flow_connections"]) db.run(`DELETE FROM ${table}`);
    useCatalog(agent, [EXAMPLE_AUTOMATION]);
    return agent.store.flows.connections.create({ kind: "chatwoot", name: "Chatwoot", origin: "https://chat.exemplo.com.br", accountId: 1, credential: "chave-do-agente-zuri-4f2a" }, { development: false });
  });
  await fresh();
});

describe("CRM › Automações routes", () => {
  it("needs the session", async () => {
    expect((await api("GET", "/crm/automations", undefined, false)).status).toBe(401);
    expect((await api("PUT", "/crm/automations/example/watch", { watch: true }, false)).status).toBe(401);
  });

  it("lists them in order, the example last (only the tests and local development have it)", async () => {
    const list = await json<CrmAutomationList>(await api("GET", "/crm/automations"));
    expect(list.automations[0]).toMatchObject({ id: "review-request", availability: "next", state: "off" });
    expect(list.automations.at(-1)).toMatchObject({ id: "example", availability: "ready", state: "off", connectionKind: "chatwoot" });
    expect(list.limits).toEqual({ active: 10, rehearsalDays: 3 });
  });

  it("saving and starting take the password typed recently; turning off doesn't", async () => {
    await stale();
    const refused = await api("PUT", "/crm/automations/example/config", { connectionId: chatwoot, options: {} });
    expect(refused.status).toBe(403);
    expect((await errorBody(refused)).code).toBe("RECENT_AUTH_REQUIRED");
    await fresh();
    const saved = await json<{ automation: CrmAutomation }>(await api("PUT", "/crm/automations/example/config", { connectionId: chatwoot, options: { perDay: 2 } }));
    expect(saved.automation).toMatchObject({ connectionId: chatwoot, options: { perDay: 2 }, state: "off" });
    await stale();
    expect((await api("POST", "/crm/automations/example/mode", { mode: "rehearsal" })).status).toBe(403);
    await fresh();
    const started = await json<{ automation: CrmAutomation }>(await api("POST", "/crm/automations/example/mode", { mode: "rehearsal" }));
    expect(started.automation.state).toBe("rehearsal");
    await stale();
    expect((await api("POST", "/crm/automations/example/mode", { mode: "live", acceptRisk: true })).status).toBe(403);
    const off = await api("POST", "/crm/automations/example/mode", { mode: "off" });
    expect(off.status).toBe(200);
    expect((await json<{ automation: CrmAutomation }>(off)).automation.state).toBe("off");
  });

  it("refuses going live before the days without the risk", async () => {
    await api("PUT", "/crm/automations/example/config", { connectionId: chatwoot, options: {} });
    await api("POST", "/crm/automations/example/mode", { mode: "rehearsal" });
    const early = await api("POST", "/crm/automations/example/mode", { mode: "live" });
    expect(early.status).toBe(409);
    expect(((await early.json()) as { details: unknown }).details).toEqual({ days: 3 });
  });

  it("checks a day of the rehearsal and shows the activity", async () => {
    await api("PUT", "/crm/automations/example/config", { connectionId: chatwoot, options: {} });
    await api("POST", "/crm/automations/example/mode", { mode: "rehearsal" });
    // Ten days back, so a working day is always there whatever day the suite runs on.
    const day = await inOwner((agent) => {
      agent.store.db.run(`UPDATE zur_crm_automations SET rehearsal_since = ?`, new Date(Date.now() - 10 * 86_400_000).toISOString());
      const oldest = agent.store.crmAutomations.activity("example").days.at(-1)?.day ?? "";
      // It ran that day (15:00 UTC is midday in São Paulo): only such a day can be checked.
      agent.store.db.run(`INSERT INTO zur_crm_automation_runs (automation_id, started_at, mode, outcome) VALUES ('example', ?, 'rehearsal', 'ok')`, `${oldest}T15:00:00.000Z`);
      return oldest;
    });
    expect(day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect((await api("PUT", `/crm/automations/example/days/${day}`, { verdict: "differs" })).status).toBe(400);
    expect((await api("PUT", `/crm/automations/example/days/${day}`, { verdict: "differs", note: "Faltou uma pessoa" })).status).toBe(200);
    expect((await api("PUT", "/crm/automations/example/days/2026-13-01", { verdict: "match" })).status).toBe(400);
    expect((await api("PUT", "/crm/automations/example/days/1999-01-04", { verdict: "match" })).status).toBe(400);
    const activity = await json<CrmAutomationActivity>(await api("GET", "/crm/automations/example/activity"));
    expect(activity.days.at(-1)).toMatchObject({ day, verdict: "differs", note: "Faltou uma pessoa" });
    expect(activity.runs).toEqual([{ startedAt: `${day}T15:00:00.000Z`, mode: "rehearsal", outcome: "ok", calls: 0, effects: 0 }]);
  });

  it("watches one on its way; refuses hostile ids and bodies", async () => {
    expect(await json(await api("PUT", "/crm/automations/review-link/watch", { watch: true }))).toEqual({ watch: true });
    const list = await json<CrmAutomationList>(await api("GET", "/crm/automations"));
    expect(list.automations.find((item) => item.id === "review-link")?.watch).toBe(true);
    expect((await api("PUT", "/crm/automations/example/watch", { watch: true })).status).toBe(409);
    expect((await api("GET", "/crm/automations/..%2Fflows/activity")).status).toBe(404);
    expect((await api("GET", "/crm/automations/NOPE/activity")).status).toBe(404);
    expect((await api("GET", "/crm/automations/nope/activity")).status).toBe(404);
    expect((await api("PUT", "/crm/automations/review-link/watch", { watch: "yes" })).status).toBe(400);
    expect((await api("PUT", "/crm/automations/review-link/watch", "{")).status).toBe(400);
    expect((await api("POST", "/crm/automations/example/mode", { mode: "live", extra: 1 })).status).toBe(400);
    const huge = await api("PUT", "/crm/automations/example/config", { connectionId: chatwoot, options: { perDay: "1".repeat(5_000) } });
    expect(huge.status).toBe(400);
    expect(((await huge.json()) as { details: unknown }).details).toEqual({ fields: ["_body"] });
  });
});
