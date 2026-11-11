import { AGENT_INSTANCE_NAME, type CrmClientDetail, type CrmClientPage, type CrmOverview, type FlowList } from "@zuri/shared";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ZuriAgent } from "../src/agent/zuri-agent.ts";
import { InternalState } from "../src/db/internal-state.ts";
import { call, CSRF, errorBody, HUMAN_TOKEN, ORIGIN, TEST_EMAIL, TEST_PASSWORD, testEnv } from "./helpers.ts";

// Step 22b: the Clients tab's routes through the Worker, and the flow suggestions' one route.

const IP = "192.0.2.182";
let cookie = "";
const owner = () => testEnv.AGENT.get(testEnv.AGENT.idFromName(AGENT_INSTANCE_NAME));
const inOwner = <T>(fn: (agent: ZuriAgent) => T | Promise<T>) => runInDurableObject(owner(), (agent: ZuriAgent) => fn(agent));

const headers = (withCookie = true) => ({ ...CSRF, "content-type": "application/json", "cf-connecting-ip": IP, ...(withCookie ? { cookie } : {}) });
const api = (method: string, path: string, body?: unknown, withCookie = true) =>
  call(`${ORIGIN}/api${path}`, { method, headers: headers(withCookie), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const stale = () => inOwner((agent) => agent.store.db.run(`UPDATE zur_sessions SET confirmed_at = ?`, Date.now() - 16 * 60_000));
const fresh = () => inOwner((agent) => agent.store.db.run(`UPDATE zur_sessions SET confirmed_at = ?`, Date.now()));
const overview = async () => (await (await api("GET", "/crm")).json()) as CrmOverview;

const addClient = async (body: Record<string, unknown>) => {
  const res = await api("POST", "/crm/clients", body);
  expect(res.status).toBe(201);
  return ((await res.json()) as { client: CrmClientDetail }).client;
};

beforeAll(async () => {
  const res = await call(`${ORIGIN}/api/auth/login`, {
    method: "POST",
    headers: headers(false),
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD, turnstileToken: HUMAN_TOKEN }),
  });
  expect(res.status).toBe(200);
  cookie = res.headers.getSetCookie().find((c) => c.startsWith("__Host-zuri_session="))?.split(";")[0] ?? "";
});

beforeEach(fresh);

afterEach(async () => {
  await inOwner((agent) => {
    const { db } = agent.store;
    new InternalState(db).delete("lockdown_until");
    for (const table of ["zur_crm_tags", "zur_crm_history", "zur_crm_clients", "zur_crm_tag_counts", "zur_crm_stages", "zur_flow_drafts", "zur_auth_events", "zur_notices"]) {
      db.run(`DELETE FROM ${table}`);
    }
    db.run(`UPDATE zur_crm_settings SET follow_ups = 1, birthdays = 1, next_reminder = NULL, reminder_time = '09:00', reminded_day = NULL`);
    // The stages went too: the service makes the default ones again on next use.
    (agent.store.crm as unknown as { ready: boolean }).ready = false;
  });
});

describe("/api/crm", () => {
  it("needs a session and the CSRF header", async () => {
    expect((await api("GET", "/crm", undefined, false)).status).toBe(401);
    expect((await api("POST", "/crm/clients", { name: "Ana" }, false)).status).toBe(401);
    const noCsrf = await call(`${ORIGIN}/api/crm`, { headers: { cookie, "cf-connecting-ip": IP } });
    expect(noCsrf.status).toBe(403);
    const noCsrfWrite = await call(`${ORIGIN}/api/crm/clients`, { method: "POST", headers: { cookie, "cf-connecting-ip": IP, "content-type": "application/json" }, body: "{}" });
    expect(noCsrfWrite.status).toBe(403);
  });

  it("starts with the five stages, nothing counted and every notice on", async () => {
    const view = await overview();
    expect(view.stages.map((stage) => [stage.name, stage.count])).toEqual([
      ["Novo", 0],
      ["Em conversa", 0],
      ["Agendado", 0],
      ["Cliente", 0],
      ["Inativo", 0],
    ]);
    expect(view.tags).toEqual([]);
    expect(view.summary).toEqual({ total: 0, overdue: 0, today: 0, week: 0, newThisWeek: 0 });
    expect(view.settings).toEqual({ followUps: true, birthdays: true, birthdayTime: "09:00" });
    // Nothing of the events other systems once sent: no address, no key, no secret.
    expect(Object.keys(view).sort()).toEqual(["limits", "settings", "stages", "summary", "tags"]);
    expect(JSON.stringify(view)).not.toMatch(/secret|zcrm_|events/i);
  });

  it("adds, reads, changes, notes and deletes a client", async () => {
    const [, conversa] = (await overview()).stages;
    const ana = await addClient({ name: " Ana  Souza ", phone: "+55 (11) 98888-7777", email: "ANA@Exemplo.com.br", birthday: "05-20", tags: ["VIP ", "vip", "retorno"] });
    expect(ana).toMatchObject({ name: "Ana  Souza", email: "ana@exemplo.com.br", birthday: "05-20", tags: ["retorno", "vip"], source: "app" });
    expect(((await (await api("GET", `/crm/clients/${ana.id}`)).json()) as { client: CrmClientDetail }).client.id).toBe(ana.id);

    const at = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const changed = await api("PATCH", `/crm/clients/${ana.id}`, { stageId: conversa?.id, tags: ["vip"], followUp: { at, note: "Ligar" } });
    expect(changed.status).toBe(200);
    const after = ((await changed.json()) as { client: CrmClientDetail }).client;
    expect(after).toMatchObject({ stageId: conversa?.id, tags: ["vip"], followUp: { at, note: "Ligar" } });
    expect(after.history.map((entry) => entry.kind)).toEqual(expect.arrayContaining(["stage", "tags", "follow_up"]));

    const note = await api("POST", `/crm/clients/${ana.id}/notes`, { text: "Pediu orçamento" });
    expect(note.status).toBe(201);
    expect(((await note.json()) as { entry: { kind: string; text: string } }).entry).toMatchObject({ kind: "note", text: "Pediu orçamento" });

    const view = await overview();
    expect(view.stages.find((stage) => stage.id === conversa?.id)?.count).toBe(1);
    expect(view.tags).toEqual(["vip"]);
    expect(view.summary).toMatchObject({ total: 1, week: 1, newThisWeek: 1 });

    expect((await api("DELETE", `/crm/clients/${ana.id}`)).status).toBe(200);
    expect((await api("GET", `/crm/clients/${ana.id}`)).status).toBe(404);
    expect((await api("DELETE", `/crm/clients/${ana.id}`)).status).toBe(404);
    expect((await overview()).tags).toEqual([]);
  });

  it("lists by name and filters by stage, tag, follow-up and text", async () => {
    const [novo, conversa] = (await overview()).stages;
    for (const name of ["Bruno", "Ana", "Carla"]) await addClient({ name, ...(name === "Carla" ? { stageId: conversa?.id, tags: ["vip"] } : {}) });
    // The page is a fixed 50 (paging itself is in the service's tests); the cursor is checked.
    const page = (await (await api("GET", "/crm/clients")).json()) as CrmClientPage;
    expect(page).toMatchObject({ clients: [{ name: "Ana" }, { name: "Bruno" }, { name: "Carla" }], next: null });
    expect((await api("GET", "/crm/clients?after=x")).status).toBe(400);
    expect((await api("GET", `/crm/clients?after=${encodeURIComponent("ana\n../../x")}`)).status).toBe(400);
    const names = async (query: string) => ((await (await api("GET", `/crm/clients?${query}`)).json()) as CrmClientPage).clients.map((client) => client.name);
    expect(await names(`stage=${novo?.id}`)).toEqual(["Ana", "Bruno"]);
    expect(await names("tag=VIP")).toEqual(["Carla"]);
    expect(await names("q=car")).toEqual(["Carla"]);
    expect(await names("followUp=any")).toEqual([]);
  });

  it("refuses what isn't a client: bad fields, unknown keys, a wrong id, a big body", async () => {
    const bad = await api("POST", "/crm/clients", { name: "", email: "não é e-mail", phone: "abc" });
    expect(bad.status).toBe(400);
    expect((await errorBody(bad)).code).toBe("VALIDATION_FAILED");
    expect((await api("POST", "/crm/clients", { name: "Ana", owner: "x" })).status).toBe(400);
    expect((await api("POST", "/crm/clients", { name: "Ana", tags: ["a,b"] })).status).toBe(400);
    expect((await api("POST", "/crm/clients", { name: "Ana", birthday: "02-30" })).status).toBe(400);
    expect((await api("PATCH", `/crm/clients/${crypto.randomUUID()}`, { name: "x" })).status).toBe(404);
    expect((await api("GET", "/crm/clients/..%2Fsettings")).status).toBe(404);
    expect((await api("GET", "/crm/clients?limit=1000")).status).toBe(400);
    expect((await api("GET", "/crm/clients?followUp=ontem")).status).toBe(400);
    const big = await api("POST", "/crm/clients", { name: "Ana", notes: "a".repeat(20_000) });
    expect([400, 413]).toContain(big.status);
  });

  it("changes the funnel: renames, reorders, adds; a removed stage's clients go to the first", async () => {
    const [novo, conversa, agendado] = (await overview()).stages;
    const ana = await addClient({ name: "Ana", stageId: agendado?.id });
    const res = await api("PATCH", "/crm/stages", { stages: [{ id: conversa?.id, name: "Conversando" }, { id: novo?.id, name: "Novo" }, { name: "Fechado" }] });
    expect(res.status).toBe(200);
    const stages = ((await res.json()) as CrmOverview).stages;
    expect(stages.map((stage) => [stage.name, stage.count])).toEqual([
      ["Conversando", 1],
      ["Novo", 0],
      ["Fechado", 0],
    ]);
    expect(((await (await api("GET", `/crm/clients/${ana.id}`)).json()) as { client: CrmClientDetail }).client.stageId).toBe(conversa?.id);
    expect((await api("PATCH", "/crm/stages", { stages: [{ name: "Só uma" }] })).status).toBe(400);
    expect((await api("PATCH", "/crm/stages", { stages: [{ name: "A" }, { name: "a" }] })).status).toBe(400);
    expect((await api("PATCH", "/crm/stages", { stages: Array.from({ length: 13 }, (_, i) => ({ name: `E${i}` })) })).status).toBe(400);
    expect((await api("PATCH", "/crm/stages", { stages: [{ id: crypto.randomUUID(), name: "A" }, { name: "B" }] })).status).toBe(404);
  });

  it("turns the notices off and on", async () => {
    const res = await api("PATCH", "/crm/settings", { birthdays: false });
    expect(res.status).toBe(200);
    expect((await overview()).settings).toEqual({ followUps: true, birthdays: false, birthdayTime: "09:00" });
    // The notice of clients from n8n went with the events.
    expect((await api("PATCH", "/crm/settings", { newClients: false })).status).toBe(400);
    expect((await api("PATCH", "/crm/settings", { birthdays: "no" })).status).toBe(400);
    expect((await api("PATCH", "/crm/settings", { other: true })).status).toBe(400);
  });

  it("saves the birthday notice's time, a time of the clock only, and nothing else", async () => {
    const res = await api("PATCH", "/crm/settings", { birthdayTime: "07:45" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ settings: { followUps: true, birthdays: true, birthdayTime: "07:45" } });
    for (const body of [
      { birthdayTime: "24:00" },
      { birthdayTime: "7:45" },
      { birthdayTime: "07:60" },
      { birthdayTime: "07:45:00" },
      { birthdayTime: "07:45\n" },
      { birthdayTime: 745 },
      // What the plan fixes, and what went with n8n's events, is nobody's to send.
      { newClients: false },
      { newClientNoticesPerDay: 5 },
      { eventsPerHour: 100 },
      { eventsPerDay: 100 },
    ]) {
      const refused = await api("PATCH", "/crm/settings", body);
      expect(refused.status, JSON.stringify(body)).toBe(400);
    }
    // A body past 1 KB is refused before it is read, whatever it holds.
    const big = await call(`${ORIGIN}/api/crm/settings`, { method: "PATCH", headers: headers(true), body: `{"birthdayTime":"08:00"${" ".repeat(1_024)}}` });
    expect(big.status).toBe(400);
    expect(await errorBody(big)).toMatchObject({ code: "VALIDATION_FAILED", details: { fields: ["_body"] } });
    expect((await overview()).settings).toMatchObject({ birthdayTime: "07:45" });
  });

  it("has no door for other systems: the signed events' address and its key are gone", async () => {
    // A key left on by a database from before the removal opens nothing.
    const key = "A".repeat(22);
    await inOwner((agent) => agent.store.db.run(`UPDATE zur_crm_settings SET events_key = ? WHERE id = 1`, key));
    const body = JSON.stringify({ id: "evt-1", type: "client.upsert", data: { ref: "cw-1", name: "Eva Lima" } });
    const timestamp = String(Math.floor(Date.now() / 1000));
    // Signed the way the removed route asked, with the secret it derived for that key.
    const mac = async (secret: string, message: string) => {
      const raw = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      return new Uint8Array(await crypto.subtle.sign("HMAC", raw, new TextEncoder().encode(message)));
    };
    const secret = `zcrm_${btoa(String.fromCharCode(...(await mac(testEnv.SESSION_SECRET, `zuri:crm-events:v1:${key}`))))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "")}`;
    const signature = `sha256=${[...(await mac(secret, `${timestamp}.${body}`))].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
    const signed = { "content-type": "application/json", "cf-connecting-ip": IP, "x-zuri-timestamp": timestamp, "x-zuri-signature": signature };
    // With no session it is any other API address: refused before anything is read.
    const outside = await call(`${ORIGIN}/api/crm/events/${key}`, { method: "POST", headers: signed, body });
    expect(outside.status).toBe(403);
    expect((await errorBody(outside)).code).toBe("CSRF_FAILED");
    const noCookie = await call(`${ORIGIN}/api/crm/events/${key}`, { method: "POST", headers: { ...signed, ...CSRF }, body });
    expect(noCookie.status).toBe(401);
    expect((await errorBody(noCookie)).code).toBe("UNAUTHORIZED");
    // With Cloudflare Access on, the signature is no way round it any more.
    const behindAccess = await call(`${ORIGIN}/api/crm/events/${key}`, { method: "POST", headers: { ...signed, ...CSRF }, body }, { ACCESS_TEAM_DOMAIN: "equipe.cloudflareaccess.com", ACCESS_AUD: "a".repeat(64) });
    expect(behindAccess.status).toBe(403);
    expect((await errorBody(behindAccess)).code).toBe("FORBIDDEN");
    // With the owner's session there is no such route.
    expect((await api("POST", `/crm/events/${key}`, JSON.parse(body))).status).toBe(404);
    expect((await api("POST", "/crm/events-key")).status).toBe(404);
    expect((await api("DELETE", "/crm/events-key")).status).toBe(404);
    expect(await (await api("GET", "/crm/clients")).json()).toMatchObject({ clients: [] });
    await inOwner((agent) => agent.store.db.run(`UPDATE zur_crm_settings SET events_key = NULL WHERE id = 1`));
  });

  it("answers 423 to every CRM route in a lockdown", async () => {
    const ana = await addClient({ name: "Ana" });
    await inOwner((agent) => new InternalState(agent.store.db).set("lockdown_until", new Date(Date.now() + 3_600_000).toISOString()));
    for (const [method, path, body] of [
      ["GET", "/crm"],
      ["GET", "/crm/clients"],
      ["POST", "/crm/clients", { name: "Bia" }],
      ["PATCH", `/crm/clients/${ana.id}`, { name: "Ana Maria" }],
      ["DELETE", `/crm/clients/${ana.id}`],
    ] as [string, string, unknown?][]) {
      expect((await api(method, path, body)).status, `${method} ${path}`).toBe(423);
    }
  });
});

describe("/api/flows/drafts", () => {
  const draft = () =>
    inOwner((agent) =>
      agent.store.flows.saveDraft({
        name: "Monitor sugerido",
        definition: { version: 1, trigger: { type: "manual" }, nodes: [{ type: "monitor", sites: ["https://loja.exemplo.com.br"] }] },
      }),
    );

  it("lists the chat's suggestions with the flows and drops one", async () => {
    const saved = await draft();
    const list = (await (await api("GET", "/flows")).json()) as FlowList;
    expect(list.drafts).toEqual([expect.objectContaining({ id: saved.id, name: "Monitor sugerido" })]);
    expect(list.flows).toEqual([]);
    expect((await api("DELETE", `/flows/drafts/${saved.id}`)).status).toBe(200);
    expect((await api("DELETE", `/flows/drafts/${saved.id}`)).status).toBe(404);
    expect(((await (await api("GET", "/flows")).json()) as FlowList).drafts).toEqual([]);
  });

  it("turns a suggestion into a flow only when the owner saves it with the password; it starts off and the suggestion goes", async () => {
    const saved = await draft();
    await stale();
    expect((await api("POST", "/flows", { name: saved.name, definition: saved.definition, draft: saved.id })).status).toBe(403);
    await fresh();
    const res = await api("POST", "/flows", { name: saved.name, definition: saved.definition, draft: saved.id });
    expect(res.status).toBe(201);
    const list = (await (await api("GET", "/flows")).json()) as FlowList;
    expect(list.drafts).toEqual([]);
    expect(list.flows).toEqual([expect.objectContaining({ name: "Monitor sugerido", enabled: false })]);
    await inOwner((agent) => {
      for (const table of ["zur_flow_runs", "zur_flow_sites", "zur_flows"]) agent.store.db.run(`DELETE FROM ${table}`);
    });
  });
});
