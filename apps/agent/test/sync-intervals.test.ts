import { CONTACT_LIMITS, contactSettingsSchema, REVIEW_LIMITS, reviewIntervalSchema } from "@zuri/shared";
import { describe, expect, it } from "vitest";
import { type ChatWorld, withChatWorld } from "./chat-world.ts";
import { add as addReview, draftAnswer, LOCATION, type ReviewsWorld, row as reviewRow, SECOND_OK, turnOn as turnReviewsOn, withReviewsWorld } from "./reviews-world.ts";

// The owner's interval for each sync (Settings, 11/11/2026) and the comparison that keeps a read with
// nothing new from writing: a contact whose etag moved for something Zuri doesn't keep, and a review
// whose time moved with the same stars and the same text.

const MINUTE = 60_000;
const CLIENTS = "contactGroups/clientes";
const iso = (ms: number) => new Date(ms).toISOString();

async function consent(world: ChatWorld, purpose: "calendar" | "contacts") {
  const url = new URL(await world.google.begin("sessao", purpose));
  return world.google.finish({ state: url.searchParams.get("state") ?? "", code: `dev.${url.searchParams.get("code_challenge") ?? ""}` }, "sessao");
}

async function turnContactsOn(world: ChatWorld): Promise<void> {
  world.googleSim.people.groups.push({ resourceName: CLIENTS, name: "Clientes", groupType: "USER_CONTACT_GROUP", memberCount: 2 });
  await consent(world, "calendar");
  await consent(world, "contacts");
  world.contacts.enable();
  expect(await world.contacts.sync("owner")).toBe("ok");
  world.contacts.select([CLIENTS]);
  expect(await world.contacts.sync("owner")).toBe("ok");
}

const member = (...labels: string[]) => labels.map((label) => ({ contactGroupMembership: { contactGroupResourceName: label } }));
const addContact = (world: ChatWorld, id: string, name: string, extra: Record<string, unknown> = {}) =>
  world.googleSim.people.add({ resourceName: `people/${id}`, names: [{ displayName: name }], memberships: member(CLIENTS, "contactGroups/myContacts"), ...extra });
const contactsArea = (world: ChatWorld) => world.db.one<{ contacts: number }>(`SELECT contacts FROM zur_area_versions WHERE id = 1`)?.contacts ?? -1;
const reviewsArea = (world: ReviewsWorld) => world.db.one<{ reviews: number }>(`SELECT reviews FROM zur_area_versions WHERE id = 1`)?.reviews ?? -1;
const contact = (world: ChatWorld, id: string) =>
  world.db.one<{ id: string; etag: string; data: string; display_name: string }>(`SELECT id, etag, data, display_name FROM zur_contacts WHERE resource_name = ?`, `people/${id}`);

describe("the interval the owner may pick", () => {
  it("accepts whole minutes from 5 to 1,440 and nothing else (n - 1, n, n + 1)", () => {
    expect(CONTACT_LIMITS.syncEveryMinMinutes).toBe(5);
    expect(CONTACT_LIMITS.syncEveryMaxMinutes).toBe(1_440);
    expect(REVIEW_LIMITS.checkEveryMinMinutes).toBe(5);
    expect(REVIEW_LIMITS.checkEveryMaxMinutes).toBe(1_440);
    for (const schema of [contactSettingsSchema, reviewIntervalSchema]) {
      for (const minutes of [5, 6, 60, 1_439, 1_440]) expect(schema.safeParse({ syncEveryMinutes: minutes }).success).toBe(true);
      for (const minutes of [4, 0, -5, 1_441, 5.5, Number.NaN, Number.POSITIVE_INFINITY, "10", null, [10]]) {
        expect(schema.safeParse({ syncEveryMinutes: minutes }).success).toBe(false);
      }
    }
    // The reviews' route takes the interval alone.
    expect(reviewIntervalSchema.safeParse({}).success).toBe(false);
    expect(reviewIntervalSchema.safeParse({ syncEveryMinutes: 10, level: "auto" }).success).toBe(false);
  });
});

describe("the contacts at the owner's interval", () => {
  it("starts at five minutes and, once changed, plans every read by the new interval", () =>
    withChatWorld(async (world) => {
      addContact(world, "c1", "Ana");
      await turnContactsOn(world);
      const first = world.clock.now;
      expect(world.contacts.status()).toMatchObject({ syncEveryMinutes: 5, nextSyncAt: iso(first + 5 * MINUTE) });
      expect(world.contacts.configure({ syncEveryMinutes: 15 })).toMatchObject({ syncEveryMinutes: 15, nextSyncAt: iso(first + 15 * MINUTE) });
      expect(world.contacts.nextDue()).toBe(first + 15 * MINUTE);
      // One millisecond before, nothing is due; at the time, the alarm reads, and plans the next one 15 minutes on.
      world.clock.now = first + 15 * MINUTE - 1;
      expect(await world.contacts.tick()).toBe(false);
      world.clock.now = first + 15 * MINUTE;
      expect(await world.contacts.tick()).toBe(true);
      expect(world.contacts.status()).toMatchObject({ lastResult: "unchanged", nextSyncAt: iso(first + 30 * MINUTE) });
      // "Sync now" plans by it too.
      world.clock.now += 2 * MINUTE;
      expect(await world.contacts.syncNow()).toBe("ok");
      expect(world.contacts.status().nextSyncAt).toBe(iso(world.clock.now + 15 * MINUTE));
    }));

  it("a shorter interval is felt at once, never with a read planned in the past", () =>
    withChatWorld(async (world) => {
      addContact(world, "c1", "Ana");
      await turnContactsOn(world);
      world.contacts.configure({ syncEveryMinutes: 60 });
      const last = world.clock.now;
      // 20 minutes after the last read, 30 minutes: the next one is 30 after the last, not 30 from now.
      world.clock.now = last + 20 * MINUTE;
      expect(world.contacts.configure({ syncEveryMinutes: 30 }).nextSyncAt).toBe(iso(last + 30 * MINUTE));
      // Now 5 minutes: the last read was 20 minutes ago, so the next one is due now.
      expect(world.contacts.configure({ syncEveryMinutes: 5 }).nextSyncAt).toBe(iso(world.clock.now));
      expect(await world.contacts.tick()).toBe(true);
      expect(world.contacts.status().nextSyncAt).toBe(iso(world.clock.now + 5 * MINUTE));
    }));

  it("the same interval saved again moves nothing, and the notices' form leaves the interval alone", () =>
    withChatWorld(async (world) => {
      addContact(world, "c1", "Ana");
      await turnContactsOn(world);
      world.contacts.configure({ syncEveryMinutes: 20 });
      const planned = world.contacts.status().nextSyncAt;
      world.clock.now += 7 * MINUTE;
      expect(world.contacts.configure({ syncEveryMinutes: 20 }).nextSyncAt).toBe(planned);
      expect(world.contacts.configure({ birthdays: false })).toMatchObject({ syncEveryMinutes: 20, nextSyncAt: planned });
    }));

  it("a retry after a failure keeps its time when the interval changes; the next good read plans by the new one", () =>
    withChatWorld(async (world) => {
      addContact(world, "c1", "Ana");
      await turnContactsOn(world);
      world.googleSim.people.failure = { status: 503, body: {} };
      world.clock.now += 5 * MINUTE;
      expect(await world.contacts.sync("alarm")).toBe("failed");
      const retry = world.contacts.status().nextSyncAt;
      expect(retry).toBe(iso(world.clock.now + 5 * MINUTE));
      // A day's interval doesn't push the retry a day away, and a failing Google is still asked again soon.
      expect(world.contacts.configure({ syncEveryMinutes: 1_440 }).nextSyncAt).toBe(retry);
      world.clock.now += 5 * MINUTE;
      expect(await world.contacts.sync("alarm")).toBe("failed");
      expect(world.contacts.status().nextSyncAt).toBe(iso(world.clock.now + 10 * MINUTE));
      world.googleSim.people.failure = null;
      world.clock.now += 10 * MINUTE;
      expect(await world.contacts.sync("alarm")).toBe("ok");
      expect(world.contacts.status().nextSyncAt).toBe(iso(world.clock.now + 1_440 * MINUTE));
    }));

  it("a sync that waits for the owner (a problem) or for its next pages keeps its time when the interval changes", () =>
    withChatWorld(async (world) => {
      addContact(world, "c1", "Ana");
      await turnContactsOn(world);
      const planned = world.clock.now + 5 * MINUTE;
      // The People API turned off at Google: the sync waits six hours and the card says what to do.
      world.db.run(`UPDATE zur_contact_sync SET problem = 'api_disabled', status = 'error', next_sync = ? WHERE id = 1`, world.clock.now + 360 * MINUTE);
      expect(world.contacts.configure({ syncEveryMinutes: 10 }).nextSyncAt).toBe(iso(world.clock.now + 360 * MINUTE));
      // A read cut in pages, with the rest planned a minute out: the interval doesn't push it away.
      world.db.run(`UPDATE zur_contact_sync SET problem = NULL, status = 'ok', page_mode = 'full', page_token = 'p2', next_sync = ? WHERE id = 1`, world.clock.now + MINUTE);
      expect(world.contacts.configure({ syncEveryMinutes: 60 }).nextSyncAt).toBe(iso(world.clock.now + MINUTE));
      // With nothing of that, it moves.
      world.db.run(`UPDATE zur_contact_sync SET page_mode = NULL, page_token = NULL, next_sync = ? WHERE id = 1`, planned);
      expect(world.contacts.configure({ syncEveryMinutes: 30 }).nextSyncAt).toBe(iso(world.clock.now + 30 * MINUTE));
    }));

  it("a row with an interval out of the range (a damaged one) is read as the nearest allowed", () =>
    withChatWorld(async (world) => {
      addContact(world, "c1", "Ana");
      await turnContactsOn(world);
      world.db.run(`UPDATE zur_contact_sync SET sync_every_min = 0 WHERE id = 1`);
      expect(world.contacts.status().syncEveryMinutes).toBe(5);
      world.clock.now += 5 * MINUTE;
      expect(await world.contacts.sync("alarm")).toBe("ok");
      expect(world.contacts.status().nextSyncAt).toBe(iso(world.clock.now + 5 * MINUTE));
      world.db.run(`UPDATE zur_contact_sync SET sync_every_min = 999999 WHERE id = 1`);
      expect(world.contacts.status().syncEveryMinutes).toBe(1_440);
    }));

  it("turned off, the interval is kept for when the contacts come back", () =>
    withChatWorld(async (world) => {
      addContact(world, "c1", "Ana");
      await turnContactsOn(world);
      world.contacts.configure({ syncEveryMinutes: 45 });
      world.contacts.disable();
      expect(world.contacts.status()).toMatchObject({ enabled: false, nextSyncAt: null });
      world.contacts.enable();
      expect(world.contacts.status().syncEveryMinutes).toBe(45);
    }));
});

describe("a contact is stored again only when what Zuri keeps of it changed", () => {
  it("a new etag for something Zuri doesn't keep writes the etag alone and tells the screens nothing", () =>
    withChatWorld(async (world) => {
      addContact(world, "c1", "Ana", { phoneNumbers: [{ value: "(11) 99999-0001", canonicalForm: "+5511999990001" }], emailAddresses: [{ value: "ana@exemplo.com.br" }] });
      addContact(world, "c2", "Bia");
      await turnContactsOn(world);
      const before = contact(world, "c1");
      const other = contact(world, "c2");
      const number = contactsArea(world);
      const keys = world.db.all(`SELECT * FROM zur_contact_keys ORDER BY kind, value`);
      const memberships = world.db.all(`SELECT * FROM zur_contact_memberships ORDER BY label, contact_id`);
      // A photo, and a label Zuri doesn't offer: Google moves the etag, nothing Zuri keeps moved.
      world.googleSim.people.update("people/c1", {
        photos: [{ url: "https://exemplo.com.br/foto.jpg" }],
        memberships: member(CLIENTS, "contactGroups/myContacts", "contactGroups/starred"),
      });
      world.clock.now += 5 * MINUTE;
      const usage = { ...world.db.usage };
      expect(await world.contacts.sync("alarm")).toBe("ok");
      // The lock, the contact's etag, the sync's own row and the lock's release (rule P4).
      expect(world.db.usage.rowsWritten - usage.rowsWritten).toBeLessThanOrEqual(4);
      const after = contact(world, "c1");
      expect(after?.etag).not.toBe(before?.etag);
      expect({ ...after, etag: "" }).toEqual({ ...before, etag: "" });
      expect(contact(world, "c2")).toEqual(other);
      expect(world.db.all(`SELECT * FROM zur_contact_keys ORDER BY kind, value`)).toEqual(keys);
      expect(world.db.all(`SELECT * FROM zur_contact_memberships ORDER BY label, contact_id`)).toEqual(memberships);
      expect(contactsArea(world)).toBe(number);
      expect(world.contacts.status()).toMatchObject({ lastResult: "unchanged", contacts: 2 });
      expect(world.contactNotices).toEqual([]);
    }));

  it.each([
    ["the name shown", { names: [{ displayName: "Ana Lima" }] }, "Ana Lima"],
    ["a phone", { phoneNumbers: [{ value: "(11) 98888-0002", canonicalForm: "+5511988880002" }] }, "Ana"],
    ["the same phone read by Google as another number", { phoneNumbers: [{ value: "(11) 99999-0001", canonicalForm: "+5521999990001" }] }, "Ana"],
    ["a note", { biographies: [{ value: "Prefere contato pela manhã" }] }, "Ana"],
    ["an e-mail", { emailAddresses: [{ value: "ana@exemplo.com.br" }] }, "Ana"],
    ["the birthday", { birthdays: [{ date: { month: 3, day: 9 } }] }, "Ana"],
    ["a special date", { events: [{ type: "Retorno", date: { month: 7, day: 21 } }] }, "Ana"],
  ])("%s that changed is stored, and the screens are told", (_what, patch, name) =>
    withChatWorld(async (world) => {
      addContact(world, "c1", "Ana", { phoneNumbers: [{ value: "(11) 99999-0001", canonicalForm: "+5511999990001" }] });
      await turnContactsOn(world);
      const number = contactsArea(world);
      world.googleSim.people.update("people/c1", patch);
      world.clock.now += 5 * MINUTE;
      expect(await world.contacts.sync("alarm")).toBe("ok");
      expect(world.contacts.status().lastResult).toBe("changed");
      expect(contactsArea(world)).toBeGreaterThan(number);
      expect(contact(world, "c1")?.display_name).toBe(name);
      const canonical = (patch as { phoneNumbers?: { canonicalForm: string }[] }).phoneNumbers?.[0]?.canonicalForm;
      if (canonical) expect(world.db.all<{ value: string }>(`SELECT value FROM zur_contact_keys WHERE kind = 'phone'`).map((key) => key.value)).toEqual([canonical]);
    }));

  it("a contact that joins another chosen label is stored with it, even with the same data", () =>
    withChatWorld(async (world) => {
      const FAMILY = "contactGroups/familia";
      world.googleSim.people.groups.push({ resourceName: FAMILY, name: "Família", groupType: "USER_CONTACT_GROUP", memberCount: 0 });
      addContact(world, "c1", "Ana");
      await turnContactsOn(world);
      world.contacts.select([CLIENTS, FAMILY]);
      expect(await world.contacts.sync("owner")).toBe("ok");
      world.googleSim.people.update("people/c1", { memberships: member(CLIENTS, FAMILY) });
      world.clock.now += 5 * MINUTE;
      expect(await world.contacts.sync("alarm")).toBe("ok");
      expect(world.contacts.status().lastResult).toBe("changed");
      expect(world.db.all<{ label: string }>(`SELECT label FROM zur_contact_memberships ORDER BY label`).map((row) => row.label)).toEqual([CLIENTS, FAMILY]);
    }));

  it("a full read with every etag moved and nothing else stores no contact again and forgets no one", () =>
    withChatWorld(async (world) => {
      for (let i = 0; i < 20; i++) addContact(world, `c${i}`, `Contato ${i}`, { emailAddresses: [{ value: `c${i}@exemplo.com.br` }] });
      await turnContactsOn(world);
      const data = world.db.all(`SELECT id, data, display_name FROM zur_contacts ORDER BY id`);
      const number = contactsArea(world);
      for (let i = 0; i < 20; i++) world.googleSim.people.update(`people/c${i}`, { photos: [{ url: "https://exemplo.com.br/foto.jpg" }] });
      // The token Google gave is gone (older than 7 days): everything is read again.
      world.db.run(`UPDATE zur_contact_sync SET people_sync_token = NULL, full_needed = 1 WHERE id = 1`);
      world.clock.now += 5 * MINUTE;
      const usage = { ...world.db.usage };
      expect(await world.contacts.sync("alarm")).toBe("ok");
      // One row per contact (its etag and the mark of seen), not the dozen a stored contact takes.
      expect(world.db.usage.rowsWritten - usage.rowsWritten).toBeLessThanOrEqual(20 + 8);
      expect(world.db.all(`SELECT id, data, display_name FROM zur_contacts ORDER BY id`)).toEqual(data);
      expect(contactsArea(world)).toBe(number);
      expect(world.contacts.status()).toMatchObject({ lastResult: "unchanged", contacts: 20 });
    }));
});

describe("the reviews at the owner's interval", () => {
  it("starts at ten minutes and, once changed, plans every check by the new interval", () =>
    withReviewsWorld(async (world) => {
      addReview(world, "old", 5, "Muito bom");
      await turnReviewsOn(world);
      const first = world.clock.now;
      expect(world.reviews.status()).toMatchObject({ syncEveryMinutes: 10, nextSyncAt: iso(first + 10 * MINUTE) });
      expect(world.reviews.setInterval(30)).toMatchObject({ syncEveryMinutes: 30, nextSyncAt: iso(first + 30 * MINUTE) });
      world.clock.now = first + 30 * MINUTE - 1;
      expect(await world.reviews.tick()).toBe(false);
      world.clock.now = first + 30 * MINUTE;
      expect(await world.reviews.tick()).toBe(true);
      expect(world.reviews.status()).toMatchObject({ lastResult: "unchanged", nextSyncAt: iso(first + 60 * MINUTE) });
    }));

  it("a shorter interval is felt at once, the same one writes nothing, and a retry keeps its time", () =>
    withReviewsWorld(async (world) => {
      addReview(world, "old", 5, "Muito bom");
      await turnReviewsOn(world);
      const last = world.clock.now;
      world.reviews.setInterval(60);
      world.clock.now = last + 20 * MINUTE;
      expect(world.reviews.setInterval(5).nextSyncAt).toBe(iso(world.clock.now));
      const usage = { ...world.db.usage };
      expect(world.reviews.setInterval(5).nextSyncAt).toBe(iso(world.clock.now));
      expect(world.db.usage.rowsWritten).toBe(usage.rowsWritten);
      world.sim.business.failure = { status: 503, body: {} };
      expect(await world.reviews.check("alarm")).toBe("failed");
      const retry = world.reviews.status().nextSyncAt;
      expect(retry).toBe(iso(world.clock.now + 10 * MINUTE));
      expect(world.reviews.setInterval(1_440).nextSyncAt).toBe(retry);
      world.sim.business.failure = null;
      world.clock.now += 10 * MINUTE;
      expect(await world.reviews.check("alarm")).toBe("ok");
      expect(world.reviews.status().nextSyncAt).toBe(iso(world.clock.now + 1_440 * MINUTE));
    }));

  it("a check that waits for the owner (the access not granted by Google) keeps its time when the interval changes", () =>
    withReviewsWorld(async (world) => {
      addReview(world, "old", 5, "Muito bom");
      await turnReviewsOn(world);
      world.sim.business.failure = { status: 403, body: { error: { code: 403, status: "PERMISSION_DENIED" } } };
      world.clock.now += 10 * MINUTE;
      expect(await world.reviews.check("alarm")).toBe("failed");
      const status = world.reviews.status();
      expect(status.problem).not.toBeNull();
      expect(world.reviews.setInterval(5)).toMatchObject({ syncEveryMinutes: 5, nextSyncAt: status.nextSyncAt });
    }));

  it("the interval can be picked before the reviews are turned on, and a damaged one is read as the nearest allowed", () =>
    withReviewsWorld(async (world) => {
      expect(world.reviews.setInterval(20)).toMatchObject({ enabled: false, syncEveryMinutes: 20, nextSyncAt: null });
      addReview(world, "old", 5, "Muito bom");
      await turnReviewsOn(world);
      expect(world.reviews.status().nextSyncAt).toBe(iso(world.clock.now + 20 * MINUTE));
      world.db.run(`UPDATE zur_review_settings SET check_every_min = -3 WHERE id = 1`);
      expect(world.reviews.status().syncEveryMinutes).toBe(5);
    }));
});

describe("a review is triaged again only when its stars or its text changed", () => {
  it("only Google's time moved: the draft waiting for the owner stays, and no edit is recorded", () =>
    withReviewsWorld(async (world) => {
      addReview(world, "old", 5, "Muito bom");
      await turnReviewsOn(world);
      const reply = "Obrigado pela visita! Ficamos muito felizes com a sua avaliação.";
      world.answers.push(draftAnswer(reply), SECOND_OK);
      world.clock.now += 10 * MINUTE;
      addReview(world, "n1", 5, "Adorei o atendimento, todos muito gentis.");
      expect(await world.reviews.check("alarm")).toBe("ok");
      const before = reviewRow(world, "n1");
      expect(before).toMatchObject({ state: "proposed", draft: expect.stringContaining(reply) });
      const events = world.db.one<{ n: number }>(`SELECT count(*) AS n FROM zur_review_events`)?.n;
      const asked = world.requests.length;
      // The reviewer saved the same review again: a new time at Google, the same stars and text.
      world.clock.now += 10 * MINUTE;
      const touched = iso(world.clock.now);
      world.sim.business.edit(LOCATION, "n1", { updateTime: touched });
      const numberBefore = reviewsArea(world);
      expect(await world.reviews.check("alarm")).toBe("ok");
      const after = reviewRow(world, "n1");
      expect(after).toEqual({ ...before, updated_at: touched });
      // The time is part of the version the owner approves: the screens are told, to read the review again.
      expect(reviewsArea(world)).toBeGreaterThan(numberBefore);
      expect(world.reviews.status().lastResult).toBe("changed");
      expect(world.db.one<{ n: number }>(`SELECT count(*) AS n FROM zur_review_events`)?.n).toBe(events);
      // The model wasn't asked for another draft (no Neurons spent on the same text).
      expect(world.requests.length).toBe(asked);
      // And the check after it is quiet.
      const number = reviewsArea(world);
      world.clock.now += 10 * MINUTE;
      expect(await world.reviews.check("alarm")).toBe("ok");
      expect(reviewsArea(world)).toBe(number);
      expect(world.reviews.status().lastResult).toBe("unchanged");
    }));

  it("approved before the next check: the old version is refused with the draft kept, and the new one publishes", () =>
    withReviewsWorld(async (world) => {
      addReview(world, "old", 5, "Muito bom");
      await turnReviewsOn(world);
      world.answers.push(draftAnswer("Obrigado pela visita! Ficamos muito felizes com a sua avaliação."), SECOND_OK);
      world.clock.now += 10 * MINUTE;
      addReview(world, "n1", 5, "Adorei o atendimento, todos muito gentis.");
      expect(await world.reviews.check("alarm")).toBe("ok");
      const before = reviewRow(world, "n1");
      const seen = await world.reviews.item(before as never);
      const events = world.db.one<{ n: number }>(`SELECT count(*) AS n FROM zur_review_events WHERE action = 'changed'`)?.n;
      // The reviewer saves the same review again, and the owner approves what is on the screen before any check.
      world.clock.now += MINUTE;
      const touched = iso(world.clock.now);
      world.sim.business.edit(LOCATION, "n1", { updateTime: touched });
      const text = before?.draft ?? "";
      await expect(world.reviews.approve(seen.id, { text, version: seen.version }, "app")).rejects.toMatchObject({ code: "TARGET_CHANGED" });
      // Nothing went out, the draft and the proposal are where they were, and no edit was recorded.
      expect(world.sim.business.reviews.get(LOCATION)?.find((review) => review.reviewId === "n1")?.reviewReply).toBeUndefined();
      expect(reviewRow(world, "n1")).toEqual({ ...before, updated_at: touched });
      expect(world.db.one<{ n: number }>(`SELECT count(*) AS n FROM zur_review_events WHERE action = 'changed'`)?.n).toBe(events);
      // The screen reads the review again and the owner approves the version Google has now.
      const again = await world.reviews.item(reviewRow(world, "n1") as never);
      expect(again.version).not.toBe(seen.version);
      expect(await world.reviews.approve(again.id, { text, version: again.version }, "app")).toMatchObject({ state: "replied", reply: text });
      expect(world.sim.business.reviews.get(LOCATION)?.find((review) => review.reviewId === "n1")?.reviewReply?.comment).toBe(text);
    }));

  it("SEC-A6-01: at the approval too, an invisible mark slipped into the same text drops the draft and nothing is published", () =>
    withReviewsWorld(async (world) => {
      addReview(world, "old", 5, "Muito bom");
      await turnReviewsOn(world);
      world.answers.push(draftAnswer("Obrigado pela visita! Ficamos muito felizes com a sua avaliação."), SECOND_OK);
      world.clock.now += 10 * MINUTE;
      addReview(world, "n1", 5, "Adorei o atendimento, todos muito gentis.");
      expect(await world.reviews.check("alarm")).toBe("ok");
      const before = reviewRow(world, "n1");
      const seen = await world.reviews.item(before as never);
      world.clock.now += MINUTE;
      world.sim.business.edit(LOCATION, "n1", { updateTime: iso(world.clock.now), comment: "Adorei o\u202eatendimento, todos muito gentis." });
      await expect(world.reviews.approve(seen.id, { text: before?.draft ?? "", version: seen.version }, "app")).rejects.toMatchObject({ code: "TARGET_CHANGED" });
      expect(reviewRow(world, "n1")).toMatchObject({ state: "escalated", draft: null });
      expect(world.sim.business.reviews.get(LOCATION)?.find((review) => review.reviewId === "n1")?.reviewReply).toBeUndefined();
    }));

  it("SEC-A6-01: an edit that only slips an invisible mark into the same text is an edit: the draft goes and the team gets it", () =>
    withReviewsWorld(async (world) => {
      addReview(world, "old", 5, "Muito bom");
      await turnReviewsOn(world);
      world.answers.push(draftAnswer("Obrigado pela visita! Ficamos muito felizes com a sua avaliação."), SECOND_OK);
      world.clock.now += 10 * MINUTE;
      addReview(world, "n1", 5, "Adorei o atendimento, todos muito gentis.");
      expect(await world.reviews.check("alarm")).toBe("ok");
      const before = reviewRow(world, "n1");
      expect(before?.state).toBe("proposed");
      // A right-to-left override where a space was: the text Zuri keeps comes out the same.
      world.clock.now += 10 * MINUTE;
      world.sim.business.edit(LOCATION, "n1", { updateTime: iso(world.clock.now), comment: "Adorei o\u202eatendimento, todos muito gentis." });
      expect(await world.reviews.check("alarm")).toBe("ok");
      const after = reviewRow(world, "n1");
      expect(after?.comment).toBe(before?.comment);
      expect(after).toMatchObject({ state: "escalated", draft: null, needs_draft: 0 });
      expect(JSON.parse(after?.reasons ?? "[]")).toContain("suspicious");
    }));

  it("a real edit (the text, or the stars) still drops the draft and is triaged again", () =>
    withReviewsWorld(async (world) => {
      addReview(world, "old", 5, "Muito bom");
      await turnReviewsOn(world);
      world.answers.push(draftAnswer("Obrigado pela visita! Ficamos muito felizes com a sua avaliação."), SECOND_OK);
      world.clock.now += 10 * MINUTE;
      addReview(world, "n1", 5, "Adorei o atendimento, todos muito gentis.");
      expect(await world.reviews.check("alarm")).toBe("ok");
      expect(reviewRow(world, "n1")?.state).toBe("proposed");
      world.clock.now += 10 * MINUTE;
      world.sim.business.edit(LOCATION, "n1", { updateTime: iso(world.clock.now), starRating: "ONE", comment: "Voltei e fui mal atendido." });
      expect(await world.reviews.check("alarm")).toBe("ok");
      expect(reviewRow(world, "n1")).toMatchObject({ state: "escalated", rating: 1, comment: "Voltei e fui mal atendido.", draft: null });
      expect(world.db.one<{ n: number }>(`SELECT count(*) AS n FROM zur_review_events WHERE action = 'changed'`)?.n).toBe(1);
    }));
});
