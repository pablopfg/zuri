import { AGENT_INSTANCE_NAME, type AgendaEvent, type AgendaPage, type BookingPage, dayPlus, nationalHoliday } from "@zuri/shared";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ZuriAgent } from "../src/agent/zuri-agent.ts";
import { InternalState } from "../src/db/internal-state.ts";
import { type DevGoogle, devGoogle, googleNetwork } from "../src/google/dev-google.ts";
import { call, CSRF, errorBody, HUMAN_TOKEN, ORIGIN, TEST_EMAIL, TEST_PASSWORD, testEnv, signedCookies } from "./helpers.ts";

// E5f (plano agenda-vinculo-com-contatos.md): the Agenda's name field looks in the copy of Contacts,
// an appointment links to one contact by its resourceName, and homonyms never link on their own.

const IP = "192.0.2.193";
let cookie = "";
let google: DevGoogle;
const owner = () => testEnv.AGENT.get(testEnv.AGENT.idFromName(AGENT_INSTANCE_NAME));
const inOwner = <T>(fn: (agent: ZuriAgent) => T | Promise<T>) => runInDurableObject(owner(), (agent: ZuriAgent) => fn(agent));
const headers = (withCookie = true) => ({ ...CSRF, "content-type": "application/json", "cf-connecting-ip": IP, ...(withCookie ? { cookie } : {}) });
const api = (method: string, path: string, body?: unknown, withCookie = true) =>
  call(`${ORIGIN}/api${path}`, { method, headers: headers(withCookie), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

const WORK = "trabalho@exemplo.com.br";
const PATIENTS = "contactGroups/pacientes";

async function consent(path: string): Promise<void> {
  const begin = await api("POST", path);
  expect(begin.status).toBe(200);
  const params = new URL(((await begin.json()) as { url: string }).url).searchParams;
  const res = await api("POST", "/google/callback", { state: params.get("state") ?? "", code: `dev.${params.get("code_challenge") ?? ""}` });
  expect(res.status).toBe(200);
}

/** The calendar to write and the contacts of one label, copied. */
async function turnOn(): Promise<void> {
  await consent("/google/connect");
  expect((await api("PATCH", `/google/calendars/${encodeURIComponent(WORK)}`, { mode: "write" })).status).toBe(200);
  await consent("/google/contacts/connect");
  expect((await api("POST", "/google/contacts/sync")).status).toBe(200);
  expect((await api("PATCH", "/google/contacts/labels", { selected: [PATIENTS] })).status).toBe(200);
  await inOwner((agent) => agent.store.db.run(`UPDATE zur_contact_sync SET synced_now_at = synced_now_at - 60000`));
  expect((await api("POST", "/google/contacts/sync")).status).toBe(200);
}

const search = async (q: string) => (await (await api("GET", `/contacts?for=booking&q=${encodeURIComponent(q)}`)).json()) as BookingPage;

/** A working day a month ahead: an appointment is bound by the office's hours. */
function workDay(): string {
  let day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(Date.now() + 30 * 86_400_000));
  while ([0, 6].includes(new Date(`${day}T12:00:00Z`).getUTCDay()) || nationalHoliday(day) !== null) day = dayPlus(day, 1);
  return day;
}

const booking = (title: string, extra: Record<string, unknown> = {}, hour = 14) => {
  const day = workDay();
  const at = (h: number) => `${day}T${String(h).padStart(2, "0")}:00`;
  return { calendarId: WORK, title, allDay: false, start: at(hour), end: at(hour + 1), description: "Consulta | Consultório", ...extra };
};
const lastPrivate = () => (JSON.parse(google.seen.filter((r) => r.method !== "GET" && r.url.includes("/events")).at(-1)?.body ?? "{}") as { extendedProperties?: { private?: Record<string, string | null> } }).extendedProperties?.private;

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
  google.people.groups.push({ resourceName: PATIENTS, name: "Pacientes", groupType: "USER_CONTACT_GROUP", memberCount: 5 });
  const member = [{ contactGroupMembership: { contactGroupResourceName: PATIENTS } }];
  const person = (id: string, name: string, extra: Record<string, unknown>) => google.people.add({ resourceName: `people/${id}`, names: [{ displayName: name }], memberships: member, ...extra });
  person("c1", "Carla Mendes", { phoneNumbers: [{ value: "(41) 99999-0001" }], emailAddresses: [{ value: "carla@exemplo.com.br" }], birthdays: [{ date: { year: 1995, month: 9, day: 2 } }] });
  person("c2", "Marcos Vieira Lopes", { phoneNumbers: [{ value: "(41) 97777-0112" }], birthdays: [{ date: { year: 1979, month: 2, day: 11 } }] });
  person("c3", "Marcos Vieira Lopes", { phoneNumbers: [{ value: "(41) 96666-0113" }] });
  person("c4", "Conceição Martins", { emailAddresses: [{ value: "conceicao@exemplo.com.br" }] });
  // Nobody to call or write to: never offered.
  person("c5", "Carlos Mendonça", {});
  await inOwner((agent) => {
    agent.store.google.network = googleNetwork(google, { fetch: () => Promise.reject(new Error("no network in tests")) });
    agent.store.db.run(`UPDATE zur_sessions SET confirmed_at = ?`, Date.now());
  });
});

afterEach(async () => {
  await inOwner((agent) => {
    const { db } = agent.store;
    const state = new InternalState(db);
    state.delete("lockdown_until");
    state.delete("google_oauth_pending");
    agent.store.contacts.disable();
    db.run(`UPDATE zur_contact_sync SET sync_every_min = 5`);
    for (const table of ["zur_google_calendars", "zur_google_account", "zur_auth_events", "zur_notices", "zur_agenda_record"]) db.run(`DELETE FROM ${table}`);
  });
});

describe("E5f: the people of the Agenda's name field", () => {
  it("finds by the start of each word, without accents, only who has a phone or an e-mail, and counts homonyms", async () => {
    // Contacts off: the name is only text.
    expect(await search("carla")).toEqual({ people: [], same: 0 });
    await turnOn();
    expect((await search("carla m")).people.map((p) => p.name)).toEqual(["Carla Mendes"]);
    // "Carlos Mendonça" has neither phone nor e-mail; "arla" starts no word.
    expect((await search("arla")).people).toEqual([]);
    expect((await search("conceicao")).people.map((p) => p.name)).toEqual(["Conceição Martins"]);
    // A surname typed first: no name starts so, and then every word of the names counts.
    expect((await search("mendes")).people.map((p) => p.name)).toEqual(["Carla Mendes"]);
    const carla = (await search("Carla Mendes")).people[0];
    expect(carla).toMatchObject({ resource: "people/c1", phone: "(41) 99999-0001", email: "carla@exemplo.com.br", birthday: "1995-09-02", lastVisit: "" });
    expect((await search("Carla Mendes")).same).toBe(1);
    const twins = await search("marcos vieira lopes");
    expect([twins.people.length, twins.same]).toEqual([2, 2]);
    // One letter is too little to list anybody.
    expect(await search("c")).toEqual({ people: [], same: 0 });
    expect((await api("GET", "/contacts?for=booking&q=ca", undefined, false)).status).toBe(401);
  });

  it("puts who already has an appointment on record first, the latest first, at most six", async () => {
    await turnOn();
    for (let i = 0; i < 6; i++) google.people.add({ resourceName: `people/m${i}`, names: [{ displayName: `Marina ${i}` }], phoneNumbers: [{ value: `(41) 9999${i}-0000` }], memberships: [{ contactGroupMembership: { contactGroupResourceName: PATIENTS } }] });
    google.people.add({ resourceName: "people/m9", names: [{ displayName: "Mariana Zago" }], phoneNumbers: [{ value: "(41) 98888-0009" }], memberships: [{ contactGroupMembership: { contactGroupResourceName: PATIENTS } }] });
    await inOwner((agent) => agent.store.db.run(`UPDATE zur_contact_sync SET synced_now_at = synced_now_at - 60000`));
    expect((await api("POST", "/google/contacts/sync")).status).toBe(200);
    const yesterday = dayPlus(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date()), -1);
    await inOwner((agent) =>
      agent.store.db.run(`INSERT INTO zur_agenda_record (day, calendar_id, event_id, etag, data) VALUES (?, ?, 'e1', '"1"', ?)`, yesterday, WORK, JSON.stringify({ title: "Mariana Zago", contact: "people/m9", colorId: "" })),
    );
    const page = await search("mari");
    expect(page.people).toHaveLength(6);
    expect(page.people[0]).toMatchObject({ name: "Mariana Zago", lastVisit: yesterday });
  });
});

describe("E5f: an appointment linked to a contact", () => {
  it("keeps the link in the private properties, never the contact's phone or e-mail, and shows the copy's id", async () => {
    await turnOn();
    const made = await api("POST", "/google/events", booking("Carla Mendes", { contact: "people/c1", country: "BR", phone: "41999990001", email: "carla@exemplo.com.br", payment: "paid" }));
    expect(made.status, JSON.stringify(await made.clone().json())).toBe(201);
    expect(lastPrivate()).toEqual({ zuriContact: "people/c1", zuriPayment: "paid" });
    const event = ((await made.json()) as { event: AgendaEvent }).event;
    expect(event.contact).toBe("people/c1");
    const day = workDay();
    const page = (await (await api("GET", `/google/events?from=${day}&to=${day}`)).json()) as AgendaPage;
    const shown = page.events.find((each) => each.id === event.id);
    expect(shown?.contactId).toMatch(/^[0-9a-f-]{36}$/);
    expect(((await (await api("GET", `/contacts/${shown?.contactId}`)).json()) as { contact: { name: string } }).contact.name).toBe("Carla Mendes");

    // Another name with the link kept is refused; unlinking with the new name passes.
    const renamed = await api("PATCH", "/google/events", { calendarId: WORK, eventId: event.id, etag: event.etag, title: "Carla Souza" });
    expect(renamed.status).toBe(400);
    expect((await errorBody(renamed)).message).toMatch(/contato vinculado/);
    const unlinked = await api("PATCH", "/google/events", { calendarId: WORK, eventId: event.id, etag: event.etag, title: "Carla Souza", contact: "" });
    expect(unlinked.status).toBe(200);
    expect(lastPrivate()).toEqual({ zuriContact: null });
  });

  it("refuses a contact out of the copy, a name that is not the contact's, and a value out of shape", async () => {
    await turnOn();
    const gone = await api("POST", "/google/events", booking("Carla Mendes", { contact: "people/c99" }));
    expect(gone.status).toBe(400);
    expect((await errorBody(gone)).message).toMatch(/não está mais em Contatos/);
    expect((await api("POST", "/google/events", booking("Ana Souza", { contact: "people/c1" }))).status).toBe(400);
    // The name folds as the search does: accents and case never refuse the right contact.
    expect((await api("POST", "/google/events", booking("conceicao martins", { contact: "people/c4" }))).status).toBe(201);
    for (const contact of ["c1", "people/", "people/c1/x", "people/<b>", `people/${"a".repeat(41)}`, 7]) {
      expect((await api("POST", "/google/events", booking("Carla Mendes", { contact }, 16))).status, String(contact)).toBe(400);
    }
    // 40 characters is the longest id: well formed, and then refused only for not being in the copy.
    expect((await errorBody(await api("POST", "/google/events", booking("Carla Mendes", { contact: `people/${"a".repeat(40)}` }, 16)))).message).toMatch(/não está mais em Contatos/);
  });

  it("asks for a phone when the name is shared by two contacts and the appointment links to none", async () => {
    await turnOn();
    const bare = await api("POST", "/google/events", booking("Marcos Vieira Lopes"));
    expect(bare.status).toBe(400);
    expect((await errorBody(bare)).message).toMatch(/mais de um contato com este nome/);
    // "É outra pessoa": the phone tells the people apart.
    const other = await api("POST", "/google/events", booking("Marcos Vieira Lopes", { country: "BR", phone: "41955550000" }));
    expect(other.status).toBe(201);
    const event = ((await other.json()) as { event: AgendaEvent }).event;
    // The phone taken off later is refused too; a change of the time alone is not checked again.
    expect((await api("PATCH", "/google/events", { calendarId: WORK, eventId: event.id, etag: event.etag, country: "BR", phone: "" })).status).toBe(400);
    const day = workDay();
    expect((await api("PATCH", "/google/events", { calendarId: WORK, eventId: event.id, etag: event.etag, start: `${day}T16:00`, end: `${day}T17:00` })).status).toBe(200);
    // Linked to one of them, no phone of the event's own is needed.
    expect((await api("POST", "/google/events", booking("Marcos Vieira Lopes", { contact: "people/c2" }, 10))).status).toBe(201);
    // One contact of the name links only by the owner's pick: without `contact`, the appointment stays unlinked.
    const single = await api("POST", "/google/events", booking("Carla Mendes", {}, 11));
    expect(single.status).toBe(201);
    expect(((await single.json()) as { event: AgendaEvent }).event.contact).toBeUndefined();
    // A plain event of the same name is no appointment: no phone asked.
    expect((await api("POST", "/google/events", booking("Marcos Vieira Lopes", { description: "" }, 9))).status).toBe(201);
  });

  it("drops a link out of shape that came from Google (a shared calendar)", async () => {
    await turnOn();
    const day = workDay();
    const list = google.events.get(WORK) ?? [];
    for (const [id, contact] of [
      ["h1", "javascript:alert(1)"],
      ["h2", "people/c1"],
    ] as const)
      list.push({ id, etag: `"${id}"`, summary: "Carla Mendes", start: { dateTime: `${day}T08:00:00-03:00` }, end: { dateTime: `${day}T09:00:00-03:00` }, extendedProperties: { private: { zuriContact: contact } } });
    google.events.set(WORK, list);
    const page = (await (await api("GET", `/google/events?from=${day}&to=${day}`)).json()) as AgendaPage;
    expect(page.events.find((each) => each.id === "h1")?.contact).toBeUndefined();
    expect(page.events.find((each) => each.id === "h2")).toMatchObject({ contact: "people/c1" });
  });
});

describe("E5f: what the QA review and the audit found", () => {
  const member = [{ contactGroupMembership: { contactGroupResourceName: PATIENTS } }];
  const many = (count: number) => {
    for (let i = 0; i < count; i++) google.people.add({ resourceName: `people/a${i}`, names: [{ displayName: `Ana ${String(i).padStart(3, "0")}` }], phoneNumbers: [{ value: `(41) 9${String(i).padStart(4, "0")}-0000` }], memberships: member });
  };
  const resync = async () => {
    await inOwner((agent) => agent.store.db.run(`UPDATE zur_contact_sync SET synced_now_at = synced_now_at - 60000`));
    expect((await api("POST", "/google/contacts/sync")).status).toBe(200);
  };
  const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  const visit = (day: string, title: string, contact: string, id: string) =>
    inOwner((agent) => agent.store.db.run(`INSERT INTO zur_agenda_record (day, calendar_id, event_id, etag, data) VALUES (?, ?, ?, '"1"', ?)`, day, WORK, id, JSON.stringify({ title, contact, colorId: "" })));

  it("SEC-E5f-01: the search holds 100 and 150 people of the same start, and the listing 150 links", async () => {
    many(150);
    await turnOn();
    for (const [i, day] of [[0, -3], [1, -1]] as const) await visit(dayPlus(today(), day), `Ana 00${i}`, `people/a${i}`, `v${i}`);
    // "ana 0" finds 100 candidates and "ana" 150: past the 90 of one batch and the old ceiling of 98.
    for (const q of ["ana 0", "ana", "an"]) {
      const res = await api("GET", `/contacts?for=booking&q=${encodeURIComponent(q)}`);
      expect(res.status, q).toBe(200);
      const page = (await res.json()) as BookingPage;
      expect(page.people, q).toHaveLength(6);
      // The latest visit first, then the other, then by name.
      expect(page.people.slice(0, 3).map((p) => p.name), q).toEqual(["Ana 001", "Ana 000", "Ana 002"]);
    }
    const day = workDay();
    const list = google.events.get(WORK) ?? [];
    for (let i = 0; i < 150; i++)
      list.push({ id: `k${i}`, etag: `"k${i}"`, summary: `Ana ${String(i).padStart(3, "0")}`, start: { dateTime: `${day}T08:00:00-03:00` }, end: { dateTime: `${day}T09:00:00-03:00` }, extendedProperties: { private: { zuriContact: `people/a${i}` } } });
    google.events.set(WORK, list);
    const res = await api("GET", `/google/events?from=${day}&to=${day}`);
    expect(res.status).toBe(200);
    const page = (await res.json()) as AgendaPage;
    expect(page.events.filter((each) => each.contactId)).toHaveLength(150);
  });

  it("SEC-E5f-03: long words, many words and wildcards never break the search", async () => {
    await turnOn();
    for (const length of [46, 47, 48, 49, 80]) {
      const res = await api("GET", `/contacts?for=booking&q=${"x".repeat(length)}`);
      expect(res.status, String(length)).toBe(200);
    }
    for (const q of ["%".repeat(60), "_".repeat(60), Array.from({ length: 20 }, (_, i) => `p${i}`).join(" "), "% _ carla"]) {
      const res = await api("GET", `/contacts?for=booking&q=${encodeURIComponent(q)}`);
      expect(res.status, q).toBe(200);
      expect(((await res.json()) as BookingPage).people, q).toEqual([]);
    }
  });

  it("SEC-E5f-04: a linked appointment never keeps a phone or e-mail of its own, whatever the change sends", async () => {
    await turnOn();
    const made = ((await (await api("POST", "/google/events", booking("Carla Mendes", { contact: "people/c1" }))).json()) as { event: AgendaEvent }).event;
    const res = await api("PATCH", "/google/events", { calendarId: WORK, eventId: made.id, etag: made.etag, country: "BR", phone: "41955550000", email: "x@exemplo.com.br" });
    expect(res.status).toBe(200);
    const sent = lastPrivate() ?? {};
    expect([sent.zuriPhone, sent.zuriEmail, sent.zuriCountry]).toEqual([undefined, undefined, undefined]);
  });

  it("SEC-E5f-04: a link whose contact left the copy, or with Contacts off, counts as none and a new name takes it off", async () => {
    await turnOn();
    const first = ((await (await api("POST", "/google/events", booking("Carla Mendes", { contact: "people/c1" }))).json()) as { event: AgendaEvent }).event;
    const second = ((await (await api("POST", "/google/events", booking("Conceição Martins", { contact: "people/c4" }, 16))).json()) as { event: AgendaEvent }).event;
    // The contact leaves the copy.
    google.people.remove("people/c1");
    await resync();
    const renamed = await api("PATCH", "/google/events", { calendarId: WORK, eventId: first.id, etag: first.etag, title: "Carla Mendes Souza" });
    expect(renamed.status, JSON.stringify(await renamed.clone().json())).toBe(200);
    expect(lastPrivate()).toEqual({ zuriContact: null });
    // Contacts turned off.
    await inOwner((agent) => agent.store.contacts.disable());
    expect((await api("PATCH", "/google/events", { calendarId: WORK, eventId: second.id, etag: second.etag, title: "Conceição Souza" })).status).toBe(200);
    expect(lastPrivate()).toEqual({ zuriContact: null });
  });

  it("SEC-E5f-05: a link whose contact is now another name shows no contact's id and gives no last visit", async () => {
    await turnOn();
    const day = workDay();
    const list = google.events.get(WORK) ?? [];
    list.push({ id: "n1", etag: '"n1"', summary: "Ana Souza", start: { dateTime: `${day}T08:00:00-03:00` }, end: { dateTime: `${day}T09:00:00-03:00` }, extendedProperties: { private: { zuriContact: "people/c1" } } });
    google.events.set(WORK, list);
    const page = (await (await api("GET", `/google/events?from=${day}&to=${day}`)).json()) as AgendaPage;
    expect(page.events.find((each) => each.id === "n1")).toMatchObject({ contact: "people/c1" });
    expect(page.events.find((each) => each.id === "n1")?.contactId).toBeUndefined();
    await visit(dayPlus(today(), -1), "Ana Souza", "people/c1", "n1");
    expect((await search("carla mendes")).people[0]?.lastVisit).toBe("");
  });

  it("QA-E5f-06: an event without a type takes no link, and one that stops being an appointment loses it", async () => {
    await turnOn();
    const plain = await api("POST", "/google/events", booking("Carla Mendes", { description: "", contact: "people/c1" }));
    expect(plain.status).toBe(201);
    expect(lastPrivate()?.zuriContact).toBeUndefined();
    const made = ((await (await api("POST", "/google/events", booking("Carla Mendes", { contact: "people/c1" }, 16))).json()) as { event: AgendaEvent }).event;
    expect((await api("PATCH", "/google/events", { calendarId: WORK, eventId: made.id, etag: made.etag, description: "" })).status).toBe(200);
    expect(lastPrivate()).toMatchObject({ zuriContact: null });
  });

  it("QA-E5f-07: a plain event of a shared name that becomes an appointment asks for the phone", async () => {
    await turnOn();
    const plain = ((await (await api("POST", "/google/events", booking("Marcos Vieira Lopes", { description: "" }))).json()) as { event: AgendaEvent }).event;
    const res = await api("PATCH", "/google/events", { calendarId: WORK, eventId: plain.id, etag: plain.etag, description: "Consulta | Consultório" });
    expect(res.status).toBe(400);
    expect((await errorBody(res)).message).toMatch(/mais de um contato com este nome/);
  });

  it("QA-E5f-08: the very name typed comes first, even past six with visits", async () => {
    many(8);
    google.people.add({ resourceName: "people/ana", names: [{ displayName: "Ana" }], phoneNumbers: [{ value: "(41) 98888-0000" }], memberships: member });
    await turnOn();
    for (let i = 0; i < 7; i++) await visit(dayPlus(today(), -1 - i), `Ana 00${i}`, `people/a${i}`, `w${i}`);
    const page = await search("ana");
    expect(page.people[0]?.name).toBe("Ana");
    expect(page.same).toBe(1);
  });

  it("refuses a name that is not the linked contact's with its own message", async () => {
    await turnOn();
    const res = await api("POST", "/google/events", booking("Ana Souza", { contact: "people/c1" }));
    expect(res.status).toBe(400);
    expect((await errorBody(res)).message).toMatch(/precisa ser o do contato vinculado/);
  });
});
