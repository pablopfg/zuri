import { CONTACT_LIMITS } from "@zuri/shared";
import { describe, expect, it } from "vitest";
import { FIELDS_VERSION, PERSON_FIELDS, readPerson, siteUrl } from "../src/google/contacts.ts";
import { ALL_TOOLS } from "../src/tools/index.ts";
import { ToolExecutor } from "../src/tools/registry.ts";
import { type ChatWorld, withChatWorld } from "./chat-world.ts";

// PR S09 of the new frontend (plan sincronizacao-contatos-avaliacoes.md, PR 1): the contacts read every
// five minutes, a quiet read that moves nothing on the screens, the labels once an hour, "Sync now" once
// a minute, the fields Zuri started to keep (addresses, sites, relations, chat names) and the one full
// read that brings them to a copy made before.

const CLIENTS = "contactGroups/clientes";
const FAMILY = "contactGroups/familia";
const EVERY = CONTACT_LIMITS.syncEveryMs;
const HOUR = 3_600_000;

async function consent(world: ChatWorld, purpose: "calendar" | "contacts") {
  const url = new URL(await world.google.begin("sessao", purpose));
  return world.google.finish({ state: url.searchParams.get("state") ?? "", code: `dev.${url.searchParams.get("code_challenge") ?? ""}` }, "sessao");
}

async function turnOn(world: ChatWorld, labels: string[] = [CLIENTS]): Promise<void> {
  world.googleSim.people.groups.push(
    { resourceName: CLIENTS, name: "Clientes", groupType: "USER_CONTACT_GROUP", memberCount: 2 },
    { resourceName: FAMILY, name: "Família", groupType: "USER_CONTACT_GROUP", memberCount: 1 },
    { resourceName: "contactGroups/starred", name: "starred", groupType: "SYSTEM_CONTACT_GROUP" },
    { resourceName: "contactGroups/algumDoGoogle", name: "algumDoGoogle", groupType: "SYSTEM_CONTACT_GROUP" },
  );
  await consent(world, "calendar");
  await consent(world, "contacts");
  world.contacts.enable();
  expect(await world.contacts.sync("owner")).toBe("ok");
  if (labels.length) {
    world.contacts.select(labels);
    expect(await world.contacts.sync("owner")).toBe("ok");
  }
}

const member = (...labels: string[]) => labels.map((label) => ({ contactGroupMembership: { contactGroupResourceName: label } }));

function add(world: ChatWorld, id: string, name: string, labels: string[], extra: Record<string, unknown> = {}) {
  return world.googleSim.people.add({ resourceName: `people/${id}`, names: [{ displayName: name }], memberships: member(...labels, "contactGroups/myContacts"), ...extra });
}

const row = (world: ChatWorld) => world.db.one<Record<string, unknown>>(`SELECT * FROM zur_contact_sync WHERE id = 1`) ?? {};
const area = (world: ChatWorld) => world.db.one<{ contacts: number }>(`SELECT contacts FROM zur_area_versions WHERE id = 1`)?.contacts ?? -1;
const labelCalls = (world: ChatWorld) => world.googleSim.seen.filter((seen) => seen.url.startsWith("https://people.googleapis.com/v1/contactGroups")).length;
const peopleCalls = (world: ChatWorld) => world.googleSim.seen.filter((seen) => seen.url.startsWith("https://people.googleapis.com/v1/people/me/connections"));
const copy = (world: ChatWorld) => world.db.all<{ id: string; etag: string; data: string; synced_at: number }>(`SELECT id, etag, data, synced_at FROM zur_contacts ORDER BY id`);
const iso = (ms: number) => new Date(ms).toISOString();

describe("the contacts every five minutes", () => {
  it("plans the next read five minutes after each one and tells the screen when, and how the last one went", () =>
    withChatWorld(async (world) => {
      add(world, "c1", "Ana", [CLIENTS]);
      await turnOn(world);
      expect(EVERY).toBe(5 * 60_000);
      const first = world.clock.now;
      expect(world.contacts.status()).toMatchObject({ status: "ok", lastSyncAt: iso(first), nextSyncAt: iso(first + EVERY), lastResult: "changed", refreshing: false });
      expect(world.contacts.nextDue()).toBe(first + EVERY);
      // One millisecond before, nothing is due; at the time, the alarm reads.
      world.clock.now = first + EVERY - 1;
      expect(await world.contacts.tick()).toBe(false);
      world.clock.now = first + EVERY;
      expect(await world.contacts.tick()).toBe(true);
      expect(world.contacts.status()).toMatchObject({ status: "ok", lastSyncAt: iso(first + EVERY), nextSyncAt: iso(first + 2 * EVERY), lastResult: "unchanged" });
    }));

  it("a read that brings nothing writes no contact and leaves the screens' number where it was", () =>
    withChatWorld(async (world) => {
      add(world, "c1", "Ana", [CLIENTS]);
      add(world, "c2", "Bia", [CLIENTS]);
      await turnOn(world);
      const contacts = copy(world);
      const number = area(world);
      const labels = world.db.all(`SELECT * FROM zur_contact_labels ORDER BY resource_name`);
      for (let i = 0; i < 6; i++) {
        world.clock.now += EVERY;
        const before = { ...world.db.usage };
        expect(await world.contacts.sync("alarm")).toBe("ok");
        // The lock, the sync's own row and the lock's release: nothing else (rule P4).
        expect(world.db.usage.rowsWritten - before.rowsWritten).toBeLessThanOrEqual(3);
        expect(world.contacts.status().lastResult).toBe("unchanged");
      }
      expect(copy(world)).toEqual(contacts);
      expect(world.db.all(`SELECT * FROM zur_contact_labels ORDER BY resource_name`)).toEqual(labels);
      expect(area(world)).toBe(number);
      // The time of the last read still reaches the screen ("Nothing changed at 08:08").
      expect(world.contacts.status().lastSyncAt).toBe(iso(world.clock.now));
    }));

  it("a read that copies, changes or forgets someone moves the screens' number and says so", () =>
    withChatWorld(async (world) => {
      add(world, "c1", "Ana", [CLIENTS]);
      await turnOn(world);
      const steps: (() => void)[] = [
        () => add(world, "c2", "Bia", [CLIENTS]),
        () => world.googleSim.people.update("people/c2", { names: [{ displayName: "Bia Lima" }] }),
        () => world.googleSim.people.remove("people/c2"),
        // Left the chosen label: forgotten, a change too.
        () => world.googleSim.people.update("people/c1", { memberships: member(FAMILY) }),
      ];
      for (const step of steps) {
        const number = area(world);
        step();
        world.clock.now += EVERY;
        expect(await world.contacts.sync("alarm")).toBe("ok");
        expect(area(world)).toBeGreaterThan(number);
        expect(world.contacts.status()).toMatchObject({ lastResult: "changed", lastSyncAt: iso(world.clock.now) });
        // And the one after it is quiet again.
        const after = area(world);
        world.clock.now += EVERY;
        expect(await world.contacts.sync("alarm")).toBe("ok");
        expect(area(world)).toBe(after);
        expect(world.contacts.status().lastResult).toBe("unchanged");
      }
      expect(world.contacts.count()).toBe(0);
    }));

  it("a read cut in pages says it changed at the end, even when only an earlier wake copied someone", () =>
    withChatWorld(async (world) => {
      await turnOn(world, []);
      world.contacts.select([CLIENTS]);
      // 11 pages at Google; the only contact of the chosen label is on the first.
      for (let i = 0; i < 10_030; i++) world.googleSim.people.add({ resourceName: `people/p${i}`, names: [{ displayName: `P${i}` }], memberships: member(i === 0 ? CLIENTS : FAMILY) });
      const { GoogleMeter } = await import("../src/google/service.ts");
      expect(await world.contacts.sync("alarm", new GoogleMeter(40))).toBe("partial");
      expect(row(world)).toMatchObject({ dirty: 1, copied: 1 });
      expect(world.contacts.status().refreshing).toBe(true);
      const number = area(world);
      expect(await world.contacts.sync("alarm")).toBe("ok");
      expect(row(world)).toMatchObject({ dirty: 0, last_result: "changed" });
      expect(area(world)).toBeGreaterThan(number);
      expect(world.contacts.status().refreshing).toBe(false);
    }));

  it("leaves no time to wait while off, while the account needs the owner, or with nothing chosen", () =>
    withChatWorld(async (world) => {
      expect(world.contacts.status()).toMatchObject({ nextSyncAt: null, lastResult: null, refreshing: false });
      await turnOn(world, []);
      // Nothing chosen: the sync still runs (it has nothing to read but the labels, new to Zuri), and
      // nothing is "being read again".
      expect(world.contacts.status()).toMatchObject({ refreshing: false, lastResult: "changed" });
      world.clock.now += EVERY;
      expect(await world.contacts.sync("alarm")).toBe("ok");
      expect(world.contacts.status()).toMatchObject({ refreshing: false, lastResult: "unchanged" });
      world.googleSim.refreshTokens.clear();
      world.db.run(`UPDATE zur_google_account SET access_expires_at = 0`);
      // With nothing chosen Google is only asked for the labels, at the hour: that is when it shows.
      world.clock.now += HOUR;
      expect(await world.contacts.sync("alarm")).toBe("failed");
      expect(world.contacts.status()).toMatchObject({ problem: "reconnect", nextSyncAt: null });
      world.contacts.disable();
      expect(world.contacts.status()).toMatchObject({ enabled: false, nextSyncAt: null, lastResult: null, refreshing: false });
    }));
});

describe("what the alarm is told", () => {
  it("CF-S09-01: without the contacts' permission no sync is due, so the alarm isn't woken every minute; the notice of the day still is", () =>
    withChatWorld(async (world) => {
      add(world, "c1", "Ana", [CLIENTS]);
      await turnOn(world);
      world.contacts.configure({ birthdays: true, time: "08:00" });
      const reminder = row(world).next_reminder as number;
      // The owner connected again and left the contacts out.
      world.db.run(`UPDATE zur_google_account SET scopes = 'https://www.googleapis.com/auth/calendar.events'`);
      world.clock.now += EVERY;
      expect(row(world).next_sync as number).toBeLessThanOrEqual(world.clock.now);
      expect(world.contacts.nextDue()).toBe(reminder);
      const calls = world.googleSim.seen.length;
      expect(await world.contacts.tick()).toBe(false);
      expect(world.contacts.readGoogle).toBe(false);
      expect(world.googleSim.seen.length).toBe(calls);
    }));

  it("CF-S09-03: says whether the tick's sync went to Google: yes when it ran or failed there, no when busy or when only the notice went out", () =>
    withChatWorld(async (world) => {
      add(world, "c1", "Ana", [CLIENTS]);
      await turnOn(world);
      world.clock.now += EVERY;
      expect(await world.contacts.tick()).toBe(true);
      expect(world.contacts.readGoogle).toBe(true);
      // Another sync holds the lock.
      world.clock.now += EVERY;
      world.db.run(`UPDATE zur_contact_sync SET running_since = ?`, world.clock.now - 1_000);
      expect(await world.contacts.tick()).toBe(true);
      expect(world.contacts.readGoogle).toBe(false);
      world.db.run(`UPDATE zur_contact_sync SET running_since = NULL`);
      // Google fails: it was reached.
      world.googleSim.people.failure = { status: 503, body: { error: { code: 503 } } };
      expect(await world.contacts.tick()).toBe(true);
      expect(world.contacts.readGoogle).toBe(true);
      world.googleSim.people.failure = null;
      // A read cut in pages comes back every minute: it holds nothing, or the reviews would never be checked.
      world.db.run(`UPDATE zur_contact_sync SET next_sync = ?, failures = 0`, world.clock.now);
      const { GoogleMeter } = await import("../src/google/service.ts");
      const sync = world.contacts.sync.bind(world.contacts);
      world.contacts.sync = (trigger) => sync(trigger, new GoogleMeter(0));
      expect(await world.contacts.tick()).toBe(true);
      expect(world.contacts.readGoogle).toBe(false);
      world.contacts.sync = sync;
      // Only the notice of the day is due.
      world.db.run(`UPDATE zur_contact_sync SET next_sync = ?, next_reminder = ?`, world.clock.now + HOUR, world.clock.now);
      expect(await world.contacts.tick()).toBe(true);
      expect(world.contacts.readGoogle).toBe(false);
    }));
});

describe("the labels once an hour", () => {
  it("reads the list of labels once an hour, not on every sync", () =>
    withChatWorld(async (world) => {
      add(world, "c1", "Ana", [CLIENTS]);
      await turnOn(world);
      const start = labelCalls(world);
      const from = world.clock.now;
      // Eleven reads in the next 55 minutes: none asks for the labels.
      for (let i = 1; i <= 11; i++) {
        world.clock.now = from + i * EVERY;
        expect(await world.contacts.sync("alarm")).toBe("ok");
      }
      expect(labelCalls(world)).toBe(start);
      // One millisecond short of the hour, still not; at the hour, once.
      world.clock.now = from + HOUR - 1;
      expect(await world.contacts.sync("alarm")).toBe("ok");
      expect(labelCalls(world)).toBe(start);
      world.clock.now = from + HOUR;
      expect(await world.contacts.sync("alarm")).toBe("ok");
      expect(labelCalls(world)).toBe(start + 1);
      world.clock.now += EVERY;
      expect(await world.contacts.sync("alarm")).toBe("ok");
      expect(labelCalls(world)).toBe(start + 1);
    }));

  it("a label renamed at Google shows its new name within the hour, with the screens told", () =>
    withChatWorld(async (world) => {
      await turnOn(world);
      const group = world.googleSim.people.groups.find((item) => item.resourceName === CLIENTS);
      if (group) group.name = "Pacientes";
      world.clock.now += EVERY;
      expect(await world.contacts.sync("alarm")).toBe("ok");
      expect(world.contacts.labels().map((label) => label.name)).toEqual(["Clientes", "Família"]);
      const number = area(world);
      world.clock.now += HOUR;
      expect(await world.contacts.sync("alarm")).toBe("ok");
      expect(world.contacts.labels().map((label) => label.name)).toEqual(["Família", "Pacientes"]);
      expect(area(world)).toBeGreaterThan(number);
      // QA-S09-04: the screen is told something changed, not "nothing changed".
      expect(world.contacts.status()).toMatchObject({ lastResult: "changed", lastSyncAt: iso(world.clock.now) });
      world.clock.now += EVERY;
      expect(await world.contacts.sync("alarm")).toBe("ok");
      expect(world.contacts.status().lastResult).toBe("unchanged");
    }));

  it("QA-S09-04: a chosen label deleted at Google forgets its contacts and the read says it changed", () =>
    withChatWorld(async (world) => {
      add(world, "c1", "Ana", [CLIENTS]);
      await turnOn(world);
      expect(copy(world)).toHaveLength(1);
      world.clock.now += HOUR;
      expect(await world.contacts.sync("alarm")).toBe("ok");
      expect(world.contacts.status().lastResult).toBe("unchanged");
      const groups = world.googleSim.people.groups;
      groups.splice(groups.findIndex((item) => item.resourceName === CLIENTS), 1);
      const number = area(world);
      world.clock.now += HOUR;
      expect(await world.contacts.sync("alarm")).toBe("ok");
      expect(copy(world)).toHaveLength(0);
      expect(area(world)).toBeGreaterThan(number);
      expect(world.contacts.status()).toMatchObject({ lastResult: "changed", contacts: 0 });
    }));

  it("turned off and on again inside the hour, the first read brings the labels", () =>
    withChatWorld(async (world) => {
      await turnOn(world, []);
      world.clock.now += EVERY;
      world.contacts.disable();
      expect(world.contacts.labels()).toEqual([]);
      world.contacts.enable();
      expect(await world.contacts.sync("owner")).toBe("ok");
      expect(world.contacts.labels().map((label) => label.name)).toEqual(["Clientes", "Família"]);
    }));

  it("QA-S09-02: with no label chosen the labels still come once an hour, and a quiet read writes its three rows", () =>
    withChatWorld(async (world) => {
      await turnOn(world, []);
      const start = labelCalls(world);
      const from = world.clock.now;
      for (let i = 1; i <= 11; i++) {
        world.clock.now = from + i * EVERY;
        const before = world.db.usage.rowsWritten;
        expect(await world.contacts.sync("alarm")).toBe("ok");
        expect(world.db.usage.rowsWritten - before).toBeLessThanOrEqual(3);
      }
      expect(labelCalls(world)).toBe(start);
      expect(peopleCalls(world)).toHaveLength(0);
      world.clock.now = from + HOUR;
      expect(await world.contacts.sync("alarm")).toBe("ok");
      expect(labelCalls(world)).toBe(start + 1);
      // No contact is kept with the old set of fields: nothing is left "to read again".
      expect(row(world).fields_version).toBe(FIELDS_VERSION);
      world.db.run(`UPDATE zur_contact_sync SET fields_version = 1`);
      world.clock.now += EVERY;
      expect(await world.contacts.sync("alarm")).toBe("ok");
      expect(row(world).fields_version).toBe(FIELDS_VERSION);
      expect(labelCalls(world)).toBe(start + 1);
    }));

  it("reads the labels again right after the owner saves a choice", () =>
    withChatWorld(async (world) => {
      await turnOn(world);
      world.clock.now += EVERY;
      const start = labelCalls(world);
      world.contacts.select([FAMILY]);
      expect(row(world).labels_read_at).toBeNull();
      expect(await world.contacts.sync("alarm")).toBe("ok");
      expect(labelCalls(world)).toBe(start + 1);
    }));

  it("a contact in a label made in the last hour brings the labels once, and is stored with it", () =>
    withChatWorld(async (world) => {
      add(world, "c1", "Ana", [CLIENTS]);
      await turnOn(world);
      world.clock.now += EVERY;
      world.googleSim.people.groups.push({ resourceName: "contactGroups/nova", name: "Nova", groupType: "USER_CONTACT_GROUP", memberCount: 1 });
      world.googleSim.people.update("people/c1", { memberships: member(CLIENTS, "contactGroups/nova") });
      const start = labelCalls(world);
      expect(await world.contacts.sync("alarm")).toBe("ok");
      expect(labelCalls(world)).toBe(start + 1);
      expect(world.contacts.search({ limit: 5 }).contacts[0]?.labels).toEqual(["Clientes", "Nova"]);
    }));

  it("a contact in one of Google's own groups asks for nothing", () =>
    withChatWorld(async (world) => {
      add(world, "c1", "Ana", [CLIENTS]);
      await turnOn(world);
      const start = labelCalls(world);
      // "myContacts" (always there), "starred" and a system group only the list of labels told of.
      for (const group of ["contactGroups/starred", "contactGroups/algumDoGoogle"]) {
        world.clock.now += EVERY;
        world.googleSim.people.update("people/c1", { memberships: member(CLIENTS, group, "contactGroups/myContacts") });
        expect(await world.contacts.sync("alarm")).toBe("ok");
        expect(world.contacts.status().lastResult).toBe("changed");
      }
      expect(labelCalls(world)).toBe(start);
    }));

  it("the picker's refresh reads the labels from Google, at most once a minute, and never the contacts", () =>
    withChatWorld(async (world) => {
      add(world, "c1", "Ana", [CLIENTS]);
      await turnOn(world);
      world.clock.now += 2 * 60_000;
      world.googleSim.people.groups.push({ resourceName: "contactGroups/nova", name: "Nova", groupType: "USER_CONTACT_GROUP", memberCount: 3 });
      const labels = labelCalls(world);
      const people = peopleCalls(world).length;
      await world.contacts.refreshLabels();
      expect(labelCalls(world)).toBe(labels + 1);
      expect(world.contacts.labels().map((label) => [label.name, label.count, label.selected])).toEqual([
        ["Clientes", 2, true],
        ["Família", 1, false],
        ["Nova", 3, false],
      ]);
      // Opened again and again: the list kept serves for a minute.
      world.clock.now += 59_999;
      await world.contacts.refreshLabels();
      expect(labelCalls(world)).toBe(labels + 1);
      world.clock.now += 1;
      await world.contacts.refreshLabels();
      expect(labelCalls(world)).toBe(labels + 2);
      expect(peopleCalls(world).length).toBe(people);
      expect(row(world).running_since).toBeNull();
    }));

  it("SEC-S09-03: the picker's refresh asks a failing Google once a minute, not on every opening", () =>
    withChatWorld(async (world) => {
      await turnOn(world);
      world.clock.now += 2 * 60_000;
      world.googleSim.people.failure = { status: 500, body: { error: { code: 500 } } };
      const calls = world.googleSim.seen.length;
      await expect(world.contacts.refreshLabels()).rejects.toMatchObject({ kind: "unavailable" });
      const asked = world.googleSim.seen.length - calls;
      expect(asked).toBeGreaterThanOrEqual(1);
      for (let i = 0; i < 20; i++) {
        world.clock.now += 10;
        await world.contacts.refreshLabels();
      }
      world.clock.now += 59_799;
      await world.contacts.refreshLabels();
      expect(world.googleSim.seen.length - calls).toBe(asked);
      // At the minute, once more; the hourly read of the sync was never put off by the asking.
      world.clock.now += 1;
      await expect(world.contacts.refreshLabels()).rejects.toMatchObject({ kind: "unavailable" });
      expect(world.googleSim.seen.length - calls).toBe(2 * asked);
      expect(row(world).labels_read_at as number).toBeLessThan(world.clock.now - 60_000);
    }));

  it("the picker's refresh waits for a running sync, frees its lock when Google fails and does nothing while off", () =>
    withChatWorld(async (world) => {
      await world.contacts.refreshLabels();
      expect(labelCalls(world)).toBe(0);
      await turnOn(world);
      world.clock.now += 2 * 60_000;
      const labels = labelCalls(world);
      world.db.run(`UPDATE zur_contact_sync SET running_since = ?`, world.clock.now - 1_000);
      await world.contacts.refreshLabels();
      expect(labelCalls(world)).toBe(labels);
      world.db.run(`UPDATE zur_contact_sync SET running_since = NULL`);
      world.googleSim.people.failure = { status: 503, body: { error: { code: 503 } } };
      await expect(world.contacts.refreshLabels()).rejects.toMatchObject({ kind: "unavailable" });
      expect(row(world)).toMatchObject({ running_since: null, failures: 0, status: "ok" });
    }));
});

describe("\"Sync now\" once a minute", () => {
  it("refuses a second one inside the minute, saying how long to wait, and allows it at the minute", () =>
    withChatWorld(async (world) => {
      await turnOn(world);
      world.clock.now += EVERY;
      expect(await world.contacts.syncNow()).toBe("ok");
      const calls = world.googleSim.seen.length;
      await expect(world.contacts.syncNow()).rejects.toMatchObject({ code: "RATE_LIMITED", messageKey: "error.googleContactsSyncSoon", details: { retryAfter: 60 } });
      world.clock.now += 59_001;
      await expect(world.contacts.syncNow()).rejects.toMatchObject({ code: "RATE_LIMITED", details: { retryAfter: 1 } });
      world.clock.now += 998;
      await expect(world.contacts.syncNow()).rejects.toMatchObject({ code: "RATE_LIMITED", details: { retryAfter: 1 } });
      // Refused ones never reach Google.
      expect(world.googleSim.seen.length).toBe(calls);
      world.clock.now += 1;
      expect(await world.contacts.syncNow()).toBe("ok");
    }));

  it("SEC-S09-02: saving the same choice of labels again gives no minute back, nor the labels' hour", () =>
    withChatWorld(async (world) => {
      await turnOn(world);
      world.clock.now += EVERY;
      expect(await world.contacts.syncNow()).toBe("ok");
      const calls = world.googleSim.seen.length;
      const read = row(world).labels_read_at;
      for (let i = 0; i < 20; i++) {
        world.clock.now += 10;
        world.contacts.select([CLIENTS]);
        await expect(world.contacts.syncNow()).rejects.toMatchObject({ code: "RATE_LIMITED" });
      }
      expect(world.googleSim.seen.length).toBe(calls);
      expect(row(world).labels_read_at).toBe(read);
      // A label taken out is a new choice (and putting it back asks for the password, on the route).
      world.contacts.select([]);
      expect(row(world)).toMatchObject({ labels_read_at: null, synced_now_at: null });
    }));

  it("has its minute back when the owner saves a choice of labels, and survives a clock set back", () =>
    withChatWorld(async (world) => {
      add(world, "c1", "Ana", [FAMILY]);
      await turnOn(world);
      world.clock.now += EVERY;
      expect(await world.contacts.syncNow()).toBe("ok");
      world.contacts.select([CLIENTS, FAMILY]);
      expect(await world.contacts.syncNow()).toBe("ok");
      expect(world.contacts.count()).toBe(1);
      // A time kept in the future (the clock went back) never locks the button.
      world.db.run(`UPDATE zur_contact_sync SET synced_now_at = ?`, world.clock.now + HOUR);
      expect(await world.contacts.syncNow()).toBe("ok");
    }));
});

describe("the fields Zuri started to keep", () => {
  it("asks Google for addresses, sites, relations and chat names, on every read", () =>
    withChatWorld(async (world) => {
      add(world, "c1", "Ana", [CLIENTS]);
      await turnOn(world);
      world.clock.now += EVERY;
      await world.contacts.sync("alarm");
      for (const field of ["addresses", "urls", "relations", "imClients", "names", "memberships", "metadata"]) expect(PERSON_FIELDS.split(",")).toContain(field);
      for (const call of peopleCalls(world)) expect(new URL(call.url).searchParams.get("personFields")).toBe(PERSON_FIELDS);
    }));

  it("reads every contact once more when the set of fields grew, then goes back to reading what changed", () =>
    withChatWorld(async (world) => {
      add(world, "c1", "Ana", [CLIENTS], { addresses: [{ formattedValue: "Rua A, 1" }] });
      add(world, "c2", "Bia", [CLIENTS]);
      await turnOn(world);
      expect(row(world).fields_version).toBe(FIELDS_VERSION);
      // A copy made by the version before: the same etags, without the new fields, in the middle of nothing.
      const stripped = copy(world).map((item) => ({ ...item, data: JSON.stringify({ ...JSON.parse(item.data), addresses: undefined, more: undefined }) }));
      for (const item of stripped) world.db.run(`UPDATE zur_contacts SET data = ? WHERE id = ?`, item.data, item.id);
      world.db.run(`UPDATE zur_contact_sync SET fields_version = 1, page_token = 'p.old', page_mode = 'incremental'`);
      const ana = world.db.one<{ id: string }>(`SELECT id FROM zur_contacts WHERE resource_name = 'people/c1'`)?.id ?? "";
      expect(world.contacts.get(ana)?.addresses).toEqual([]);
      world.clock.now += EVERY;
      const calls = peopleCalls(world).length;
      const number = area(world);
      expect(await world.contacts.sync("alarm")).toBe("ok");
      // A full read from the first page: no sync token, no page token of the old set of fields.
      const [call] = peopleCalls(world).slice(calls);
      const asked = new URL(call?.url ?? "").searchParams;
      expect(asked.get("requestSyncToken")).toBe("true");
      expect(asked.get("syncToken")).toBeNull();
      expect(asked.get("pageToken")).toBeNull();
      expect(row(world)).toMatchObject({ fields_version: FIELDS_VERSION, full_needed: 0, page_token: null, last_result: "changed" });
      expect(area(world)).toBeGreaterThan(number);
      // The etag didn't move at Google, and the contact was stored again all the same.
      expect(copy(world).map((item) => item.etag)).toEqual(stripped.map((item) => item.etag));
      expect(world.contacts.get(ana)?.addresses).toEqual([{ label: "", value: "Rua A, 1" }]);
      expect(world.contacts.count()).toBe(2);
      // Back to the usual: what changed only, and nothing written when nothing did.
      world.clock.now += EVERY;
      const after = area(world);
      expect(await world.contacts.sync("alarm")).toBe("ok");
      expect(new URL(peopleCalls(world).at(-1)?.url ?? "").searchParams.get("syncToken")).toMatch(/^sync\.\d+$/);
      expect(area(world)).toBe(after);
    }));

  it("CF-S09-04: the read for the new fields stores again only the contacts that have something in them", () =>
    withChatWorld(async (world) => {
      add(world, "c1", "Ana", [CLIENTS], { addresses: [{ formattedValue: "Rua A, 1" }], phoneNumbers: [{ value: "(11) 99999-0001" }] });
      for (let i = 2; i <= 40; i++) add(world, `c${i}`, `Pessoa ${i}`, [CLIENTS], { phoneNumbers: [{ value: `(11) 99999-00${String(i).padStart(2, "0")}` }], emailAddresses: [{ value: `p${i}@exemplo.com.br` }] });
      await turnOn(world);
      // The copy as the version before left it: no key for the new fields in any contact.
      for (const item of copy(world)) {
        const { middle: _m, addresses: _a, urls: _u, relations: _r, chats: _c, more: _o, ...old } = JSON.parse(item.data) as Record<string, unknown>;
        world.db.run(`UPDATE zur_contacts SET data = ? WHERE id = ?`, JSON.stringify(old), item.id);
      }
      world.db.run(`UPDATE zur_contact_sync SET fields_version = 1`);
      const before = new Map(copy(world).map((item) => [item.id, item.data]));
      world.clock.now += EVERY;
      const usage = { ...world.db.usage };
      expect(await world.contacts.sync("alarm")).toBe("ok");
      const rewritten = copy(world).filter((item) => item.data !== before.get(item.id));
      // Ana has an address now; the other 39 were only marked as seen.
      expect(rewritten).toHaveLength(1);
      expect(JSON.parse(rewritten[0]?.data ?? "{}")).toMatchObject({ addresses: [{ label: "", value: "Rua A, 1" }] });
      expect(copy(world).every((item) => item.synced_at === world.clock.now)).toBe(true);
      // One row for each contact seen and a dozen for the one stored, not a dozen for each (40 × 12 = 480).
      expect(world.db.usage.rowsWritten - usage.rowsWritten).toBeLessThanOrEqual(70);
      expect(row(world)).toMatchObject({ fields_version: FIELDS_VERSION, last_result: "changed" });
      expect(world.contacts.count()).toBe(40);
    }));

  it("goes on with a full read for the new fields across wakes, without starting it again", () =>
    withChatWorld(async (world) => {
      await turnOn(world);
      for (let i = 0; i < 10_030; i++) world.googleSim.people.add({ resourceName: `people/p${i}`, names: [{ displayName: `P${i}` }], memberships: member(i < 3 ? CLIENTS : FAMILY) });
      world.db.run(`UPDATE zur_contact_sync SET fields_version = 1`);
      const { GoogleMeter } = await import("../src/google/service.ts");
      world.clock.now += EVERY;
      expect(await world.contacts.sync("alarm", new GoogleMeter(40))).toBe("partial");
      expect(row(world)).toMatchObject({ fields_version: -FIELDS_VERSION, page_mode: "full", page_token: "p.10000" });
      expect(world.contacts.status().refreshing).toBe(true);
      const calls = peopleCalls(world).length;
      expect(await world.contacts.sync("alarm")).toBe("ok");
      // The eleventh page only: the read went on from where it stopped.
      expect(peopleCalls(world).length - calls).toBe(1);
      expect(new URL(peopleCalls(world).at(-1)?.url ?? "").searchParams.get("pageToken")).toBe("p.10000");
      expect(row(world)).toMatchObject({ fields_version: FIELDS_VERSION, page_mode: null, full_needed: 0 });
      expect(world.contacts.count()).toBe(3);
    }));

  it("SEC-S09-05: reads a page of 1,000 contacts that weighs more than 1 MiB, and refuses one past 4 MiB", () =>
    withChatWorld(async (world) => {
      await turnOn(world);
      const { MAX_PEOPLE_BYTES } = await import("../src/google/service.ts");
      expect(MAX_PEOPLE_BYTES).toBe(4 * 1024 * 1024);
      // About 2 KB a contact, as Google sends them with its metadata on every field.
      const filler = "x".repeat(1_900);
      for (let i = 0; i < 1_000; i++) world.googleSim.people.add({ resourceName: `people/g${i}`, names: [{ displayName: `G${i}`, metadata: { filler } }], memberships: member(CLIENTS) });
      world.db.run(`UPDATE zur_contact_sync SET full_needed = 1`);
      world.clock.now += EVERY;
      expect(await world.contacts.sync("alarm")).toBe("ok");
      expect(world.contacts.count()).toBe(1_000);
      // Past the ceiling the answer is not trusted: a failure that waits, never a half-read page.
      world.googleSim.people.update("people/g0", { names: [{ displayName: "G0", metadata: { filler: "y".repeat(MAX_PEOPLE_BYTES) } }] });
      world.clock.now += EVERY;
      expect(await world.contacts.sync("alarm")).toBe("failed");
      expect(world.contacts.count()).toBe(1_000);
      expect(world.contacts.status().lastResult).toBe("failed");
    }));

  it("keeps the name's parts, addresses, sites, relations and chat names, cut and counted", () => {
    const kept = readPerson({
      resourceName: "people/c1",
      names: [{ givenName: "Ana", middleName: "Maria", familyName: "Souza" }],
      addresses: [
        { formattedValue: "Rua das Flores, 120\nCuritiba - PR\n80000-000", formattedType: "Casa" },
        // No formatted line: the parts it has, in the order of an envelope.
        { streetAddress: "Av. Brasil, 10", city: "São Paulo", region: "", country: "Brasil", type: "work" },
        // Nothing at all: left out, not a blank line.
        { formattedType: "Outro" },
        { formattedValue: "x".repeat(400) },
      ],
      urls: [
        { value: "https://exemplo.com.br/ana", formattedType: "Blog" },
        { value: "exemplo.com.br" },
        { value: "javascript:alert(1)" },
        { value: "data:text/html,oi" },
        { value: "https://usuario:senha@exemplo.com.br" },
        { value: "isto não é um site" },
        { value: "" },
      ],
      relations: [{ person: "Bruno Lima", formattedType: "Irmão" }, { person: "", type: "mother" }, { person: "Carla‮" }],
      imClients: [{ username: "ana.souza", formattedProtocol: "Telegram" }, { username: "ana", protocol: "skype" }, { formattedProtocol: "Sem nome" }],
    });
    expect(kept.display).toBe("Ana Maria Souza");
    expect(kept.data).toMatchObject({ given: "Ana", middle: "Maria", family: "Souza" });
    expect(kept.data.addresses.slice(0, 2)).toEqual([
      { label: "Casa", value: "Rua das Flores, 120 Curitiba - PR 80000-000" },
      { label: "work", value: "Av. Brasil, 10, São Paulo, Brasil" },
    ]);
    expect(kept.data.addresses).toHaveLength(3);
    expect([...(kept.data.addresses[2]?.value ?? "")]).toHaveLength(CONTACT_LIMITS.address);
    expect(kept.data.urls).toEqual([
      { label: "Blog", value: "https://exemplo.com.br/ana" },
      { label: "", value: "https://exemplo.com.br/" },
    ]);
    expect(kept.data.relations).toEqual([
      { label: "Irmão", value: "Bruno Lima" },
      { label: "", value: "Carla" },
    ]);
    expect(kept.data.chats).toEqual([
      { label: "Telegram", value: "ana.souza" },
      { label: "skype", value: "ana" },
    ]);
    expect(kept.data.more).toEqual({});
  });

  it("keeps ten of each list and counts what Google has past them (n, n + 1)", () => {
    const many = (n: number) => ({
      resourceName: "people/c1",
      addresses: Array.from({ length: n }, (_, i) => ({ formattedValue: `Rua ${i}` })),
      urls: Array.from({ length: n }, (_, i) => ({ value: `https://exemplo.com.br/${i}` })),
      relations: Array.from({ length: n }, (_, i) => ({ person: `Pessoa ${i}` })),
      imClients: Array.from({ length: n }, (_, i) => ({ username: `u${i}` })),
    });
    const exact = readPerson(many(10)).data;
    expect([exact.addresses.length, exact.urls.length, exact.relations.length, exact.chats.length]).toEqual([10, 10, 10, 10]);
    expect(exact.more).toEqual({});
    const over = readPerson(many(13)).data;
    expect([over.addresses.length, over.urls.length, over.relations.length, over.chats.length]).toEqual([10, 10, 10, 10]);
    expect(over.more).toEqual({ addresses: 3, urls: 3, relations: 3, chats: 3 });
    expect(over.addresses.at(-1)?.value).toBe("Rua 9");
  });

  it("shows a contact without a name by its nickname, e-mail or phone, and without anything as empty", () => {
    expect(readPerson({ resourceName: "people/c1", nicknames: [{ value: "Aninha" }], emailAddresses: [{ value: "ana@exemplo.com.br" }] }).display).toBe("Aninha");
    expect(readPerson({ resourceName: "people/c1", emailAddresses: [{ value: "ana@exemplo.com.br" }], phoneNumbers: [{ value: "(11) 99999-0001" }] }).display).toBe("ana@exemplo.com.br");
    expect(readPerson({ resourceName: "people/c1", phoneNumbers: [{ value: "(11) 99999-0001" }] }).display).toBe("(11) 99999-0001");
    const empty = readPerson({ resourceName: "people/c1" });
    expect(empty.display).toBe("");
    expect(empty.data).toEqual({ given: "", middle: "", family: "", nickname: "", phones: [], emails: [], birthday: null, dates: [], organization: "", jobTitle: "", notes: "", fields: [], addresses: [], urls: [], relations: [], chats: [], more: {} });
  });

  it("QA-S09-05: cuts an address at 300 characters and drops a site past 200 (n - 1, n, n + 1)", () => {
    const address = (length: number) => readPerson({ resourceName: "people/c1", addresses: [{ formattedValue: "a".repeat(length) }] }).data.addresses[0]?.value ?? "";
    const max = CONTACT_LIMITS.address;
    expect(address(max - 1)).toBe("a".repeat(max - 1));
    expect(address(max)).toBe("a".repeat(max));
    expect([...address(max + 1)]).toHaveLength(max);
    const site = (length: number) => `https://exemplo.com.br/${"x".repeat(length - "https://exemplo.com.br/".length)}`;
    const top = CONTACT_LIMITS.url;
    expect(siteUrl(site(top - 1))).toBe(site(top - 1));
    expect(siteUrl(site(top))).toBe(site(top));
    // A link cut short would lead somewhere else: past the ceiling it is left out whole.
    expect(siteUrl(site(top + 1))).toBe("");
    const kept = readPerson({ resourceName: "people/c1", urls: [{ value: site(top + 1) }, { value: site(top) }] });
    expect(kept.data.urls).toEqual([{ label: "", value: site(top) }]);
  });

  it("only keeps a site the screen may link: http or https, a real host, no user or password", () => {
    expect(siteUrl("https://exemplo.com.br")).toBe("https://exemplo.com.br/");
    // As the browser reads it: the host in lower case, a backslash as a slash (SEC-S09-06).
    expect(siteUrl("https://EXEMPLO.com.br\\@outro.exemplo.com.br")).toBe("https://exemplo.com.br/@outro.exemplo.com.br");
    expect(siteUrl("http://exemplo.com.br/a?b=1#c")).toBe("http://exemplo.com.br/a?b=1#c");
    expect(siteUrl("exemplo.com.br:8080/a")).toBe("https://exemplo.com.br:8080/a");
    expect(siteUrl("  www.exemplo.com.br  ")).toBe("https://www.exemplo.com.br/");
    for (const bad of ["javascript:alert(1)", "JAVASCRIPT:alert(1)", " javascript:alert(1)", "java\tscript:alert(1)", "data:text/html,x", "vbscript:x", "file:///etc/passwd", "tel:+5511999990001", "mailto:ana@exemplo.com.br", "ftp://exemplo.com.br", "https://a:b@exemplo.com.br", "ana@exemplo.com.br", "localhost", "https://", "//exemplo.com.br", "exemplo com br", "", null, 7, `https://exemplo.com.br/${"x".repeat(300)}`]) {
      expect(siteUrl(bad), String(bad)).toBe("");
    }
  });

  it("a contact from Google out of shape in a new field is skipped whole, and an unknown field is ignored", () =>
    withChatWorld(async (world) => {
      add(world, "c1", "Ana", [CLIENTS], { addresses: "não é uma lista" });
      add(world, "c2", "Bia", [CLIENTS], { campoQueOGoogleCriou: [{ value: "x" }], addresses: [{ formattedValue: "Rua B, 2", chaveNova: true }] });
      await turnOn(world);
      expect(world.contacts.search({ limit: 5 }).contacts.map((contact) => contact.name)).toEqual(["Bia"]);
    }));

  it("the screen and get_contact get the new fields; the list and search_contacts don't", () =>
    withChatWorld(async (world) => {
      add(world, "c1", "Ana Souza", [CLIENTS], {
        names: [{ displayName: "Ana Souza", givenName: "Ana", middleName: "M.", familyName: "Souza" }],
        addresses: [{ formattedValue: "Rua das Flores, 120" }],
        urls: [{ value: "https://exemplo.com.br/" }],
        relations: [{ person: "Bruno", formattedType: "Irmão" }],
        imClients: [{ username: "ana.souza", formattedProtocol: "Telegram" }],
        phoneNumbers: Array.from({ length: 11 }, (_, i) => ({ value: `(11) 99999-00${String(i).padStart(2, "0")}` })),
      });
      add(world, "c2", "Bia", [CLIENTS]);
      await turnOn(world);
      const list = world.contacts.search({ limit: 5 }).contacts;
      expect(Object.keys(list[0] ?? {}).sort()).toEqual(["birthday", "email", "id", "labels", "name", "phone"]);
      const ana = world.contacts.get(list[0]?.id ?? "");
      expect(ana).toMatchObject({
        given: "Ana",
        middle: "M.",
        family: "Souza",
        addresses: [{ label: "", value: "Rua das Flores, 120" }],
        urls: [{ label: "", value: "https://exemplo.com.br/" }],
        relations: [{ label: "Irmão", value: "Bruno" }],
        chats: [{ label: "Telegram", value: "ana.souza" }],
        more: { phones: 1 },
      });
      // Nothing at Google: empty lists, never a missing key (the screen lists them as "Empty at Google").
      expect(world.contacts.get(list[1]?.id ?? "")).toMatchObject({ given: "", middle: "", family: "", addresses: [], urls: [], relations: [], chats: [], more: {}, phones: [], emails: [] });
      const executor = new ToolExecutor(ALL_TOOLS, world.ctx(world.conversations.create("x").id, "chat"), { maxToolCalls: 12 });
      // Third parties' text: inside <data>, like the rest of the contact.
      const got = await executor.execute("get_contact", { id: list[0]?.id ?? "" }, "c1");
      expect(got).toMatch(/^<data source="contact" id="get_contact">.*<\/data>$/s);
      for (const text of ['"addresses":[{"label":"","value":"Rua das Flores, 120"}]', '"sites":[{"label":"","value":"https://exemplo.com.br/"}]', '"relations":[{"label":"Irmão","value":"Bruno"}]', '"chats":[{"label":"Telegram","value":"ana.souza"}]']) {
        expect(got).toContain(text);
      }
      const bare = await executor.execute("get_contact", { id: list[1]?.id ?? "" }, "c2");
      expect(bare).not.toMatch(/"(addresses|sites|relations|chats)"/);
      const found = await executor.execute("search_contacts", { query: "ana" }, "c3");
      expect(found).not.toMatch(/Rua das Flores|ana\.souza|Bruno/);
    }));
});
