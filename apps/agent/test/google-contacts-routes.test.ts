import { AGENT_INSTANCE_NAME, type ContactDetail, type ContactPage, type ContactsStatus, type MemoryGraph, type NoticePage } from "@zuri/shared";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ZuriAgent } from "../src/agent/zuri-agent.ts";
import { InternalState } from "../src/db/internal-state.ts";
import { type DevGoogle, devGoogle, googleNetwork } from "../src/google/dev-google.ts";
import { call, CSRF, errorBody, HUMAN_TOKEN, ORIGIN, TEST_EMAIL, TEST_PASSWORD, testEnv, signedCookies } from "./helpers.ts";

// Step 19b: Settings › Integrations › Google › Contacts and the Contacts screen, through the Worker.

const IP = "192.0.2.191";
let cookie = "";
let google: DevGoogle;
const owner = () => testEnv.AGENT.get(testEnv.AGENT.idFromName(AGENT_INSTANCE_NAME));
const inOwner = <T>(fn: (agent: ZuriAgent) => T | Promise<T>) => runInDurableObject(owner(), (agent: ZuriAgent) => fn(agent));

const headers = (withCookie = true) => ({ ...CSRF, "content-type": "application/json", "cf-connecting-ip": IP, ...(withCookie ? { cookie } : {}) });
const api = (method: string, path: string, body?: unknown, withCookie = true) =>
  call(`${ORIGIN}/api${path}`, { method, headers: headers(withCookie), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const stale = () => inOwner((agent) => agent.store.db.run(`UPDATE zur_sessions SET confirmed_at = ?`, Date.now() - 16 * 60_000));
/** "Sync now" is once a minute: the minute passes. */
const minuteLater = () => inOwner((agent) => agent.store.db.run(`UPDATE zur_contact_sync SET synced_now_at = synced_now_at - 60000`));
const fresh = () => inOwner((agent) => agent.store.db.run(`UPDATE zur_sessions SET confirmed_at = ?`, Date.now()));

const CLIENTS = "contactGroups/clientes";
const FAMILY = "contactGroups/familia";

async function consent(path: string): Promise<Response> {
  const begin = await api("POST", path);
  expect(begin.status).toBe(200);
  const { url } = (await begin.json()) as { url: string };
  const params = new URL(url).searchParams;
  return api("POST", "/google/callback", { state: params.get("state") ?? "", code: `dev.${params.get("code_challenge") ?? ""}` });
}

/** The calendar, then the contacts through Google's page, then a first sync. */
async function turnOn(): Promise<ContactsStatus> {
  expect((await consent("/google/connect")).status).toBe(200);
  const res = await consent("/google/contacts/connect");
  expect(res.status).toBe(200);
  expect(((await res.json()) as { purpose: string }).purpose).toBe("contacts");
  const synced = await api("POST", "/google/contacts/sync");
  expect(synced.status).toBe(200);
  return (await synced.json()) as ContactsStatus;
}

/** How many times the alarm was set again while `work` ran (the routes that move a time must do it). */
async function countRearms(work: () => Promise<unknown>): Promise<number> {
  let count = 0;
  const real = await inOwner((agent) => {
    const { automations } = agent.store;
    const original = automations.rearm;
    automations.rearm = (...args: Parameters<typeof original>) => {
      count++;
      return original.apply(automations, args);
    };
    return original;
  });
  try {
    await work();
  } finally {
    await inOwner((agent) => {
      agent.store.automations.rearm = real;
    });
  }
  return count;
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
  google = devGoogle({ clientId: testEnv.GOOGLE_CLIENT_ID, clientSecret: testEnv.GOOGLE_CLIENT_SECRET });
  google.people.groups.push(
    { resourceName: CLIENTS, name: "Clientes", groupType: "USER_CONTACT_GROUP", memberCount: 1 },
    { resourceName: FAMILY, name: "Família", groupType: "USER_CONTACT_GROUP", memberCount: 1 },
  );
  const member = (label: string) => [{ contactGroupMembership: { contactGroupResourceName: label } }];
  google.people.add({ resourceName: "people/c1", names: [{ displayName: "Ana Souza" }], phoneNumbers: [{ value: "(11) 99999-0001" }], memberships: member(CLIENTS) });
  google.people.add({ resourceName: "people/c2", names: [{ displayName: "Bruno" }], memberships: member(FAMILY) });
  await inOwner((agent) => {
    agent.store.google.network = googleNetwork(google, { fetch: () => Promise.reject(new Error("no network in tests")) });
  });
  await fresh();
});

afterEach(async () => {
  await inOwner(async (agent) => {
    const { db } = agent.store;
    const state = new InternalState(db);
    state.delete("lockdown_until");
    // The owner's interval outlives turning off: each test starts from the installation's.
    db.run(`UPDATE zur_contact_sync SET sync_every_min = 5`);
    state.delete("google_oauth_pending");
    agent.store.contacts.disable();
    for (const table of ["zur_google_calendars", "zur_google_account", "zur_auth_events", "zur_notices"]) db.run(`DELETE FROM ${table}`);
  });
});

describe("/api/google/contacts", () => {
  it("needs a session and the CSRF header", async () => {
    expect((await api("GET", "/google/contacts", undefined, false)).status).toBe(401);
    expect((await call(`${ORIGIN}/api/google/contacts`, { headers: { cookie, "cf-connecting-ip": IP } })).status).toBe(403);
    expect((await api("GET", "/contacts", undefined, false)).status).toBe(401);
  });

  it("starts off, and can't be turned on before the calendar is connected", async () => {
    const status = (await (await api("GET", "/google/contacts")).json()) as ContactsStatus;
    expect(status).toMatchObject({ connected: false, enabled: false, status: "off", problem: null, contacts: 0, labels: [] });
    const res = await api("POST", "/google/contacts/connect");
    expect(res.status).toBe(409);
    expect((await errorBody(res)).code).toBe("CONFLICT");
  });

  it("saves the owner's interval between two reads, within a minute and a day, and plans the next read by it", async () => {
    const on = await turnOn();
    expect(on.syncEveryMinutes).toBe(5);
    for (const body of [{ syncEveryMinutes: 0 }, { syncEveryMinutes: -1 }, { syncEveryMinutes: 1_441 }, { syncEveryMinutes: 7.5 }, { syncEveryMinutes: "15" }, { syncEveryMinutes: null }, { syncEveryMs: 60_000 }]) {
      const res = await api("PATCH", "/google/contacts/settings", body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect((await errorBody(res)).code).toBe("VALIDATION_FAILED");
    }
    // Nothing of a refused body was kept.
    expect(((await (await api("GET", "/google/contacts")).json()) as ContactsStatus).syncEveryMinutes).toBe(5);
    // A minute next to the reviews' own minute doesn't fit in the day: 409 with the count, and nothing of the body kept.
    await inOwner((agent) => {
      agent.store.db.run(`INSERT INTO zur_review_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING`);
      agent.store.db.run(`UPDATE zur_review_settings SET check_every_min = 1 WHERE id = 1`);
    });
    const full = await api("PATCH", "/google/contacts/settings", { syncEveryMinutes: 1, daysAhead: 3 });
    expect(full.status).toBe(409);
    expect(await errorBody(full)).toMatchObject({ code: "CONFLICT", details: { limit: 5_728, cost: 8_640 } });
    const kept = (await (await api("GET", "/google/contacts")).json()) as ContactsStatus;
    expect(kept.syncEveryMinutes).toBe(5);
    expect(kept.reminders.daysAhead).toBe(on.reminders.daysAhead);
    await inOwner((agent) => agent.store.db.run(`UPDATE zur_review_settings SET check_every_min = 10 WHERE id = 1`));
    for (const minutes of [1, 5, 1_440, 15]) {
      const res = await api("PATCH", "/google/contacts/settings", { syncEveryMinutes: minutes });
      expect(res.status).toBe(200);
      const status = (await res.json()) as ContactsStatus;
      expect(status.syncEveryMinutes).toBe(minutes);
      expect(Date.parse(status.nextSyncAt ?? "") - Date.parse(status.lastSyncAt ?? "")).toBe(minutes * 60_000);
    }
    const status = (await (await api("GET", "/google/contacts")).json()) as ContactsStatus;
    // The alarm's time is the sooner of the read and the day's notice (08:00 in the owner's zone):
    // in the quarter of an hour before the notice, it comes first.
    const notice = await inOwner((agent) => agent.store.db.one<{ next_reminder: number | null }>(`SELECT next_reminder FROM zur_contact_sync`));
    expect(await inOwner((agent) => agent.store.contacts.nextDue())).toBe(Math.min(Date.parse(status.nextSyncAt ?? ""), notice?.next_reminder ?? Number.POSITIVE_INFINITY));
    // The alarm itself is set again by the route, so a shorter interval doesn't wait for the old wake.
    const rearmed = await countRearms(() => api("PATCH", "/google/contacts/settings", { syncEveryMinutes: 5 }));
    expect(rearmed).toBe(1);
    const alarm = await runInDurableObject(owner(), (_agent: ZuriAgent, state) => state.storage.getAlarm());
    const short = (await (await api("GET", "/google/contacts")).json()) as ContactsStatus;
    expect(alarm ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(Date.parse(short.nextSyncAt ?? ""));
    // Without a session, nothing.
    expect((await api("PATCH", "/google/contacts/settings", { syncEveryMinutes: 30 }, false)).status).toBe(401);
    expect(((await (await api("GET", "/google/contacts")).json()) as ContactsStatus).syncEveryMinutes).toBe(5);
  });

  it("asks for the password typed recently to turn the contacts on, to add a label and to turn them off", async () => {
    expect((await consent("/google/connect")).status).toBe(200);
    await stale();
    expect((await errorBody(await api("POST", "/google/contacts/connect"))).code).toBe("RECENT_AUTH_REQUIRED");
    await fresh();
    await turnOn();
    await stale();
    expect((await errorBody(await api("PATCH", "/google/contacts/labels", { selected: [CLIENTS] }))).code).toBe("RECENT_AUTH_REQUIRED");
    expect((await errorBody(await api("DELETE", "/google/contacts"))).code).toBe("RECENT_AUTH_REQUIRED");
    // Removing labels and syncing don't.
    expect((await api("PATCH", "/google/contacts/labels", { selected: [] })).status).toBe(200);
    await minuteLater();
    expect((await api("POST", "/google/contacts/sync")).status).toBe(200);
  });

  it("turns on through Google's page, copies the chosen labels and searches the copy", async () => {
    const first = await turnOn();
    expect(first).toMatchObject({ enabled: true, status: "ok", contacts: 0 });
    expect(first.labels.map((label) => label.name)).toEqual(["Clientes", "Família"]);
    const chosen = await api("PATCH", "/google/contacts/labels", { selected: [CLIENTS, CLIENTS] });
    expect(chosen.status).toBe(200);
    expect(((await chosen.json()) as ContactsStatus).labels.filter((label) => label.selected).map((label) => label.id)).toEqual([CLIENTS]);
    expect(((await (await api("POST", "/google/contacts/sync")).json()) as ContactsStatus).contacts).toBe(1);
    const page = (await (await api("GET", "/contacts?q=99999")).json()) as ContactPage;
    expect(page.contacts.map((contact) => contact.name)).toEqual(["Ana Souza"]);
    const one = await api("GET", `/contacts/${page.contacts[0]?.id ?? ""}`);
    expect(((await one.json()) as { contact: ContactDetail }).contact).toMatchObject({ name: "Ana Souza", labels: ["Clientes"], googleUrl: "https://contacts.google.com/person/c1" });
    expect((await api("GET", "/contacts/00000000-0000-4000-8000-000000000000")).status).toBe(404);
    // The owner's grant at Google now holds the contacts too, and the event is on record.
    const events = await inOwner((agent) => agent.store.db.all<{ kind: string }>(`SELECT kind FROM zur_auth_events WHERE kind = 'google_connected'`));
    expect(events).toHaveLength(2);
  });

  it("refuses malformed input", async () => {
    await turnOn();
    for (const body of [{ selected: ["people/c1"] }, { selected: "x" }, { selected: [], other: 1 }]) expect((await api("PATCH", "/google/contacts/labels", body)).status).toBe(400);
    for (const body of [{}, { time: "24:00" }, { daysAhead: 31 }, { daysAhead: -1 }, { match: "a‮b" }, { match: "x".repeat(61) }, { onAdded: "sms" }, { extra: true }]) {
      expect((await api("PATCH", "/google/contacts/settings", body)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await api("GET", `/contacts?q=${"a".repeat(101)}`)).status).toBe(400);
    expect((await api("GET", "/contacts?label=people/c1")).status).toBe(400);
    expect((await api("GET", "/contacts?after=x")).status).toBe(400);
    expect((await api("GET", "/contacts?unknown=1")).status).toBe(200);
  });

  it("saves the notices' choices and plans the next one", async () => {
    await turnOn();
    const res = await api("PATCH", "/google/contacts/settings", { birthdays: true, dates: true, time: "07:30", daysAhead: 30, match: " Retorno ", onAdded: "task" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as ContactsStatus).reminders).toEqual({ birthdays: true, dates: true, time: "07:30", daysAhead: 30, match: "Retorno" });
    const next = await inOwner((agent) => agent.store.db.one<{ next_reminder: number }>(`SELECT next_reminder FROM zur_contact_sync`));
    expect(next?.next_reminder).toBeGreaterThan(Date.now());
  });

  it("\"Sync now\" copies the label saved while it waited for Google, in the same answer (issue #264)", async () => {
    await turnOn();
    expect((await api("PATCH", "/google/contacts/labels", { selected: [CLIENTS] })).status).toBe(200);
    expect((await api("POST", "/google/contacts/sync")).status).toBe(200);
    await minuteLater();
    // The other label is saved while the next sync reads the contacts at Google.
    const real = google.handle.bind(google);
    let saved = false;
    await inOwner((agent) => {
      google.handle = async (request) => {
        if (!saved && new URL(request.url).pathname === "/v1/people/me/connections") {
          saved = true;
          agent.store.contacts.select([CLIENTS, FAMILY]);
        }
        return real(request);
      };
    });
    const res = await api("POST", "/google/contacts/sync");
    google.handle = real;
    expect(saved).toBe(true);
    expect(res.status).toBe(200);
    expect((await res.json()) as ContactsStatus & { outcome: string }).toMatchObject({ outcome: "ok", status: "ok", contacts: 2 });
  });

  it("\"Sync now\" is once a minute: the second answers 429 with the seconds to wait and never reaches Google", async () => {
    await turnOn();
    const calls = google.seen.length;
    const res = await api("POST", "/google/contacts/sync");
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    expect(Number(res.headers.get("retry-after"))).toBeLessThanOrEqual(60);
    const body = await errorBody(res);
    expect(body.code).toBe("RATE_LIMITED");
    expect(body.message).toBe("Os contatos acabaram de ser sincronizados. Tente de novo daqui a um minuto.");
    expect(google.seen.length).toBe(calls);
    await minuteLater();
    expect((await api("POST", "/google/contacts/sync")).status).toBe(200);
  });

  it("the status tells when the next read is and how the last one went, with nothing of the sync's tokens", async () => {
    // The first read brings the labels, new to Zuri: it changed something.
    const status = (await turnOn()) as ContactsStatus & Record<string, unknown>;
    expect(status).toMatchObject({ status: "ok", lastResult: "changed", refreshing: false });
    const wait = Date.parse(status.nextSyncAt ?? "") - Date.parse(status.lastSyncAt ?? "");
    expect(wait).toBe(5 * 60_000);
    expect(Object.keys(status).sort()).toEqual(["connected", "contacts", "enabled", "labels", "labelsRead", "lastResult", "lastSyncAt", "nextSyncAt", "onAdded", "outcome", "problem", "refreshing", "reminders", "status", "syncEveryMinutes"]);
    expect(JSON.stringify(status)).not.toMatch(/sync\.\d|people_sync_token|page_token/);
  });

  it("the label picker's refresh brings the labels from Google, needs the contacts on and a session, and reads no contact", async () => {
    expect((await api("POST", "/google/contacts/labels/refresh", undefined, false)).status).toBe(401);
    expect((await api("POST", "/google/contacts/labels/refresh")).status).toBe(409);
    await turnOn();
    // The labels were read when the owner came back from Google's page: the minute passes.
    await inOwner((agent) => agent.store.db.run(`UPDATE zur_contact_sync SET labels_read_at = labels_read_at - 60000, labels_asked_at = labels_asked_at - 60000`));
    google.people.groups.push({ resourceName: "contactGroups/nova", name: "Nova", groupType: "USER_CONTACT_GROUP", memberCount: 4 });
    try {
      const people = google.seen.filter((seen) => seen.url.includes("/people/me/connections")).length;
      const res = await api("POST", "/google/contacts/labels/refresh");
      expect(res.status).toBe(200);
      expect(((await res.json()) as ContactsStatus).labels.map((label) => [label.name, label.count])).toEqual([["Clientes", 1], ["Família", 1], ["Nova", 4]]);
      expect(google.seen.filter((seen) => seen.url.includes("/people/me/connections")).length).toBe(people);
      // Asked again at once: the list kept answers, Google is left alone.
      const calls = google.seen.length;
      expect((await api("POST", "/google/contacts/labels/refresh")).status).toBe(200);
      expect(google.seen.length).toBe(calls);
    } finally {
      google.people.groups.pop();
    }
  });

  it("the label picker's refresh says Google didn't answer, and two at once go to Google once", async () => {
    await turnOn();
    await inOwner((agent) => agent.store.db.run(`UPDATE zur_contact_sync SET labels_read_at = labels_read_at - 60000, labels_asked_at = NULL`));
    const calls = () => google.seen.filter((seen) => seen.url.includes("/contactGroups")).length;
    const before = calls();
    const both = await Promise.all([api("POST", "/google/contacts/labels/refresh"), api("POST", "/google/contacts/labels/refresh")]);
    expect(both.map((res) => res.status)).toEqual([200, 200]);
    expect(calls()).toBe(before + 1);
    await inOwner((agent) => agent.store.db.run(`UPDATE zur_contact_sync SET labels_read_at = labels_read_at - 60000, labels_asked_at = NULL`));
    google.people.failure = { status: 503, body: { error: { code: 503 } } };
    try {
      const res = await api("POST", "/google/contacts/labels/refresh");
      expect(res.status).toBe(503);
      expect(await errorBody(res)).toMatchObject({ code: "SERVICE_UNAVAILABLE" });
      expect(await inOwner((agent) => agent.store.db.one<{ at: number | null }>(`SELECT running_since AS at FROM zur_contact_sync WHERE id = 1`)?.at)).toBeNull();
    } finally {
      google.people.failure = null;
    }
  });

  it("SEC-S09-02: saving the same labels and pressing \"Sync now\" in a loop stays at one sync a minute", async () => {
    await turnOn();
    expect((await api("PATCH", "/google/contacts/labels", { selected: [CLIENTS] })).status).toBe(200);
    expect((await api("POST", "/google/contacts/sync")).status).toBe(200);
    for (let i = 0; i < 3; i++) {
      expect((await api("PATCH", "/google/contacts/labels", { selected: [CLIENTS] })).status).toBe(200);
      expect((await api("POST", "/google/contacts/sync")).status).toBe(429);
    }
  });

  it("says when a sync is already running and when the contacts are off", async () => {
    await turnOn();
    await minuteLater();
    await inOwner((agent) => agent.store.db.run(`UPDATE zur_contact_sync SET running_since = ?`, Date.now()));
    const busy = await api("POST", "/google/contacts/sync");
    expect(busy.status).toBe(409);
    await inOwner((agent) => agent.store.db.run(`UPDATE zur_contact_sync SET running_since = NULL`));
    expect((await api("DELETE", "/google/contacts")).status).toBe(200);
    for (const [method, path, body] of [
      ["POST", "/google/contacts/sync", undefined],
      ["PATCH", "/google/contacts/labels", { selected: [CLIENTS] }],
      ["PATCH", "/google/contacts/settings", { birthdays: false }],
    ] as const) {
      const res = await api(method, path, body);
      expect(res.status).toBe(409);
    }
    expect(((await (await api("GET", "/contacts")).json()) as ContactPage).contacts).toEqual([]);
  });

  it("turning off forgets the copy; disconnecting Google revokes the access and forgets it too", async () => {
    await turnOn();
    await api("PATCH", "/google/contacts/labels", { selected: [CLIENTS] });
    await api("POST", "/google/contacts/sync");
    const off = (await (await api("DELETE", "/google/contacts")).json()) as ContactsStatus;
    expect(off).toMatchObject({ enabled: false, contacts: 0, labels: [] });
    expect(await inOwner((agent) => agent.store.db.one(`SELECT count(*) AS n FROM zur_contacts`))).toEqual({ n: 0 });
    // The calendar goes on.
    expect(await inOwner((agent) => agent.store.google.connected())).toBe(true);
    await turnOn();
    await api("PATCH", "/google/contacts/labels", { selected: [CLIENTS] });
    await api("POST", "/google/contacts/sync");
    expect((await api("DELETE", "/google")).status).toBe(200);
    expect(google.revoked).toHaveLength(1);
    expect(await inOwner((agent) => agent.store.db.one(`SELECT count(*) AS n FROM zur_contacts`))).toEqual({ n: 0 });
  });

  it("SEC-A9-01 and SEC-A12-01: a contact's name stays out of a notice's title, and turning off takes the notices made from the copy", async () => {
    await turnOn();
    await inOwner((agent) => {
      agent.store.alerts.raise({ kind: "contacts.added", category: "reminders", priority: "normal", params: { name: "Ana Souza", label: "Clientes" }, link: "/contatos" });
      agent.store.alerts.raise({ kind: "contacts.birthdays", category: "reminders", priority: "normal", params: { names: "Ana Souza" }, link: "/contatos" });
      agent.store.alerts.raise({ kind: "google.reconnect", category: "system", priority: "normal", link: "/configuracoes/integracoes" });
    });
    const before = (await (await api("GET", "/notices")).json()) as NoticePage;
    const added = before.notices.find((notice) => notice.kind === "contacts.added");
    // The title is what a discreet Telegram notice or a locked phone shows; the name only in the body.
    expect(added?.title).toBe("Contato novo numa etiqueta");
    expect(added?.body).toContain("Ana Souza");
    expect((await api("DELETE", "/google/contacts")).status).toBe(200);
    const after = (await (await api("GET", "/notices")).json()) as NoticePage;
    expect(after.notices.map((notice) => notice.kind)).toEqual(["google.reconnect"]);
  });

  it("does nothing during a lockdown", async () => {
    await turnOn();
    await inOwner((agent) => new InternalState(agent.store.db).set("lockdown_until", new Date(Date.now() + 3_600_000).toISOString()));
    for (const [method, path] of [
      ["GET", "/google/contacts"],
      ["POST", "/google/contacts/sync"],
      ["POST", "/google/contacts/labels/refresh"],
      ["GET", "/contacts"],
    ] as const) {
      expect((await api(method, path)).status).toBe(423);
    }
  });
});

describe("the owner's way of naming, the first setup and two people with one name", () => {
  const member = (label: string) => [{ contactGroupMembership: { contactGroupResourceName: label } }];
  const PRIMARY = "dono@exemplo.com.br";
  const list = async (query = "") => ((await (await api("GET", `/contacts${query}`)).json()) as ContactPage).contacts;
  const detail = async (id: string) => ((await (await api("GET", `/contacts/${id}`)).json()) as { contact: ContactDetail }).contact;
  const choose = async (...labels: string[]) => {
    expect((await api("PATCH", "/google/contacts/labels", { selected: labels })).status).toBe(200);
    await minuteLater();
    expect((await api("POST", "/google/contacts/sync")).status).toBe(200);
  };

  it("coming back from Google's page brings the labels at once, and no contact is copied before one is chosen", async () => {
    expect((await consent("/google/connect")).status).toBe(200);
    expect((await consent("/google/contacts/connect")).status).toBe(200);
    // Before any sync: the labels are there to choose from, read from Google, none chosen, nobody copied.
    const status = (await (await api("GET", "/google/contacts")).json()) as ContactsStatus;
    expect(status).toMatchObject({ enabled: true, labelsRead: true, contacts: 0 });
    expect(status.labels.map((label) => [label.name, label.selected])).toEqual([["Clientes", false], ["Família", false]]);
    expect(google.seen.filter((seen) => seen.url.includes("/people/me/connections"))).toHaveLength(0);
    // A sync with nothing chosen reads no contact either.
    expect((await api("POST", "/google/contacts/sync")).status).toBe(200);
    expect(google.seen.filter((seen) => seen.url.includes("/people/me/connections"))).toHaveLength(0);
    expect(await list()).toEqual([]);
    // Only the chosen label's contacts come.
    await choose(CLIENTS);
    expect((await list()).map((contact) => contact.name)).toEqual(["Ana Souza"]);
    // Unchoosing everything right after is still "the labels are here, choose": never "reading" or "failed" again.
    const none = await api("PATCH", "/google/contacts/labels", { selected: [] });
    expect(none.status).toBe(200);
    expect((await (await api("GET", "/google/contacts")).json()) as ContactsStatus).toMatchObject({ labelsRead: true, contacts: 0 });
  });

  it("Google failing when the owner comes back still turns the contacts on; the labels come with the next read", async () => {
    expect((await consent("/google/connect")).status).toBe(200);
    google.people.failure = { status: 503, body: { error: { code: 503 } } };
    try {
      expect((await consent("/google/contacts/connect")).status).toBe(200);
    } finally {
      google.people.failure = null;
    }
    expect((await (await api("GET", "/google/contacts")).json()) as ContactsStatus).toMatchObject({ enabled: true, labelsRead: false, labels: [], contacts: 0 });
    // QA-CN-03: the read that failed doesn't hold the next one back; the owner asks again at once.
    const refreshed = (await (await api("POST", "/google/contacts/labels/refresh")).json()) as ContactsStatus;
    expect(refreshed).toMatchObject({ labelsRead: true });
    expect(refreshed.labels).toHaveLength(2);
  });

  it("keeps the name without the note written after it, finds it by either, and shows the note apart", async () => {
    google.people.add({
      resourceName: "people/c3",
      names: [{ displayName: "Beatriz Novaes Conceição / Paciente", givenName: "Beatriz", middleName: "Novaes", familyName: "Conceição / Paciente" }],
      phoneNumbers: [{ value: "(41) 99999-0110" }, { value: "(41) 3333-0110" }],
      emailAddresses: [{ value: "beatriz@exemplo.com.br" }, { value: "beatriz2@exemplo.com.br" }],
      photos: [{ url: "https://lh3.googleusercontent.com/contacts/beatriz" }],
      memberships: member(CLIENTS),
    });
    google.people.add({ resourceName: "people/c4", names: [{ displayName: "Empresa Exemplo S/A" }], photos: [{ url: "https://exemplo.com.br/x.png" }], memberships: member(CLIENTS) });
    await turnOn();
    await choose(CLIENTS);
    const all = await list();
    expect(all.map((contact) => contact.name)).toEqual(["Ana Souza", "Beatriz Novaes Conceição", "Empresa Exemplo S/A"]);
    expect(all[1]).toMatchObject({ note: "Paciente", phone: "(41) 99999-0110", photo: "https://lh3.googleusercontent.com/contacts/beatriz", cpf: null });
    expect(all[2]).toMatchObject({ note: "", photo: null });
    expect((await list("?q=conceicao")).map((contact) => contact.name)).toEqual(["Beatriz Novaes Conceição"]);
    expect((await list("?q=paciente")).map((contact) => contact.name)).toEqual(["Beatriz Novaes Conceição"]);
    const beatriz = await detail(all[1]?.id ?? "");
    expect(beatriz).toMatchObject({ name: "Beatriz Novaes Conceição", given: "Beatriz", middle: "Novaes", family: "Conceição", note: "Paciente", sameName: 0 });
    expect(beatriz.phones).toHaveLength(2);
    expect(beatriz.emails).toHaveLength(2);
    // Nothing of the note is left in the database's name.
    expect(await inOwner((agent) => agent.store.db.all<{ display_name: string }>(`SELECT display_name FROM zur_contacts WHERE display_name LIKE '%/ Paciente%'`))).toEqual([]);
  });

  it("a contact renamed at Google with a note keeps its id and its clean name", async () => {
    await turnOn();
    await choose(CLIENTS);
    const [before] = await list();
    google.people.update("people/c1", { names: [{ displayName: "Ana Souza / Prospect" }] });
    await minuteLater();
    expect((await api("POST", "/google/contacts/sync")).status).toBe(200);
    const [after] = await list();
    expect(after).toMatchObject({ id: before?.id, name: "Ana Souza", note: "Prospect" });
  });

  it("two people with one name stay two contacts, each told apart by phone, birthday and CPF", async () => {
    google.people.add({
      resourceName: "people/c5",
      names: [{ displayName: "Marcos Vieira Lopes / Paciente" }],
      phoneNumbers: [{ value: "(41) 97777-0112" }],
      birthdays: [{ date: { year: 1979, month: 2, day: 11 } }],
      userDefined: [{ key: "CPF", value: "529.982.247-25" }],
      memberships: member(CLIENTS),
    });
    google.people.add({
      resourceName: "people/c6",
      names: [{ displayName: "MARCOS  VIEIRA LOPES" }],
      phoneNumbers: [{ value: "(41) 96666-0113" }],
      birthdays: [{ date: { year: 1994, month: 9, day: 3 } }],
      userDefined: [{ key: "CPF", value: "111.444.777-35" }],
      memberships: member(CLIENTS),
    });
    google.people.add({ resourceName: "people/c7", names: [{ displayName: "Marcos Vieira Lopes Filho" }], memberships: member(CLIENTS) });
    await turnOn();
    await choose(CLIENTS);
    const marcos = (await list("?q=marcos vieira lopes")).filter((contact) => /^marcos\s+vieira lopes$/i.test(contact.name));
    expect(marcos).toHaveLength(2);
    expect(marcos.map((contact) => [contact.phone, contact.birthdayFull, contact.cpf]).sort()).toEqual([
      ["(41) 96666-0113", "1994-09-03", "***.444.777-**"],
      ["(41) 97777-0112", "1979-02-11", "***.982.247-**"],
    ]);
    for (const contact of marcos) expect((await detail(contact.id)).sameName).toBe(1);
    // A longer name is someone else, not a namesake.
    const [son] = (await list("?q=filho"));
    expect((await detail(son?.id ?? "")).sameName).toBe(0);
    // The whole CPF never leaves in the list.
    expect(JSON.stringify(await list())).not.toMatch(/52998224725|529\.982\.247-25/);
  });

  it("SEC-CN-01: many longer names that begin the same never hide the namesake, nor count as one", async () => {
    for (let i = 0; i < 70; i++) {
      google.people.add({ resourceName: `people/d${i}`, names: [{ displayName: `Marcos Vieira Lopes ${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}lves` }], memberships: member(CLIENTS) });
    }
    google.people.add({ resourceName: "people/c5", names: [{ displayName: "Marcos Vieira Lopes / Paciente" }], phoneNumbers: [{ value: "(41) 97777-0112" }], memberships: member(CLIENTS) });
    google.people.add({ resourceName: "people/c6", names: [{ displayName: "Marcos Vieira Lopes | Prospect" }], phoneNumbers: [{ value: "(41) 96666-0113" }], memberships: member(CLIENTS) });
    await turnOn();
    await choose(CLIENTS);
    const marcos = (await list("?q=97777")).concat(await list("?q=96666"));
    expect(marcos.map((contact) => contact.name)).toEqual(["Marcos Vieira Lopes", "Marcos Vieira Lopes"]);
    for (const contact of marcos) expect((await detail(contact.id)).sameName).toBe(1);
  });

  describe("GET /api/contacts/:id/appointments", () => {
    const at = (days: number, hour: number) => new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() + days, hour)).toISOString();
    const visit = (id: string, summary: string, days: number, description: string) => ({ id, etag: `"${id}"`, summary, description, start: { dateTime: at(days, 13) }, end: { dateTime: at(days, 14) } });
    const appointments = (id: string) => api("GET", `/contacts/${id}/appointments`);

    it("needs a session, a contact of the copy and its id's shape", async () => {
      await turnOn();
      await choose(CLIENTS);
      const [ana] = await list();
      expect((await api("GET", `/contacts/${ana?.id}/appointments`, undefined, false)).status).toBe(401);
      for (const id of ["0f8fad5b-d9cb-469f-a165-70867728950e", "x", "..%2F..%2Fgoogle"]) {
        const res = await appointments(id);
        expect(res.status, id).toBe(404);
        expect((await errorBody(res)).code).toBe("NOT_FOUND");
      }
    });

    it("says the calendar is not there while every calendar is closed, without a call to Google", async () => {
      await turnOn();
      await choose(CLIENTS);
      const [ana] = await list();
      const calls = google.seen.length;
      const res = await appointments(ana?.id ?? "");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ available: false, last: null, next: null, more: false });
      expect(google.seen.length).toBe(calls);
    });

    it("reads the last appointment and the nearest one ahead from the open calendar, by the name without the note, and sends no text of the event", async () => {
      google.people.add({ resourceName: "people/c3", names: [{ displayName: "Beatriz Novaes Conceição / Paciente" }], memberships: member(CLIENTS) });
      google.events.set(PRIMARY, [
        visit("a1", "Beatriz Novaes Conceição", -40, "Consulta | Consultório"),
        visit("a2", "Beatriz Novaes Conceição / Paciente", -10, "Retorno | Consultório\nsegredo-do-evento"),
        visit("a3", "Beatriz Novaes Conceição", 5, "Consulta | Online"),
        visit("a4", "Beatriz Novaes Conceição", 12, "Retorno | Consultório"),
        { ...visit("a5", "Beatriz Novaes Conceição", -1, "Retorno | Consultório"), status: "cancelled" },
        visit("a6", "Ana Souza", -2, "Consulta | Consultório"),
      ]);
      await turnOn();
      await choose(CLIENTS);
      expect((await api("PATCH", `/google/calendars/${encodeURIComponent(PRIMARY)}`, { mode: "read" })).status).toBe(200);
      const [beatriz] = await list("?q=beatriz");
      const res = await appointments(beatriz?.id ?? "");
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toContain("no-store");
      const text = await res.text();
      expect(JSON.parse(text)).toEqual({
        available: true,
        last: { start: at(-10, 13), allDay: false, kind: "return", type: "Retorno", place: "Consultório", certain: true },
        // The next one is the nearest ahead, whatever its kind: the owner reads "Próxima consulta" or "Retorno" from it.
        next: { start: at(5, 13), allDay: false, kind: "consultation", type: "Consulta", place: "Online", certain: true },
        more: false,
      });
      expect(text).not.toContain("segredo-do-evento");
      // The search at Google is by the clean name.
      const asked = google.seen.filter((seen) => seen.url.includes("/events")).at(-1);
      expect(new URL(asked?.url ?? "").searchParams.get("q")).toBe("Beatriz Novaes Conceição");
    });

    it("two people with one name: the guest's e-mail says whose the appointment is; with nothing to tell, it is shown as unsure to both", async () => {
      const person = (id: string, email: string, phone: string) => ({ resourceName: `people/${id}`, names: [{ displayName: "Marcos Vieira Lopes / Paciente" }], emailAddresses: [{ value: email }], phoneNumbers: [{ value: phone }], memberships: member(CLIENTS) });
      google.people.add(person("c5", "marcos.um@exemplo.com.br", "(41) 97777-0112"));
      google.people.add(person("c6", "marcos.dois@exemplo.com.br", "(41) 96666-0113"));
      google.events.set(PRIMARY, [
        visit("m1", "Marcos Vieira Lopes", -30, "Consulta | Consultório"),
        { ...visit("m2", "Marcos Vieira Lopes", -7, "Retorno | Consultório"), attendees: [{ email: "Marcos.Um@exemplo.com.br" }] },
      ]);
      await turnOn();
      await choose(CLIENTS);
      expect((await api("PATCH", `/google/calendars/${encodeURIComponent(PRIMARY)}`, { mode: "read" })).status).toBe(200);
      const [one] = await list("?q=97777");
      const [two] = await list("?q=96666");
      expect(await (await appointments(one?.id ?? "")).json()).toMatchObject({ last: { start: at(-7, 13), kind: "return", certain: true }, next: null });
      // The other Marcos never gets the first one's return; the visit nobody can tell apart is shown as unsure.
      expect(await (await appointments(two?.id ?? "")).json()).toMatchObject({ last: { start: at(-30, 13), kind: "consultation", certain: false }, next: null });
    });

    it("says Google didn't answer in the owner's words, and reads nothing during a lockdown", async () => {
      await turnOn();
      await choose(CLIENTS);
      expect((await api("PATCH", `/google/calendars/${encodeURIComponent(PRIMARY)}`, { mode: "read" })).status).toBe(200);
      const [ana] = await list();
      google.outage = 503;
      try {
        const res = await appointments(ana?.id ?? "");
        expect(res.status).toBe(503);
        expect((await errorBody(res)).code).toBe("SERVICE_UNAVAILABLE");
      } finally {
        google.outage = null;
      }
      await inOwner((agent) => new InternalState(agent.store.db).set("lockdown_until", new Date(Date.now() + 3_600_000).toISOString()));
      const calls = google.seen.length;
      const locked = await appointments(ana?.id ?? "");
      expect(locked.status).toBe(423);
      expect(google.seen.length).toBe(calls);
    });
  });
});

describe("contacts on the memory map (Sinal, S10)", () => {
  const remember = async (content: string) => {
    const res = await api("POST", "/memories", { content, category: "person" });
    expect(res.status).toBe(201);
    return ((await res.json()) as { memory: { id: string } }).memory.id;
  };
  const around = async (id: string) => (await (await api("GET", `/memories/graph?around=${id}`)).json()) as MemoryGraph;
  const forget = (ids: string[]) => inOwner((agent) => {
      for (const id of ids) agent.store.db.run(`DELETE FROM zur_memories WHERE id = ?`, id);
    });

  it("SEC-S10-02: with the permission gone and the copy still in the database, the map names no contact", async () => {
    await turnOn();
    expect((await api("PATCH", "/google/contacts/labels", { selected: [CLIENTS] })).status).toBe(200);
    await minuteLater();
    expect((await api("POST", "/google/contacts/sync")).status).toBe(200);
    const ana = await remember("A Ana Souza gosta de ser avisada na véspera.");
    const scopes = await inOwner((agent) => agent.store.db.one<{ scopes: string }>(`SELECT scopes FROM zur_google_account WHERE id = 1`)?.scopes ?? "");
    try {
      expect((await around(ana)).hubs.some((item) => item.kind === "contact")).toBe(true);
      await inOwner((agent) => {
        agent.store.db.run(`UPDATE zur_google_account SET scopes = '' WHERE id = 1`);
      });
      expect(await inOwner((agent) => agent.store.db.one<{ n: number }>(`SELECT count(*) AS n FROM zur_contacts`)?.n)).toBeGreaterThan(0);
      expect((await around(ana)).hubs.filter((item) => item.kind === "contact")).toEqual([]);
    } finally {
      await inOwner((agent) => {
        agent.store.db.run(`UPDATE zur_google_account SET scopes = ? WHERE id = 1`, scopes);
      });
      await forget([ana]);
    }
  });

  it("a memory that names a copied contact is linked to it; one that names nobody is not", async () => {
    await turnOn();
    expect((await api("PATCH", "/google/contacts/labels", { selected: [CLIENTS, FAMILY] })).status).toBe(200);
    await minuteLater();
    expect((await api("POST", "/google/contacts/sync")).status).toBe(200);
    const ana = await remember("A Ana Souza prefere contato por mensagem.");
    const nobody = await remember("Prefere reunião de manhã na Padaria.");
    try {
      const graph = await around(ana);
      const hub = graph.hubs.find((item) => item.kind === "contact");
      expect(hub).toMatchObject({ kind: "contact", label: "Ana Souza" });
      expect(hub?.id).toBe(`contact:${hub?.ref}`);
      expect(graph.links).toContainEqual({ from: ana, to: hub?.id, kind: "hub" });
      // The link opens the contact itself.
      const one = (await (await api("GET", `/contacts/${hub?.ref}`)).json()) as { contact: ContactDetail };
      expect(one.contact.name).toBe("Ana Souza");
      expect((await around(nobody)).hubs.filter((item) => item.kind === "contact")).toEqual([]);
      // The whole map never looks the contacts up.
      const whole = (await (await api("GET", "/memories/graph")).json()) as MemoryGraph;
      expect(whole.hubs.filter((item) => item.kind === "contact")).toEqual([]);
    } finally {
      await forget([ana, nobody]);
    }
  });

  it("with the contacts off, nothing of the old copy is linked", async () => {
    await turnOn();
    expect((await api("PATCH", "/google/contacts/labels", { selected: [CLIENTS] })).status).toBe(200);
    await minuteLater();
    expect((await api("POST", "/google/contacts/sync")).status).toBe(200);
    const ana = await remember("A Ana Souza prefere contato por mensagem.");
    try {
      expect((await around(ana)).hubs.some((item) => item.kind === "contact")).toBe(true);
      expect((await api("DELETE", "/google/contacts")).status).toBe(200);
      expect((await around(ana)).hubs.filter((item) => item.kind === "contact")).toEqual([]);
    } finally {
      await forget([ana]);
    }
  });
});

