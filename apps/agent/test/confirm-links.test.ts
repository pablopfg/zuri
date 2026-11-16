import { AGENT_INSTANCE_NAME, type Clinic, SECURITY_ALERT_EVENTS, CONFIRM_LINK_LIMITS, type ConfirmLinkMade, type ConfirmView, EVENT_STATUS_COLOR } from "@zuri/shared";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ZuriAgent } from "../src/agent/zuri-agent.ts";
import { InternalState } from "../src/db/internal-state.ts";
import { ConfirmLinks, firstName } from "../src/google/confirm-links.ts";
import { type DevEvent, type DevGoogle, devGoogle, googleNetwork } from "../src/google/dev-google.ts";
import { call, CSRF, fakeAssets, HUMAN_TOKEN, ORIGIN, signedCookies, TEST_EMAIL, TEST_PASSWORD, testEnv } from "./helpers.ts";

// E7a (plano link-de-confirmacao.md): the patient's confirmation link, /c/<token>. One token per
// appointment, found by its hash; opening shows, only a tap changes the color at Google.

const IP = "192.0.2.195";
let cookie = "";
let google: DevGoogle;
// Every test from its own network: the limits are per network and live in the object's memory.
let net = 0;
let patientIp = "";
const owner = () => testEnv.AGENT.get(testEnv.AGENT.idFromName(AGENT_INSTANCE_NAME));
const inOwner = <T>(fn: (agent: ZuriAgent) => T | Promise<T>) => runInDurableObject(owner(), (agent: ZuriAgent) => fn(agent));
const headers = (withCookie = true, ip = IP) => ({ ...CSRF, "content-type": "application/json", "cf-connecting-ip": ip, ...(withCookie ? { cookie } : {}) });
const api = (method: string, path: string, body?: unknown) => call(`${ORIGIN}/api${path}`, { method, headers: headers(), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
/** The patient: no cookie, a network of the test's own. */
const patient = (path: "view" | "answer", body: unknown, ip = patientIp) => call(`${ORIGIN}/api/c/${path}`, { method: "POST", headers: headers(false, ip), body: JSON.stringify(body) });

const WORK = "trabalho@exemplo.com.br";
const CLINIC: Clinic = { name: "Consultório Exemplo", whatsapp: "4133330000", address: "Rua das Flores, 120", city: "Curitiba, PR" };
const HOUR = 3_600_000;
let n = 0;

/** An appointment straight at Google, starting `inMs` from now. */
function seed(inMs: number, extra: Partial<DevEvent> = {}): DevEvent {
  const start = new Date(Math.floor((Date.now() + inMs) / 60_000) * 60_000);
  const event: DevEvent = {
    id: `cf${n++}`,
    etag: `"e${n}"`,
    summary: "Dra. Beatriz Novaes Lima",
    description: "Consulta | Consultório\nObservação: alergia a dipirona",
    start: { dateTime: start.toISOString() },
    end: { dateTime: new Date(start.getTime() + HOUR).toISOString() },
    extendedProperties: { private: { zuriPhone: "41999990000", zuriEmail: "paciente@exemplo.com.br" } },
    ...extra,
  };
  const list = google.events.get(WORK) ?? [];
  list.push(event);
  google.events.set(WORK, list);
  return event;
}
const atGoogle = (id: string) => google.events.get(WORK)?.find((event) => event.id === id);

async function linkOf(event: DevEvent): Promise<{ url: string; token: string; made: ConfirmLinkMade }> {
  const res = await api("POST", "/google/events/link", { calendarId: WORK, eventId: event.id });
  expect(res.status, await res.clone().text()).toBe(200);
  const made = (await res.json()) as ConfirmLinkMade;
  return { url: made.url, token: made.url.split("/c/")[1] ?? "", made };
}

beforeAll(async () => {
  const res = await call(`${ORIGIN}/api/auth/login`, { method: "POST", headers: headers(false), body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD, turnstileToken: HUMAN_TOKEN }) });
  expect(res.status).toBe(200);
  cookie = signedCookies(res);
});

beforeEach(async () => {
  net += 1;
  patientIp = `198.51.${net}.7`;
  google = devGoogle({ clientId: testEnv.GOOGLE_CLIENT_ID, clientSecret: testEnv.GOOGLE_CLIENT_SECRET });
  await inOwner((agent) => {
    agent.store.google.network = googleNetwork(google, { fetch: () => Promise.reject(new Error("no network in tests")) });
    agent.store.db.run(`UPDATE zur_sessions SET confirmed_at = ?`, Date.now());
  });
  expect((await api("PATCH", "/settings", { clinic: CLINIC })).status).toBe(200);
  const begin = await api("POST", "/google/connect");
  const params = new URL(((await begin.json()) as { url: string }).url).searchParams;
  expect((await api("POST", "/google/callback", { state: params.get("state") ?? "", code: `dev.${params.get("code_challenge") ?? ""}` })).status).toBe(200);
  expect((await api("PATCH", `/google/calendars/${encodeURIComponent(WORK)}`, { mode: "write" })).status).toBe(200);
});

afterEach(() =>
  inOwner((agent) => {
    const { db } = agent.store;
    new InternalState(db).delete("google_oauth_pending");
    for (const table of ["zur_google_calendars", "zur_google_account", "zur_appointment_links", "zur_notices", "zur_auth_events"]) db.run(`DELETE FROM ${table}`);
    db.run(`DELETE FROM zur_settings WHERE key = 'clinic'`);
  }),
);

describe("E7a: the owner's link", () => {
  it("makes one token per appointment, 22 base64url characters, the same address every time, and keeps only its hash and a sealed copy", async () => {
    const event = seed(30 * 24 * HOUR);
    const first = await linkOf(event);
    expect(first.url).toMatch(/^https:\/\/zuri\.exemplo\.com\.br\/c\/[A-Za-z0-9_-]{22}$/);
    expect(first.made).toMatchObject({ made: true, answer: "none", answeredAt: "" });
    expect((await linkOf(event)).url).toBe(first.url);
    // Two at once: one row, one address.
    const twin = seed(31 * 24 * HOUR);
    const both = await Promise.all([linkOf(twin), linkOf(twin)]);
    expect(both[0].url).toBe(both[1].url);
    expect(both[0].url).not.toBe(first.url);
    const rows = await inOwner((agent) => agent.store.db.all<Record<string, unknown>>(`SELECT * FROM zur_appointment_links`));
    expect(rows).toHaveLength(2);
    expect(JSON.stringify(rows)).not.toContain(first.token);
    expect(rows.find((row) => row.event_id === event.id)?.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("says the state without making a link, and refuses a plain event, a cancelled one and one that already expired", async () => {
    const event = seed(30 * 24 * HOUR);
    const status = await api("GET", `/google/events/link?calendarId=${encodeURIComponent(WORK)}&eventId=${event.id}`);
    expect(await status.json()).toEqual({ made: false, answer: "none", answeredAt: "", answerStart: "" });
    expect(await inOwner((agent) => agent.store.db.all(`SELECT id FROM zur_appointment_links`))).toEqual([]);
    const plain = seed(30 * 24 * HOUR, { description: "Reunião do condomínio" });
    expect((await api("POST", "/google/events/link", { calendarId: WORK, eventId: plain.id })).status).toBe(400);
    const cancelled = seed(30 * 24 * HOUR, { colorId: EVENT_STATUS_COLOR.cancelled });
    expect((await api("POST", "/google/events/link", { calendarId: WORK, eventId: cancelled.id })).status).toBe(409);
    const soon = seed(30 * 60_000);
    expect((await api("POST", "/google/events/link", { calendarId: WORK, eventId: soon.id })).status).toBe(409);
    expect((await api("GET", "/google/events/link?calendarId=x")).status).toBe(400);
  });

  it("is the owner's only: without a session the link and the state are refused", async () => {
    const event = seed(30 * 24 * HOUR);
    const res = await call(`${ORIGIN}/api/google/events/link`, { method: "POST", headers: headers(false), body: JSON.stringify({ calendarId: WORK, eventId: event.id }) });
    expect(res.status).toBe(401);
  });
});

describe("E7a: the patient's page", () => {
  it("shows the first name, the day, the type and the office, never the phone, the e-mail, the full name or the note", async () => {
    const event = seed(30 * 24 * HOUR);
    const { token } = await linkOf(event);
    const res = await patient("view", { token });
    expect(res.status).toBe(200);
    const view = (await res.json()) as ConfirmView;
    expect(view).toMatchObject({ state: "open", clinic: "Consultório Exemplo", first: "Beatriz", type: "Consulta", online: false, place: "Rua das Flores, 120, Curitiba, PR", canCancel: true, team: "4133330000", zone: "America/Sao_Paulo" });
    expect(view.start).toBe(event.start.dateTime);
    const text = JSON.stringify(view);
    for (const secret of ["Novaes", "41999990000", "paciente@", "dipirona", event.id, WORK]) expect(text).not.toContain(secret);
    // Opening changed nothing at Google.
    expect(atGoogle(event.id)?.colorId).toBeUndefined();
    expect(google.seen.filter((r) => r.method === "PATCH")).toHaveLength(0);
  });

  it("an online appointment has no address", async () => {
    const { token } = await linkOf(seed(30 * 24 * HOUR, { description: "Retorno | Online" }));
    expect(await (await patient("view", { token })).json()).toMatchObject({ type: "Retorno", online: true, place: "" });
  });

  it("confirming turns the event Confirmado at Google, reaches the bell, and the same tap again changes nothing", async () => {
    const event = seed(30 * 24 * HOUR);
    const { token } = await linkOf(event);
    const res = await patient("answer", { token, action: "confirm" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as ConfirmView).state).toBe("confirmed");
    expect(atGoogle(event.id)?.colorId).toBe(EVENT_STATUS_COLOR.confirmed);
    const patches = google.seen.filter((r) => r.method === "PATCH");
    expect(patches).toHaveLength(1);
    expect(JSON.parse(patches[0]?.body ?? "{}")).toEqual({ colorId: EVENT_STATUS_COLOR.confirmed });
    const again = await patient("answer", { token, action: "confirm" });
    expect(((await again.json()) as ConfirmView).state).toBe("confirmed");
    expect(google.seen.filter((r) => r.method === "PATCH")).toHaveLength(1);
    const notices = await inOwner((agent) => agent.store.db.all<{ kind: string; params: string }>(`SELECT kind, params FROM zur_notices WHERE kind LIKE 'agenda.%'`));
    expect(notices.map((row) => row.kind)).toEqual(["agenda.confirmed"]);
    expect(JSON.parse(notices[0]?.params ?? "{}").name).toBe("Dra. Beatriz Novaes Lima");
    const status = (await (await api("GET", `/google/events/link?calendarId=${encodeURIComponent(WORK)}&eventId=${event.id}`)).json()) as { answer: string; answerStart: string };
    expect(status).toMatchObject({ answer: "confirmed", answerStart: new Date(event.start.dateTime ?? "").toISOString() });
    expect((await (await patient("view", { token })).json()) as ConfirmView).toMatchObject({ state: "confirmed", canCancel: true });
  });

  it("cancelling, even after confirming, turns it Cancelado, never deletes it, rings, and the link stops at once: opened again it has expired", async () => {
    const event = seed(30 * 24 * HOUR);
    const { token } = await linkOf(event);
    expect(((await (await patient("answer", { token, action: "confirm" })).json()) as ConfirmView).state).toBe("confirmed");
    const res = await patient("answer", { token, action: "cancel" });
    expect(((await res.json()) as ConfirmView).state).toBe("cancelled");
    expect(atGoogle(event.id)?.colorId).toBe(EVENT_STATUS_COLOR.cancelled);
    expect(google.seen.some((r) => r.method === "DELETE")).toBe(false);
    const notices = await inOwner((agent) => agent.store.db.all<{ kind: string }>(`SELECT kind FROM zur_notices WHERE kind LIKE 'agenda.%' ORDER BY created_at, rowid`));
    expect(notices.map((row) => row.kind)).toEqual(["agenda.confirmed", "agenda.cancelled"]);
    const again = (await (await patient("view", { token })).json()) as ConfirmView;
    expect(again).toMatchObject({ state: "expired", first: "", start: "", type: "" });
    // Not even when the owner reopens it: a cancellation is for good.
    const kept = atGoogle(event.id);
    if (kept) delete kept.colorId;
    expect(((await (await patient("view", { token })).json()) as ConfirmView).state).toBe("expired");
    expect(((await (await patient("answer", { token, action: "confirm" })).json()) as ConfirmView).state).toBe("expired");
    expect(atGoogle(event.id)?.colorId).toBeUndefined();
    expect((await api("POST", "/google/events/link", { calendarId: WORK, eventId: event.id })).status).toBe(409);
  });

  it("cancelling at the Agenda ends the link too", async () => {
    const event = seed(30 * 24 * HOUR);
    const { token } = await linkOf(event);
    const kept = atGoogle(event.id);
    if (kept) kept.colorId = EVENT_STATUS_COLOR.cancelled;
    expect(((await (await patient("view", { token })).json()) as ConfirmView).state).toBe("expired");
    const revoked = await inOwner((agent) => agent.store.db.one<{ revoked_at: number | null }>(`SELECT revoked_at FROM zur_appointment_links`)?.revoked_at);
    expect(revoked).not.toBeNull();
  });

  it("cancels up to 12 hours before; past it the server refuses, though confirming still works", async () => {
    const event = seed(6 * HOUR);
    const { token } = await linkOf(event);
    const view = (await (await patient("view", { token })).json()) as ConfirmView;
    expect(view.canCancel).toBe(false);
    const late = await patient("answer", { token, action: "cancel" });
    expect(late.status).toBe(409);
    expect(atGoogle(event.id)?.colorId).toBeUndefined();
    expect((await patient("answer", { token, action: "confirm" })).status).toBe(200);
  });

  it("the deadline is whichever comes first, 12 hours before or 23:59 of the day before, in the owner's zone (not the device's), on 23- and 25-hour days too", async () => {
    const until = (start: string) => inOwner((agent) => new Date(agent.store.confirmLinks.cancelUntil({ start })).toISOString());
    // São Paulo (the worker runs in UTC). At 09:00, 12 hours before (21:00) comes first; at 20:00, 23:59 of the day before.
    expect(await until("2026-11-19T12:00:00.000Z")).toBe("2026-11-19T00:00:00.000Z");
    expect(await until("2026-11-19T23:00:00.000Z")).toBe("2026-11-19T02:59:00.000Z");
    // 12 hours before 11:59 is 23:59 of the day before: n−1, n and n+1 minute around where the two meet.
    expect(await until("2026-11-19T14:58:00.000Z")).toBe("2026-11-19T02:58:00.000Z");
    expect(await until("2026-11-19T14:59:00.000Z")).toBe("2026-11-19T02:59:00.000Z");
    expect(await until("2026-11-19T15:00:00.000Z")).toBe("2026-11-19T02:59:00.000Z");
    // A zone with summer time: the day after the clocks go back (25 h) and forward (23 h), 20:00 local.
    expect((await api("PATCH", "/settings", { timeZone: "America/New_York" })).status).toBe(200);
    try {
      // 2 November 2026, 20:00 EST; the day before had 25 hours, its 23:59 is EST.
      expect(await until("2026-11-03T01:00:00.000Z")).toBe("2026-11-02T04:59:00.000Z");
      // On the 25-hour day itself (1 November, 20:00 EST): its midnight was still EDT.
      expect(await until("2026-11-02T01:00:00.000Z")).toBe("2026-11-01T03:59:00.000Z");
      // 9 March 2026, 20:00 EDT; the day before had 23 hours, its 23:59 is EDT.
      expect(await until("2026-03-10T00:00:00.000Z")).toBe("2026-03-09T03:59:00.000Z");
    } finally {
      expect((await api("PATCH", "/settings", { timeZone: "America/Sao_Paulo" })).status).toBe(200);
    }
  });

  it("expires an hour before the start: a minute before it still opens, a minute after it has expired", async () => {
    for (const [minutes, state] of [
      [61, "open"],
      [59, "expired"],
    ] as const) {
      const event = seed(30 * 24 * HOUR);
      const { token } = await linkOf(event);
      const start = new Date(Date.now() + minutes * 60_000);
      const kept = atGoogle(event.id);
      if (kept) Object.assign(kept, { start: { dateTime: start.toISOString() }, end: { dateTime: new Date(start.getTime() + HOUR).toISOString() } });
      expect(((await (await patient("view", { token })).json()) as ConfirmView).state, String(minutes)).toBe(state);
      if (state === "expired") expect(((await (await patient("answer", { token, action: "confirm" })).json()) as ConfirmView).state).toBe("expired");
    }
    expect(google.seen.filter((r) => r.method === "PATCH")).toHaveLength(0);
  });

  it("a moved appointment keeps the link, shows the new time and asks again, also when moved at Google with its color kept", async () => {
    for (const color of [EVENT_STATUS_COLOR.rescheduled, EVENT_STATUS_COLOR.confirmed]) {
      const event = seed(30 * 24 * HOUR);
      const { token } = await linkOf(event);
      await patient("answer", { token, action: "confirm" });
      const moved = new Date(Date.parse(event.start.dateTime ?? "") + 24 * HOUR).toISOString();
      const kept = atGoogle(event.id);
      if (kept) Object.assign(kept, { start: { dateTime: moved }, end: { dateTime: new Date(Date.parse(moved) + HOUR).toISOString() }, colorId: color, etag: '"moved"' });
      const view = (await (await patient("view", { token })).json()) as ConfirmView;
      expect(view, color).toMatchObject({ state: "open", start: moved });
      // Confirming again records the new time; with the color already Confirmado, Google is not asked to change.
      const patches = google.seen.filter((r) => r.method === "PATCH").length;
      expect(((await (await patient("answer", { token, action: "confirm" })).json()) as ConfirmView).state).toBe("confirmed");
      expect(google.seen.filter((r) => r.method === "PATCH").length - patches).toBe(color === EVENT_STATUS_COLOR.confirmed ? 0 : 1);
      const status = (await (await api("GET", `/google/events/link?calendarId=${encodeURIComponent(WORK)}&eventId=${event.id}`)).json()) as { answerStart: string };
      expect(status.answerStart).toBe(moved);
    }
  });

  it("two taps at once change the color once, ring once and count once", async () => {
    const event = seed(30 * 24 * HOUR);
    const { token } = await linkOf(event);
    const both = await Promise.all([patient("answer", { token, action: "confirm" }), patient("answer", { token, action: "confirm" })]);
    for (const res of both) expect(((await res.json()) as ConfirmView).state).toBe("confirmed");
    const notices = await inOwner((agent) => agent.store.db.all(`SELECT id FROM zur_notices WHERE kind = 'agenda.confirmed'`));
    expect(notices).toHaveLength(1);
    expect(await inOwner((agent) => agent.store.db.one<{ answer_count: number }>(`SELECT answer_count FROM zur_appointment_links`)?.answer_count)).toBe(1);
  });

  it("an appointment the owner confirmed shows as confirmed, and a tap writes the answer without asking Google", async () => {
    const event = seed(30 * 24 * HOUR, { colorId: EVENT_STATUS_COLOR.confirmed });
    const { token } = await linkOf(event);
    expect(((await (await patient("view", { token })).json()) as ConfirmView).state).toBe("confirmed");
    expect(((await (await patient("answer", { token, action: "confirm" })).json()) as ConfirmView).state).toBe("confirmed");
    expect(google.seen.filter((r) => r.method === "PATCH")).toHaveLength(0);
  });

  it("a token never opens or changes another appointment, and one of a deleted event or another calendar is the same 'not found'", async () => {
    const a = seed(30 * 24 * HOUR);
    const b = seed(31 * 24 * HOUR);
    const { token } = await linkOf(a);
    await linkOf(b);
    await patient("answer", { token, action: "confirm" });
    expect(atGoogle(b.id)?.colorId).toBeUndefined();
    // The event left Google.
    google.events.set(WORK, (google.events.get(WORK) ?? []).filter((event) => event.id !== a.id));
    const gone = await patient("view", { token });
    const unknown = await patient("view", { token: "A".repeat(22) }, "203.0.113.90");
    expect(gone.status).toBe(404);
    expect(unknown.status).toBe(404);
    const body = await unknown.text();
    expect(await gone.text()).toBe(body);
    // No longer an appointment at Google: all day, without its type, or a color that is not a status.
    for (const change of [{ start: { date: "2030-01-10" }, end: { date: "2030-01-11" } }, { description: "Almoço" }, { colorId: "3" }]) {
      const c = seed(32 * 24 * HOUR);
      const link = await linkOf(c);
      Object.assign(atGoogle(c.id) ?? {}, change);
      const res = await patient("view", { token: link.token });
      expect(res.status, JSON.stringify(change)).toBe(404);
      expect(await res.text()).toBe(body);
    }
    // Its calendar closed to the Zuri, or turned to "only read": the tap could not reach Google.
    for (const mode of ["off", "read"] as const) {
      const c = seed(33 * 24 * HOUR);
      const link = await linkOf(c);
      expect((await api("PATCH", `/google/calendars/${encodeURIComponent(WORK)}`, { mode })).status).toBe(200);
      const res = await patient("view", { token: link.token });
      expect(res.status, mode).toBe(404);
      expect(await res.text()).toBe(body);
      expect((await patient("answer", { token: link.token, action: "confirm" })).status).toBe(404);
      expect((await api("POST", "/google/events/link", { calendarId: WORK, eventId: c.id })).status).not.toBe(200);
      expect((await api("PATCH", `/google/calendars/${encodeURIComponent(WORK)}`, { mode: "write" })).status).toBe(200);
    }
    expect(google.seen.filter((r) => r.method === "PATCH")).toHaveLength(1);
  });

  it("a plain event with a color outside the four has no link; Google waiting for the owner says 'try again', and disconnecting ends the links", async () => {
    const grape = seed(30 * 24 * HOUR, { colorId: "3" });
    expect((await api("POST", "/google/events/link", { calendarId: WORK, eventId: grape.id })).status).toBe(400);
    const { token } = await linkOf(seed(30 * 24 * HOUR));
    // Google waiting for the owner (access revoked): the patient tries again later, the link is not dead.
    await inOwner((agent) => agent.store.db.run(`UPDATE zur_google_account SET status = 'revoked'`));
    const res = await patient("view", { token });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { message: string }).message).not.toMatch(/google/i);
    await inOwner((agent) => agent.store.db.run(`UPDATE zur_google_account SET status = 'connected'`));
    // Disconnected: the links go with the account, as the review links do, and answer "not found".
    expect((await api("DELETE", "/google")).status).toBeLessThan(300);
    expect(await inOwner((agent) => agent.store.db.all(`SELECT id FROM zur_appointment_links`))).toEqual([]);
    expect((await patient("view", { token })).status).toBe(404);
  });

  it("refuses a wrong shape as 'not found' without reaching Google, and an action outside the list", async () => {
    for (const [i, token] of ["", "A".repeat(21), "A".repeat(23), `${"A".repeat(21)}+`, `${"A".repeat(21)}/`].entries()) {
      const res = await patient("view", { token }, `203.0.${i + 1}.9`);
      expect(res.status, token).toBe(404);
    }
    expect((await patient("answer", { token: "A".repeat(22), action: "delete" })).status).toBe(400);
    expect((await patient("view", { token: "A".repeat(22), id: "cf1" })).status).toBe(400);
    expect(google.seen.filter((r) => r.url.includes("/events/") && !r.url.includes("/events/watch"))).toHaveLength(0);
  });

  it("refuses a post from another site", async () => {
    const { token } = await linkOf(seed(30 * 24 * HOUR));
    const res = await call(`${ORIGIN}/api/c/answer`, {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": patientIp, origin: "https://outro.exemplo.com.br" },
      body: JSON.stringify({ token, action: "confirm" }),
    });
    expect(res.status).toBe(403);
    expect(google.seen.filter((r) => r.method === "PATCH")).toHaveLength(0);
  });

  it("Google down: 503 with the page's words and no data; a tap that fails changes nothing", async () => {
    const event = seed(30 * 24 * HOUR);
    const { token } = await linkOf(event);
    google.outage = 503;
    const res = await patient("view", { token });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { code: string; message: string };
    expect(body).toMatchObject({ code: "SERVICE_UNAVAILABLE", message: "Não deu para carregar agora. Tente de novo em instantes." });
    expect((await patient("answer", { token, action: "confirm" })).status).toBe(503);
    google.outage = null;
    expect(atGoogle(event.id)?.colorId).toBeUndefined();
    expect(await inOwner((agent) => agent.store.db.one<{ answer: string | null }>(`SELECT answer FROM zur_appointment_links`)?.answer)).toBeNull();
  });

  it("changed at Google meanwhile (412): reads it once more and answers on that version", async () => {
    const event = seed(30 * 24 * HOUR);
    const { token } = await linkOf(event);
    // Each read gives the new etag; the first patch carries the old one.
    let reads = 0;
    const handle = google.handle.bind(google);
    google.handle = async (request) => {
      if (request.method === "GET" && request.url.includes(`/events/${event.id}`) && reads++ === 0) {
        const res = await handle(request);
        const kept = atGoogle(event.id);
        if (kept) kept.etag = '"newer"';
        return res;
      }
      return handle(request);
    };
    const res = await patient("answer", { token, action: "confirm" });
    expect(res.status).toBe(200);
    expect(atGoogle(event.id)?.colorId).toBe(EVENT_STATUS_COLOR.confirmed);
  });
});

describe("E7a: the limits", () => {
  it("lets a network open 30 pages in the window and refuses the 31st with when to come back", async () => {
    const { token } = await linkOf(seed(30 * 24 * HOUR));
    for (let i = 0; i < CONFIRM_LINK_LIMITS.viewsPerWindow; i++) expect((await patient("view", { token })).status).toBe(200);
    const over = await patient("view", { token });
    expect(over.status).toBe(429);
    expect(Number(over.headers.get("retry-after"))).toBeGreaterThan(0);
    // Another network is not held back.
    expect((await patient("view", { token }, "203.0.113.200")).status).toBe(200);
  });

  it("lets 10 answers through in the window and refuses the 11th", async () => {
    const { token } = await linkOf(seed(30 * 24 * HOUR));
    for (let i = 0; i < CONFIRM_LINK_LIMITS.answersPerWindow; i++) expect((await patient("answer", { token, action: "confirm" })).status).toBe(200);
    expect((await patient("answer", { token, action: "confirm" })).status).toBe(429);
  });

  it("blocks the network for an hour after the third unknown token, the right one included", async () => {
    const { token } = await linkOf(seed(30 * 24 * HOUR));
    expect((await patient("view", { token: "B".repeat(22) })).status).toBe(404);
    expect((await patient("view", { token: "C".repeat(22) })).status).toBe(404);
    expect((await patient("view", { token: "D".repeat(22) })).status).toBe(404);
    const blocked = await patient("view", { token });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(CONFIRM_LINK_LIMITS.windowMs / 1000);
    expect((await patient("answer", { token, action: "confirm" })).status).toBe(429);
  });

  it("a stranger's guesses write nothing", async () => {
    const before = await inOwner((agent) => agent.store.db.usage.rowsWritten);
    for (const letter of "EF") await patient("view", { token: letter.repeat(22) });
    expect(await inOwner((agent) => agent.store.db.usage.rowsWritten)).toBe(before);
  });

  it("caps the answers that change something at 10 per link and day", async () => {
    const event = seed(30 * 24 * HOUR);
    const { token } = await linkOf(event);
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
    await inOwner((agent) => agent.store.db.run(`UPDATE zur_appointment_links SET answer_day = ?, answer_count = ?`, today, CONFIRM_LINK_LIMITS.answersPerDay));
    const res = await patient("answer", { token, action: "confirm" });
    expect(res.status).toBe(429);
    expect(atGoogle(event.id)?.colorId).toBeUndefined();
    await inOwner((agent) => agent.store.db.run(`UPDATE zur_appointment_links SET answer_count = ?`, CONFIRM_LINK_LIMITS.answersPerDay - 1));
    expect((await patient("answer", { token, action: "confirm" })).status).toBe(200);
  });

  it("nothing changes during a lockdown", async () => {
    const event = seed(30 * 24 * HOUR);
    const { token } = await linkOf(event);
    await inOwner((agent) => {
      agent.store.auth.lockdown.active = () => true;
    });
    try {
      expect((await patient("answer", { token, action: "confirm" })).status).toBe(503);
    } finally {
      await inOwner((agent) => {
        delete (agent.store.auth.lockdown as { active?: unknown }).active;
      });
    }
    expect(atGoogle(event.id)?.colorId).toBeUndefined();
  });
});

describe("E7a: the edges, on a clock of the test's own", () => {
  /** The same links, the same Google and the same keys, at the instant `at`. */
  const at = (at: number) => (agent: ZuriAgent) =>
    new ConfirmLinks({
      db: agent.store.db,
      google: () => agent.store.google,
      timeZone: () => "America/Sao_Paulo",
      locale: () => "pt-BR",
      clinic: () => CLINIC,
      publicUrl: () => new URL(ORIGIN),
      credentialKey: testEnv.MCP_CREDENTIAL_KEY,
      secret: () => "segredo-de-teste",
      notify: () => {},
      lockdown: () => false,
      clock: () => at,
    });
  const codeOf = (error: unknown) => (error as { code?: string }).code ?? String(error);

  it("cancels at the deadline's minute and before it, and refuses a minute after", async () => {
    for (const [offset, expected] of [
      [-60_000, "cancelled"],
      [0, "cancelled"],
      [60_000, "CONFLICT"],
    ] as const) {
      const event = seed(30 * 24 * HOUR);
      const { token } = await linkOf(event);
      const result = await inOwner(async (agent) => {
        const deadline = at(Date.now())(agent).cancelUntil({ start: new Date(event.start.dateTime ?? "").toISOString() });
        try {
          return (await at(deadline + offset)(agent).answer(token, "cancel", `198.51.200.${net}`)).state;
        } catch (error) {
          return codeOf(error);
        }
      });
      expect(result, String(offset)).toBe(expected);
    }
  });

  it("expires at exactly an hour before the start: 61 minutes before it opens, 60 and 59 it has expired", async () => {
    const event = seed(30 * 24 * HOUR);
    const { token } = await linkOf(event);
    const start = Date.parse(event.start.dateTime ?? "");
    for (const [minutes, state] of [
      [61, "open"],
      [60, "expired"],
      [59, "expired"],
    ] as const) {
      const view = await inOwner((agent) => at(start - minutes * 60_000)(agent).view(token, `198.51.201.${net}`));
      expect(view.state, String(minutes)).toBe(state);
    }
  });
});

describe("E7a: the team's WhatsApp", () => {
  it("asks for the password typed recently and raises a security alert, only when the number changes", async () => {
    await inOwner((agent) => {
      agent.store.db.run(`DELETE FROM zur_auth_events`);
      agent.store.db.run(`UPDATE zur_sessions SET confirmed_at = ?`, Date.now() - 16 * 60_000);
    });
    expect((await api("PATCH", "/settings", { clinic: { ...CLINIC, name: "Outro nome" } })).status).toBe(200);
    const refused = await api("PATCH", "/settings", { clinic: { ...CLINIC, whatsapp: "41999998888" } });
    expect(refused.status).toBe(403);
    await inOwner((agent) => agent.store.db.run(`UPDATE zur_sessions SET confirmed_at = ?`, Date.now()));
    expect((await api("PATCH", "/settings", { clinic: { ...CLINIC, whatsapp: "41999998888" } })).status).toBe(200);
    const kinds = await inOwner((agent) => agent.store.db.all<{ kind: string }>(`SELECT kind FROM zur_auth_events WHERE kind = 'clinic_whatsapp_changed'`));
    expect(kinds).toHaveLength(1);
    // The owner hears of it as a security notice, the critical kind.
    // A security alert kind: the alerts' pass turns it into the owner's critical notice (alerts/security.ts).
    expect(SECURITY_ALERT_EVENTS).toContain("clinic_whatsapp_changed");
  });
});

describe("E7a: /c/<token> at the Worker", () => {
  it("is the app's same shell for any token, with no cache, no referrer, no indexing and never in a frame", async () => {
    const assets = fakeAssets();
    const bodies: string[] = [];
    for (const path of [`/c/${"A".repeat(22)}`, `/c/${"B".repeat(22)}`, "/c/", "/c", `/c/${"A".repeat(22)}/mais`, `/c/${"A".repeat(22)}?id=cf1`]) {
      const res = await call(`${ORIGIN}${path}`, {}, { ASSETS: assets.binding });
      expect(res.status, path).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("referrer-policy")).toBe("no-referrer");
      expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
      expect(res.headers.get("x-frame-options")).toBe("DENY");
      expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
      expect(res.headers.get("set-cookie")).toBeNull();
      bodies.push(await res.text());
    }
    expect(new Set(bodies).size).toBe(1);
    // Always the shell at "/": the token never reaches the assets.
    for (const [input] of assets.fetch.mock.calls) expect(new URL(input instanceof Request ? input.url : String(input)).pathname).toBe("/");
    const post = await call(`${ORIGIN}/c/${"A".repeat(22)}`, { method: "POST", body: "x" }, { ASSETS: assets.binding });
    expect(post.status).toBe(404);
    expect((await call(`${ORIGIN}/c/${"A".repeat(22)}`, { method: "HEAD" }, { ASSETS: assets.binding })).status).toBe(200);
  });
});

describe("firstName", () => {
  it("drops the title and keeps the first word, cut to 40 characters", () => {
    expect(firstName("Dra. Beatriz Novaes")).toBe("Beatriz");
    expect(firstName("dr Paulo")).toBe("Paulo");
    expect(firstName("Ana")).toBe("Ana");
    expect(firstName("")).toBe("");
    expect([...firstName("a".repeat(50))]).toHaveLength(40);
  });
});
