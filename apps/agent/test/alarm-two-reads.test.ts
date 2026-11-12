import { AGENT_INSTANCE_NAME } from "@zuri/shared";
import { runInDurableObject } from "cloudflare:test";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ZuriAgent } from "../src/agent/zuri-agent.ts";
import { MockAIProvider } from "../src/ai/mock.ts";
import { InternalState } from "../src/db/internal-state.ts";
import { type DevGoogle, devGoogle, googleNetwork } from "../src/google/dev-google.ts";
import { call, CSRF, HUMAN_TOKEN, ORIGIN, TEST_EMAIL, TEST_PASSWORD, testEnv, signedCookies } from "./helpers.ts";
import { LOCATION, PATTERN } from "./reviews-world.ts";

// PR S09: the contacts' sync and the reviews' check both due in one wake of the alarm, with the real
// services (alarm-sync-gap.test.ts proves the order with mocks): only the contacts go to Google, and the
// reviews wait two and a half minutes.

const IP = "192.0.2.196";
const CLIENTS = "contactGroups/clientes";
let cookie = "";
let google: DevGoogle;
const owner = () => testEnv.AGENT.get(testEnv.AGENT.idFromName(AGENT_INSTANCE_NAME));
const inOwner = <T>(fn: (agent: ZuriAgent) => T | Promise<T>) => runInDurableObject(owner(), (agent: ZuriAgent) => fn(agent));
const headers = (withCookie = true) => ({ ...CSRF, "content-type": "application/json", "cf-connecting-ip": IP, ...(withCookie ? { cookie } : {}) });
const api = (method: string, path: string, body?: unknown) => call(`${ORIGIN}/api${path}`, { method, headers: headers(), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

async function consent(path: string): Promise<void> {
  const begin = await api("POST", path);
  expect(begin.status).toBe(200);
  const params = new URL(((await begin.json()) as { url: string }).url).searchParams;
  expect((await api("POST", "/google/callback", { state: params.get("state") ?? "", code: `dev.${params.get("code_challenge") ?? ""}` })).status).toBe(200);
}

beforeAll(async () => {
  const res = await call(`${ORIGIN}/api/auth/login`, {
    method: "POST",
    headers: headers(false),
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD, turnstileToken: HUMAN_TOKEN }),
  });
  expect(res.status).toBe(200);
  cookie = signedCookies(res);
  google = devGoogle({ clientId: testEnv.GOOGLE_CLIENT_ID, clientSecret: testEnv.GOOGLE_CLIENT_SECRET });
  google.people.groups.push({ resourceName: CLIENTS, name: "Clientes", groupType: "USER_CONTACT_GROUP", memberCount: 1 });
  google.people.add({ resourceName: "people/c1", names: [{ displayName: "Ana Souza" }], memberships: [{ contactGroupMembership: { contactGroupResourceName: CLIENTS } }] });
  google.business.accounts.push({ name: "accounts/101", accountName: "Exemplo" });
  google.business.locations.set("accounts/101", [{ name: "locations/201", title: "Exemplo Centro" }]);
  await inOwner((agent) => {
    agent.store.google.network = googleNetwork(google, { fetch: () => Promise.reject(new Error("no network in tests")) });
    agent.testProvider = new MockAIProvider();
    agent.store.db.run(`UPDATE zur_sessions SET confirmed_at = ?`, Date.now());
  });
});

afterAll(async () => {
  await inOwner((agent) => {
    const { db } = agent.store;
    new InternalState(db).delete("google_oauth_pending");
    agent.store.contacts.disable();
    agent.store.reviews.disable();
    agent.testProvider = null;
    for (const table of ["zur_google_calendars", "zur_google_account", "zur_auth_events", "zur_notices"]) db.run(`DELETE FROM ${table}`);
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Both reads due now, then wake after wake at the time the alarm was really set for: what each wake read. */
async function wakes(contactsMinutes: number, reviewsMinutes: number, count: number): Promise<{ syncs: number; checks: number; together: number; seconds: number; syncRows: number }> {
  expect((await api("PATCH", "/reviews/interval", { syncEveryMinutes: 10 })).status).toBe(200);
  expect((await api("PATCH", "/google/contacts/settings", { syncEveryMinutes: contactsMinutes })).status).toBe(200);
  expect((await api("PATCH", "/reviews/interval", { syncEveryMinutes: reviewsMinutes })).status).toBe(200);
  const start = Date.now();
  vi.useFakeTimers({ toFake: ["Date"], now: start });
  return inOwner(async (agent) => {
    const { db } = agent.store;
    const state = new InternalState(db);
    // The services took their clock when they were made: they follow the moved one.
    (agent.store.contacts as unknown as { clock: () => number }).clock = () => Date.now();
    (agent.store.reviews as unknown as { clock: () => number }).clock = () => Date.now();
    db.run(`UPDATE zur_contact_sync SET next_sync = ?, next_reminder = NULL WHERE id = 1`, start);
    db.run(`UPDATE zur_review_settings SET next_check = ? WHERE id = 1`, start);
    const sync = vi.spyOn(agent.store.contacts, "sync");
    const check = vi.spyOn(agent.store.reviews, "check");
    let now = start;
    let together = 0;
    let syncRows = 0;
    for (let i = 0; i < count; i++) {
      vi.setSystemTime(now);
      const before = [sync.mock.calls.length, check.mock.calls.length];
      const written = db.usage.rowsWritten;
      await agent.runAutomations(null);
      // The first wake is left out: it also settles what the test's set-up left due.
      if (i > 0 && check.mock.calls.length === before[1]) syncRows = Math.max(syncRows, db.usage.rowsWritten - written);
      if (sync.mock.calls.length > (before[0] ?? 0) && check.mock.calls.length > (before[1] ?? 0)) together += 1;
      const at = Date.parse(String(state.get<string>("automation_alarm") ?? "").split("|")[0] ?? "");
      expect(Number.isFinite(at)).toBe(true);
      // The alarm never comes back sooner than a minute: a day has 1,440 wakes at the most.
      expect(at - now).toBeGreaterThanOrEqual(59_000);
      now = at;
    }
    return { syncs: sync.mock.calls.length, checks: check.mock.calls.length, together, seconds: (now - start) / 1_000, syncRows };
  });
}

describe("the alarm with the contacts and the reviews due together", () => {
  it("reads the contacts at Google, leaves the reviews for two and a half minutes later, and stays far from the wake's 45 calls", async () => {
    await consent("/google/connect");
    await consent("/google/contacts/connect");
    expect((await api("POST", "/google/contacts/sync")).status).toBe(200);
    expect((await api("PATCH", "/google/contacts/labels", { selected: [CLIENTS] })).status).toBe(200);
    expect((await api("POST", "/google/contacts/sync")).status).toBe(200);
    await consent("/reviews/connect");
    expect((await api("GET", "/reviews/locations")).status).toBe(200);
    expect((await api("PATCH", "/reviews/settings", { locations: [LOCATION], ...PATTERN, level: "approve" })).status).toBe(200);

    const reviewsAt = await inOwner(async (agent) => {
      const { db } = agent.store;
      const past = Date.now() - 1_000;
      db.run(`UPDATE zur_contact_sync SET next_sync = ?`, past);
      db.run(`UPDATE zur_review_settings SET next_check = ?`, past);
      expect(agent.store.contacts.nextDue()).toBe(past);
      expect(agent.store.reviews.nextDue()).toBe(past);
      google.seen.length = 0;
      const before = Date.now();
      await agent.runAutomations(null);
      const after = Date.now();
      const next = agent.store.reviews.nextDue() ?? 0;
      expect(next).toBeGreaterThanOrEqual(before + 150_000);
      expect(next).toBeLessThanOrEqual(after + 150_000);
      // The contacts' own next read is five minutes on: the alarm's next wake is the reviews'.
      expect(agent.store.contacts.nextDue() ?? 0).toBeGreaterThan(next);
      return next;
    });
    const urls = google.seen.map((seen) => seen.url);
    expect(urls.filter((url) => url.includes("/people/me/connections"))).toHaveLength(1);
    expect(urls.filter((url) => url.includes("mybusiness"))).toEqual([]);
    expect(urls.length).toBeLessThanOrEqual(14);

    // Two and a half minutes on, the reviews' turn: Google's reviews are read, the contacts aren't.
    await inOwner(async (agent) => {
      agent.store.db.run(`UPDATE zur_review_settings SET next_check = ? WHERE next_check = ?`, Date.now() - 1, reviewsAt);
      google.seen.length = 0;
      await agent.runAutomations(null);
    });
    const later = google.seen.map((seen) => seen.url);
    expect(later.some((url) => url.includes("mybusiness"))).toBe(true);
    expect(later.filter((url) => new URL(url).hostname === "people.googleapis.com")).toEqual([]);
    expect(later.length).toBeLessThanOrEqual(14);
  });

  it("SEC-A8-01: with the contacts read every minute the reviews' check still runs at its interval, never in a sync's wake", async () => {
    const seen = await wakes(1, 10, 31);
    // Half an hour: the check at 0, 10, 20 and 30 minutes, each in a wake of its own, and the sync in every other wake.
    expect(seen.seconds).toBeGreaterThanOrEqual(30 * 60);
    expect(seen.seconds).toBeLessThan(32 * 60);
    expect(seen.checks).toBeGreaterThanOrEqual(3);
    expect(seen.checks).toBeLessThanOrEqual(4);
    expect(seen.syncs).toBe(31 - seen.checks);
    expect(seen.together).toBe(0);
    // DAY_BUDGET weighs a read at 3 because a wake with nothing but a read that found no change writes at most 19 rows.
    expect(seen.syncRows).toBeGreaterThan(0);
    expect(seen.syncRows).toBeLessThanOrEqual(19);
  });

  it("with the contacts every two minutes and the reviews every four, the check waits a minute and both keep their pace", async () => {
    const seen = await wakes(2, 4, 16);
    expect(seen.checks).toBeGreaterThanOrEqual(4);
    expect(seen.syncs).toBeGreaterThanOrEqual(8);
    expect(seen.together).toBe(0);
  });

  it("SEC-A13-01: asking for the alarm again never pushes a wake already waiting further out", async () => {
    expect((await api("PATCH", "/reviews/interval", { syncEveryMinutes: 10 })).status).toBe(200);
    expect((await api("PATCH", "/google/contacts/settings", { syncEveryMinutes: 1 })).status).toBe(200);
    const start = Date.now();
    vi.useFakeTimers({ toFake: ["Date"], now: start });
    await inOwner(async (agent) => {
      const { db } = agent.store;
      const state = new InternalState(db);
      (agent.store.contacts as unknown as { clock: () => number }).clock = () => Date.now();
      db.run(`UPDATE zur_contact_sync SET next_sync = ?, next_reminder = NULL WHERE id = 1`, start);
      await agent.runAutomations(null);
      const set = String(state.get<string>("automation_alarm"));
      const at = Date.parse(set.split("|")[0] ?? "");
      expect(at - start).toBeGreaterThanOrEqual(59_000);
      expect(at - start).toBeLessThanOrEqual(61_000);
      // Someone saves a setting every 20 s while the wake waits, and then past its time (the alarm was held up):
      // the alarm stays where it was until its time has come, and only then moves a minute out.
      for (const seconds of [20, 40, 58]) {
        vi.setSystemTime(start + seconds * 1_000);
        await agent.store.automations.rearm();
        expect(state.get<string>("automation_alarm")).toBe(set);
      }
      vi.setSystemTime(at + 5_000);
      await agent.store.automations.rearm();
      const late = Date.parse(String(state.get<string>("automation_alarm")).split("|")[0] ?? "");
      expect(late).toBe(at + 5_000 + 60_000);
      vi.setSystemTime(at + 30_000);
      await agent.store.automations.rearm();
      expect(Date.parse(String(state.get<string>("automation_alarm")).split("|")[0] ?? "")).toBe(late);
    });
  });
});
