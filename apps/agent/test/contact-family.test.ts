import { AGENT_INSTANCE_NAME, type ContactFamily, type ContactPage, FAMILY_LIMITS } from "@zuri/shared";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ZuriAgent } from "../src/agent/zuri-agent.ts";
import { InternalState } from "../src/db/internal-state.ts";
import { type DevGoogle, devGoogle, googleNetwork } from "../src/google/dev-google.ts";
import { call, CSRF, errorBody, HUMAN_TOKEN, ORIGIN, TEST_EMAIL, TEST_PASSWORD, testEnv, signedCookies } from "./helpers.ts";

// E11b (plano contatos-familia-e-ficha.md): the card's "Família", links that only Zuri keeps.

const IP = "192.0.2.193";
let cookie = "";
let google: DevGoogle;
const owner = () => testEnv.AGENT.get(testEnv.AGENT.idFromName(AGENT_INSTANCE_NAME));
const inOwner = <T>(fn: (agent: ZuriAgent) => T | Promise<T>) => runInDurableObject(owner(), (agent: ZuriAgent) => fn(agent));
const headers = (withCookie = true) => ({ ...CSRF, "content-type": "application/json", "cf-connecting-ip": IP, ...(withCookie ? { cookie } : {}) });
const api = (method: string, path: string, body?: unknown, withCookie = true) =>
  call(`${ORIGIN}/api${path}`, { method, headers: headers(withCookie), ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }) });

const LABEL = "contactGroups/pacientes";
/** The copy's id of each contact, by its resourceName. */
let ids: Record<string, string> = {};

async function consent(path: string): Promise<void> {
  const begin = await api("POST", path);
  const { url } = (await begin.json()) as { url: string };
  const params = new URL(url).searchParams;
  expect((await api("POST", "/google/callback", { state: params.get("state") ?? "", code: `dev.${params.get("code_challenge") ?? ""}` })).status).toBe(200);
}

const family = async (resource: string): Promise<ContactFamily> => {
  const res = await api("GET", `/contacts/${ids[resource]}/family`);
  expect(res.status).toBe(200);
  return (await res.json()) as ContactFamily;
};
const link = (resource: string, relative: string, role: string, otherRole: string) => api("POST", `/contacts/${ids[resource]}/family`, { relative: ids[relative], role, otherRole });
const rows = () => inOwner((agent) => agent.store.db.all<{ a: string; b: string; role_a: string; role_b: string; responsible: number }>(`SELECT a, b, role_a, role_b, responsible FROM zur_contact_family ORDER BY a, b`));

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
  google.people.groups.push({ resourceName: LABEL, name: "Pacientes", groupType: "USER_CONTACT_GROUP", memberCount: 6 });
  const member = [{ contactGroupMembership: { contactGroupResourceName: LABEL } }];
  const person = (id: string, name: string, extra: Record<string, unknown> = {}) =>
    google.people.add({ resourceName: `people/${id}`, names: [{ displayName: name }], phoneNumbers: [{ value: `(11) 98888-${id.slice(1).padStart(4, "0")}` }], memberships: member, ...extra });
  person("c10", "Helena Prado");
  person("c11", "Lucas Prado");
  person("c12", "Diego Prado");
  person("c13", "Marta Lima", { birthdays: [{ date: { year: 1980, month: 3, day: 9 } }] });
  person("c14", "Marta Lima", { birthdays: [{ date: { year: 1991, month: 7, day: 2 } }] });
  person("c15", "Rui Costa");
  await inOwner((agent) => {
    agent.store.google.network = googleNetwork(google, { fetch: () => Promise.reject(new Error("no network in tests")) });
    agent.store.db.run(`UPDATE zur_sessions SET confirmed_at = ?`, Date.now());
  });
  await consent("/google/connect");
  await consent("/google/contacts/connect");
  expect((await api("PATCH", "/google/contacts/labels", { selected: [LABEL] })).status).toBe(200);
  expect((await api("POST", "/google/contacts/sync")).status).toBe(200);
  const page = (await (await api("GET", "/contacts")).json()) as ContactPage;
  expect(page.contacts).toHaveLength(6);
  ids = Object.fromEntries(
    await inOwner((agent) => agent.store.db.all<{ id: string; resource_name: string }>(`SELECT id, resource_name FROM zur_contacts`).map((row) => [row.resource_name, row.id])),
  );
});

afterEach(async () => {
  await inOwner((agent) => {
    const { db } = agent.store;
    agent.store.contacts.disable();
    for (const table of ["zur_contact_family", "zur_google_calendars", "zur_google_account", "zur_auth_events", "zur_notices"]) db.run(`DELETE FROM ${table}`);
    new InternalState(db).delete("google_oauth_pending");
  });
});

describe("/api/contacts/:id/family", () => {
  it("needs a session and the CSRF header", async () => {
    expect((await api("GET", `/contacts/${ids["people/c10"]}/family`, undefined, false)).status).toBe(401);
    expect((await call(`${ORIGIN}/api/contacts/${ids["people/c10"]}/family`, { method: "POST", headers: { cookie, "cf-connecting-ip": IP, "content-type": "application/json" }, body: "{}" })).status).toBe(403);
  });

  it("starts empty, links both sides with their roles and shows the family through someone else", async () => {
    expect(await family("people/c11")).toEqual({ links: [], group: [], groupMore: 0 });
    // From Lucas's card: Helena is his mother, he is her son.
    const made = await link("people/c11", "people/c10", "mother", "son");
    expect(made.status).toBe(201);
    const lucas = (await made.json()) as ContactFamily;
    expect(lucas.links).toEqual([{ id: expect.any(String), role: "mother", contact: { id: ids["people/c10"], name: "Helena Prado", birthday: "", sameName: false } }]);
    // One row, a < b, each role on its side; nothing at Google.
    expect(await rows()).toEqual([{ a: "people/c10", b: "people/c11", role_a: "mother", role_b: "son", responsible: 0 }]);
    expect((await family("people/c10")).links.map((item) => [item.contact?.name, item.role])).toEqual([["Lucas Prado", "son"]]);
    // From Helena's card: Diego is her brother. Lucas now sees Diego in the group, not as his own link.
    expect((await link("people/c10", "people/c12", "brother", "sister")).status).toBe(201);
    expect(await rows()).toContainEqual({ a: "people/c10", b: "people/c12", role_a: "sister", role_b: "brother", responsible: 0 });
    expect(await family("people/c11")).toMatchObject({ links: [{ role: "mother" }], group: ["Diego Prado"], groupMore: 0 });
    // Google is only ever read: no call changes a contact there.
    expect(google.seen.filter((seen) => new URL(seen.url).hostname === "people.googleapis.com" && seen.method !== "GET")).toEqual([]);
  });

  it("refuses what is no link: oneself, roles that don't pair, a pair already linked, a contact not in the copy, a hostile body", async () => {
    expect((await link("people/c11", "people/c10", "mother", "son")).status).toBe(201);
    const self = await link("people/c11", "people/c11", "brother", "brother");
    expect(self.status).toBe(400);
    expect(await errorBody(self)).toMatchObject({ code: "VALIDATION_FAILED" });
    for (const [role, otherRole] of [["mother", "mother"], ["spouse", "son"], ["guardian", "son"], ["dependent", "dependent"], ["chefe", "son"], ["", "son"]]) {
      const res = await link("people/c12", "people/c10", role as string, otherRole as string);
      expect(res.status, `${role}/${otherRole}`).toBe(400);
    }
    // The same pair, from either card and whatever the roles.
    for (const [from, to] of [["people/c11", "people/c10"], ["people/c10", "people/c11"]] as const) {
      const again = await link(from, to, "spouse", "spouse");
      expect(again.status).toBe(409);
      expect(await errorBody(again)).toMatchObject({ code: "CONFLICT" });
    }
    expect((await api("POST", `/contacts/${ids["people/c11"]}/family`, { relative: "00000000-0000-4000-8000-000000000000", role: "mother", otherRole: "son" })).status).toBe(404);
    expect((await api("POST", `/contacts/00000000-0000-4000-8000-000000000000/family`, { relative: ids["people/c10"], role: "mother", otherRole: "son" })).status).toBe(404);
    expect((await api("GET", "/contacts/people%2Fc10/family")).status).toBe(404);
    for (const body of [{ relative: ids["people/c12"], role: "brother", otherRole: "brother", responsible: true }, { relative: "people/c12", role: "brother", otherRole: "brother" }, "[]", "{", `{"relative":"${"a".repeat(1100)}"}`]) {
      const res = await api("POST", `/contacts/${ids["people/c11"]}/family`, body);
      expect(res.status, JSON.stringify(body).slice(0, 60)).toBe(400);
    }
    expect(await rows()).toHaveLength(1);
  });

  it("takes a link off from either card, only a link of that contact, and both contacts stay", async () => {
    const lucas = (await (await link("people/c11", "people/c10", "mother", "son")).json()) as ContactFamily;
    await link("people/c12", "people/c15", "brother", "brother");
    const linkId = lucas.links[0]?.id ?? "";
    const other = (await family("people/c12")).links[0]?.id ?? "";
    // Diego's link, through Lucas's card: not his.
    expect((await api("DELETE", `/contacts/${ids["people/c11"]}/family/${other}`)).status).toBe(404);
    expect((await api("DELETE", `/contacts/${ids["people/c11"]}/family/nao-existe`)).status).toBe(404);
    const gone = await api("DELETE", `/contacts/${ids["people/c10"]}/family/${linkId}`);
    expect(gone.status).toBe(200);
    expect(((await gone.json()) as ContactFamily).links).toEqual([]);
    expect((await family("people/c11")).links).toEqual([]);
    expect((await api("DELETE", `/contacts/${ids["people/c11"]}/family/${linkId}`)).status).toBe(404);
    expect(await rows()).toHaveLength(1);
    expect(((await (await api("GET", "/contacts")).json()) as ContactPage).contacts).toHaveLength(6);
  });

  it("homonyms are told apart by the birthday; a relative who left the labels keeps the link, unnamed", async () => {
    await link("people/c15", "people/c14", "spouse", "spouse");
    expect((await family("people/c15")).links[0]?.contact).toEqual({ id: ids["people/c14"], name: "Marta Lima", birthday: "1991-07-02", sameName: true });
    expect((await family("people/c15")).links[0]?.contact?.id).not.toBe(ids["people/c13"]);
    await inOwner((agent) => agent.store.db.run(`DELETE FROM zur_contacts WHERE resource_name = 'people/c14'`));
    expect((await family("people/c15")).links).toEqual([{ id: expect.any(String), role: "spouse", contact: null }]);
    expect(await rows()).toHaveLength(1);
  });

  it(`at most ${FAMILY_LIMITS.perContact} relatives a contact (n-1, n, n+1), on both sides`, async () => {
    const fill = (resource: string, count: number) =>
      inOwner((agent) => {
        for (let i = 0; i < count; i++) agent.store.db.run(`INSERT INTO zur_contact_family (id, a, b, role_a, role_b, created_at) VALUES (?, ?, ?, 'cousinF', 'cousinM', 1)`, crypto.randomUUID(), resource, `people/z${String(i).padStart(3, "0")}`, );
      });
    await fill("people/c10", FAMILY_LIMITS.perContact - 2);
    expect((await link("people/c10", "people/c11", "son", "mother")).status).toBe(201);
    expect((await family("people/c10")).links).toHaveLength(FAMILY_LIMITS.perContact - 1);
    expect((await link("people/c10", "people/c12", "brother", "sister")).status).toBe(201);
    const full = await link("people/c10", "people/c15", "brother", "sister");
    expect(full.status).toBe(409);
    expect(await errorBody(full)).toMatchObject({ code: "CONFLICT" });
    // The relative's side counts too: Helena is full, so she can't be linked from Rui's card.
    expect((await link("people/c15", "people/c10", "sister", "brother")).status).toBe(409);
    expect((await family("people/c10")).links.filter((item) => item.contact)).toHaveLength(2);
  });

  it(`at most ${FAMILY_LIMITS.total} links in all (n-1, n, n+1), read from the count the table keeps`, async () => {
    await inOwner((agent) => {
      const { db } = agent.store;
      db.transaction(() => {
        for (let i = 0; i < FAMILY_LIMITS.total - 2; i++) db.run(`INSERT INTO zur_contact_family (id, a, b, role_a, role_b, created_at) VALUES (?, ?, ?, 'spouse', 'spouse', 1)`, crypto.randomUUID(), `people/x${i}`, `people/y${i}`);
      });
    });
    expect((await link("people/c11", "people/c10", "mother", "son")).status).toBe(201);
    expect((await link("people/c12", "people/c15", "brother", "brother")).status).toBe(201);
    const full = await link("people/c13", "people/c14", "sister", "sister");
    expect(full.status).toBe(409);
    expect(await errorBody(full)).toMatchObject({ code: "CONFLICT" });
    // Taking one off makes room again.
    const one = (await family("people/c12")).links[0]?.id ?? "";
    expect((await api("DELETE", `/contacts/${ids["people/c12"]}/family/${one}`)).status).toBe(200);
    expect((await link("people/c13", "people/c14", "sister", "sister")).status).toBe(201);
    expect(await inOwner((agent) => agent.store.db.one(`SELECT n FROM zur_counts WHERE kind = 'contact_family'`))).toEqual({ n: FAMILY_LIMITS.total });
  });

  it("a relative who leaves the label at Google shows unnamed, and comes back linked with the copy's new id", async () => {
    await link("people/c15", "people/c12", "brother", "brother");
    const sync = async () => {
      await inOwner((agent) => agent.store.db.run(`UPDATE zur_contact_sync SET synced_now_at = synced_now_at - 60000`));
      expect((await api("POST", "/google/contacts/sync")).status).toBe(200);
    };
    google.people.update("people/c12", { memberships: [] });
    await sync();
    expect((await family("people/c15")).links).toEqual([{ id: expect.any(String), role: "brother", contact: null }]);
    google.people.update("people/c12", { memberships: [{ contactGroupMembership: { contactGroupResourceName: LABEL } }] });
    await sync();
    const back = (await family("people/c15")).links[0]?.contact;
    expect(back).toMatchObject({ name: "Diego Prado" });
    expect(back?.id).not.toBe(ids["people/c12"]);
  });

  it(`names at most ${FAMILY_LIMITS.group} others of the group and counts the rest`, async () => {
    await inOwner((agent) => {
      const { db } = agent.store;
      for (let i = 0; i < FAMILY_LIMITS.group + 5; i++) {
        const resource = `people/g${String(i).padStart(3, "0")}`;
        db.run(`INSERT INTO zur_contacts (id, resource_name, etag, display_name, search_name, data, synced_at) VALUES (?, ?, '-', ?, ?, '{}', 1)`, crypto.randomUUID(), resource, `Parente ${i}`, `parente ${i}`);
        // Each one through the previous: a chain far from Lucas.
        const prev = i === 0 ? "people/c12" : `people/g${String(i - 1).padStart(3, "0")}`;
        db.run(`INSERT INTO zur_contact_family (id, a, b, role_a, role_b, created_at) VALUES (?, ?, ?, 'cousinF', 'cousinM', 1)`, crypto.randomUUID(), prev < resource ? prev : resource, prev < resource ? resource : prev);
      }
    });
    await link("people/c11", "people/c12", "uncle", "nephew");
    const lucas = await family("people/c11");
    expect(lucas.links).toHaveLength(1);
    expect(lucas.group).toHaveLength(FAMILY_LIMITS.group);
    expect(lucas.groupMore).toBe(5);
    expect(lucas.group).not.toContain("Diego Prado");
    expect(lucas.group).not.toContain("Lucas Prado");
  });

  it("with Contacts off, no card has a family to show, and the links wait", async () => {
    await link("people/c11", "people/c10", "mother", "son");
    await inOwner((agent) => agent.store.contacts.disable());
    expect((await api("GET", `/contacts/${ids["people/c11"]}/family`)).status).toBe(404);
    expect(await rows()).toHaveLength(1);
  });
});
