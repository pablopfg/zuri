import { AGENT_INSTANCE_NAME } from "@zuri/shared";
import { runInDurableObject } from "cloudflare:test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ZuriAgent } from "../src/agent/zuri-agent.ts";
import { MockAIProvider } from "../src/ai/mock.ts";
import { InternalState } from "../src/db/internal-state.ts";
import { type DevGoogle, devGoogle, googleNetwork } from "../src/google/dev-google.ts";
import { call, CSRF, HUMAN_TOKEN, ORIGIN, TEST_EMAIL, TEST_PASSWORD, testEnv } from "./helpers.ts";
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
  cookie = res.headers.getSetCookie().find((c) => c.startsWith("__Host-zuri_session="))?.split(";")[0] ?? "";
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
});
