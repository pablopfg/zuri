import { AGENT_INSTANCE_NAME, type AgendaPage, type AgendaEvent, type GoogleCalendarInfo, type GoogleStatus, DEFAULT_AGENDA_PREFS, dayPlus, nationalHoliday } from "@zuri/shared";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ZuriAgent } from "../src/agent/zuri-agent.ts";
import { InternalState } from "../src/db/internal-state.ts";
import { googlePushToken } from "../src/gates/google-push.ts";
import { type DevGoogle, devGoogle, googleNetwork } from "../src/google/dev-google.ts";
import { call, CSRF, errorBody, HUMAN_TOKEN, ORIGIN, TEST_EMAIL, TEST_PASSWORD, testEnv, signedCookies } from "./helpers.ts";

// Step 19: the Google Calendar through the Worker, as Settings › Integrations and the Agenda screen call it.

const IP = "192.0.2.190";
let cookie = "";
let google: DevGoogle;
const owner = () => testEnv.AGENT.get(testEnv.AGENT.idFromName(AGENT_INSTANCE_NAME));
const inOwner = <T>(fn: (agent: ZuriAgent) => T | Promise<T>) => runInDurableObject(owner(), (agent: ZuriAgent) => fn(agent));

const headers = (withCookie = true) => ({ ...CSRF, "content-type": "application/json", "cf-connecting-ip": IP, ...(withCookie ? { cookie } : {}) });
const api = (method: string, path: string, body?: unknown, withCookie = true) =>
  call(`${ORIGIN}/api${path}`, { method, headers: headers(withCookie), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const stale = () => inOwner((agent) => agent.store.db.run(`UPDATE zur_sessions SET confirmed_at = ?`, Date.now() - 16 * 60_000));
const fresh = () => inOwner((agent) => agent.store.db.run(`UPDATE zur_sessions SET confirmed_at = ?`, Date.now()));

/** What Google's consent page hands back: a code bound to the PKCE challenge of the URL. */
function consent(url: string): { state: string; code: string } {
  const params = new URL(url).searchParams;
  return { state: params.get("state") ?? "", code: `dev.${params.get("code_challenge") ?? ""}` };
}

async function connect(): Promise<GoogleStatus> {
  const begin = await api("POST", "/google/connect");
  expect(begin.status).toBe(200);
  const { url } = (await begin.json()) as { url: string };
  const res = await api("POST", "/google/callback", consent(url));
  expect(res.status).toBe(200);
  return (await res.json()) as GoogleStatus;
}

const setMode = (id: string, mode: string) => api("PATCH", `/google/calendars/${encodeURIComponent(id)}`, { mode });
const PRIMARY = "dono@exemplo.com.br";
const WORK = "trabalho@exemplo.com.br";
const READER = "consultorio@exemplo.com.br";
const FREE_BUSY = "livre@exemplo.com.br";

/** Today and the next day, local dates in the default zone. */
function window(): { from: string; to: string } {
  const today = new Date().toISOString().slice(0, 10);
  const after = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
  return { from: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10), to: after > today ? after : today };
}

function seedEvent(calendarId: string, summary: string, hoursFromNow = 2): string {
  const start = new Date(Date.now() + hoursFromNow * 3_600_000);
  const id = `seed${google.events.size}${Math.floor(Math.random() * 1e6)}`;
  const list = google.events.get(calendarId) ?? [];
  list.push({ id, etag: '"seed"', summary, start: { dateTime: start.toISOString() }, end: { dateTime: new Date(start.getTime() + 3_600_000).toISOString() } });
  google.events.set(calendarId, list);
  return id;
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
  await inOwner((agent) => {
    agent.store.google.network = googleNetwork(google, { fetch: () => Promise.reject(new Error("no network in tests")) });
  });
  await fresh();
});

afterEach(async () => {
  await inOwner((agent) => {
    const { db } = agent.store;
    const state = new InternalState(db);
    state.delete("lockdown_until");
    state.delete("google_oauth_pending");
    for (const table of ["zur_google_calendars", "zur_google_account", "zur_auth_events", "zur_notices"]) db.run(`DELETE FROM ${table}`);
  });
});

describe("/api/google: connecting", () => {
  it("needs a session and the CSRF header", async () => {
    expect((await api("GET", "/google", undefined, false)).status).toBe(401);
    expect((await call(`${ORIGIN}/api/google`, { headers: { cookie, "cf-connecting-ip": IP } })).status).toBe(403);
  });

  it("starts configured and not connected", async () => {
    const status = (await (await api("GET", "/google")).json()) as GoogleStatus;
    expect(status).toEqual({ configured: true, connected: false, account: null, status: null, problem: null, connectedAt: null, calendars: [] });
  });

  it("asks for the password typed recently to connect", async () => {
    await stale();
    const res = await api("POST", "/google/connect");
    expect(res.status).toBe(403);
    expect((await errorBody(res)).code).toBe("RECENT_AUTH_REQUIRED");
  });

  it("sends the owner to Google with PKCE, offline access, the two scopes and the fixed redirect", async () => {
    const { url } = (await (await api("POST", "/google/connect")).json()) as { url: string };
    const target = new URL(url);
    expect(target.origin + target.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    const p = target.searchParams;
    expect(p.get("client_id")).toBe(testEnv.GOOGLE_CLIENT_ID);
    expect(p.get("redirect_uri")).toBe(`${ORIGIN}/rest/oauth2-credential/callback`);
    expect(p.get("scope")?.split(" ").sort()).toEqual(["https://www.googleapis.com/auth/calendar.calendarlist.readonly", "https://www.googleapis.com/auth/calendar.events"]);
    expect(p.get("code_challenge_method")).toBe("S256");
    expect(p.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(p.get("access_type")).toBe("offline");
    expect(p.get("include_granted_scopes")).toBe("true");
    expect(p.get("state")).toMatch(/^g\.[A-Za-z0-9_-]{43}$/);
    // Nothing secret travels in the address.
    expect(url).not.toContain(testEnv.GOOGLE_CLIENT_SECRET ?? "x");
  });

  it("connects: the calendars arrive hidden, the tokens are sealed and never answered, and the owner is told", async () => {
    const status = await connect();
    expect(status).toMatchObject({ connected: true, account: PRIMARY, status: "connected", problem: null });
    expect(status.calendars.map((c) => [c.id, c.mode, c.writable])).toEqual([
      [PRIMARY, "off", true],
      [READER, "off", false],
      [FREE_BUSY, "off", false],
      [WORK, "off", true],
    ]);
    const body = JSON.stringify(status);
    expect(body).not.toMatch(/1\/\/dev-|ya29\./);
    const row = await inOwner((agent) => agent.store.db.one<{ refresh_token: string; access_token: string }>(`SELECT refresh_token, access_token FROM zur_google_account`));
    expect(row?.refresh_token).toMatch(/^v1\./);
    expect(row?.access_token).toMatch(/^v1\./);
    for (const token of google.refreshTokens) expect(row?.refresh_token).not.toContain(token);
    // The secret went only in the token request's body.
    expect(google.seen.find((r) => r.url.endsWith("/token"))?.body).toContain("client_secret=");
    const kinds = await inOwner((agent) => agent.store.db.all<{ kind: string }>(`SELECT kind FROM zur_auth_events`).map((r) => r.kind));
    expect(kinds).toContain("google_connected");
  });

  it("refuses a state used twice, an unknown one and one from another session", async () => {
    const { url } = (await (await api("POST", "/google/connect")).json()) as { url: string };
    const answer = consent(url);
    expect((await api("POST", "/google/callback", answer)).status).toBe(200);
    const again = await api("POST", "/google/callback", answer);
    expect(again.status).toBe(400);
    expect((await errorBody(again)).code).toBe("VALIDATION_FAILED");
    expect((await api("POST", "/google/callback", { state: `g.${"A".repeat(43)}`, code: "dev.x" })).status).toBe(400);
    // Another session's sign-in: the state matches but the session doesn't.
    const other = await inOwner((agent) => agent.store.google.begin("outra-sessao"));
    expect((await api("POST", "/google/callback", consent(other))).status).toBe(400);
  });

  it("refuses a state past its 10 minutes", async () => {
    const { url } = (await (await api("POST", "/google/connect")).json()) as { url: string };
    await inOwner((agent) => {
      const state = new InternalState(agent.store.db);
      const pending = JSON.parse(state.get<string>("google_oauth_pending") ?? "{}") as { expires: number };
      state.set("google_oauth_pending", JSON.stringify({ ...pending, expires: Date.now() - 1 }));
    });
    expect((await api("POST", "/google/callback", consent(url))).status).toBe(400);
  });

  it("refuses malformed callbacks before anything else", async () => {
    for (const body of [{ state: "x" }, { state: `g.${"A".repeat(43)}`, extra: 1 }, { state: `${"A".repeat(45)}` }]) {
      expect((await api("POST", "/google/callback", body)).status).toBe(400);
    }
  });

  it("saves nothing and gives the grant back when a permission was left unticked", async () => {
    google.grant = ["https://www.googleapis.com/auth/calendar.events"];
    const { url } = (await (await api("POST", "/google/connect")).json()) as { url: string };
    const res = await api("POST", "/google/callback", consent(url));
    expect(res.status).toBe(400);
    expect((await errorBody(res)).message).toMatch(/duas permissões|both permissions/);
    expect(google.revoked).toHaveLength(1);
    expect(((await (await api("GET", "/google")).json()) as GoogleStatus).connected).toBe(false);
  });

  it("says the owner said no when Google answers with an error", async () => {
    const { url } = (await (await api("POST", "/google/connect")).json()) as { url: string };
    const res = await api("POST", "/google/callback", { state: consent(url).state, error: "access_denied" });
    expect(res.status).toBe(400);
  });

  it("disconnects: forgets everything here and revokes at Google", async () => {
    await connect();
    const res = await api("DELETE", "/google");
    expect(res.status).toBe(200);
    expect(((await (await api("GET", "/google")).json()) as GoogleStatus).connected).toBe(false);
    expect(google.revoked).toHaveLength(1);
    expect(await inOwner((agent) => agent.store.db.one(`SELECT 1 FROM zur_google_calendars`))).toBeNull();
  });

  it("marks the connection and tells the owner once a day when Google revokes the access", async () => {
    await connect();
    await setMode(PRIMARY, "read");
    google.refreshTokens.clear();
    google.accessTokens.clear();
    const first = await api("GET", `/google/events?from=${window().from}&to=${window().to}`);
    expect(first.status).toBe(409);
    const status = (await (await api("GET", "/google")).json()) as GoogleStatus;
    expect(status).toMatchObject({ status: "error", problem: "revoked" });
    await api("GET", `/google/events?from=${window().from}&to=${window().to}`);
    const notices = await inOwner((agent) => agent.store.db.all(`SELECT 1 FROM zur_notices WHERE kind = 'google.reconnect'`));
    expect(notices).toHaveLength(1);
  });

  it("does nothing with Google during a lockdown", async () => {
    await connect();
    const before = google.seen.length;
    await inOwner((agent) => new InternalState(agent.store.db).set("lockdown_until", new Date(Date.now() + 3_600_000).toISOString()));
    const res = await api("POST", "/google/refresh");
    expect(res.status).toBe(423);
    await inOwner((agent) => new InternalState(agent.store.db).delete("lockdown_until"));
    expect(google.seen.length).toBe(before);
  });
});

describe("/api/google: calendars", () => {
  it("opens a calendar only with the password typed recently and hides one without it", async () => {
    await connect();
    await stale();
    expect((await setMode(PRIMARY, "read")).status).toBe(403);
    await fresh();
    expect((await setMode(PRIMARY, "read")).status).toBe(200);
    await stale();
    expect((await setMode(PRIMARY, "off")).status).toBe(200);
  });

  it("refuses writing where Google only lets read, and any mode for free/busy calendars", async () => {
    await connect();
    const reader = await setMode(READER, "write");
    expect(reader.status).toBe(400);
    expect((await setMode(READER, "read")).status).toBe(200);
    expect((await setMode(FREE_BUSY, "read")).status).toBe(400);
    expect((await setMode("nao-existe@exemplo.com.br", "read")).status).toBe(404);
    expect((await setMode(PRIMARY, "tudo")).status).toBe(400);
  });

  it("tells the owner when a calendar is opened for changes and opens its push channel", async () => {
    await connect();
    const res = await setMode(WORK, "write");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { calendar: GoogleCalendarInfo }).calendar).toMatchObject({ id: WORK, mode: "write" });
    const kinds = await inOwner((agent) => agent.store.db.all<{ kind: string }>(`SELECT kind FROM zur_auth_events`).map((r) => r.kind));
    expect(kinds).toContain("google_calendar_write");
    expect([...google.channels.values()].map((c) => [c.calendarId, c.address])).toEqual([[WORK, `${ORIGIN}/api/google/push`]]);
    // Hidden again: the channel is closed.
    await setMode(WORK, "off");
    expect(google.channels.size).toBe(0);
  });
});

describe("/api/google/events: the Agenda screen", () => {
  // Days ahead of the real clock: a day before today is frozen (the record of the day, 13/11/2026).
  const ahead = (plus: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(Date.now() + plus * 86_400_000));
  const D5 = ahead(30);
  const D6 = ahead(31);
  const D20 = ahead(45);
  const A20 = ahead(60);
  const A22 = ahead(62);
  const A23 = ahead(63);
  it("lists the open calendars' events in order and skips hidden calendars", async () => {
    await connect();
    await setMode(PRIMARY, "write");
    await setMode(READER, "read");
    seedEvent(PRIMARY, "Dentista", 3);
    seedEvent(READER, "Atendimento", 1);
    seedEvent(WORK, "Escondido", 2);
    const { from, to } = window();
    const page = (await (await api("GET", `/google/events?from=${from}&to=${to}`)).json()) as AgendaPage;
    expect(page.events.map((e) => e.title)).toEqual(["Atendimento", "Dentista"]);
    expect(page.calendars.map((c) => c.id).sort()).toEqual([PRIMARY, READER].sort());
  });

  it("refuses a window longer than six weeks, backwards or malformed", async () => {
    await connect();
    for (const q of ["from=2026-01-01&to=2026-03-01", "from=2026-02-01&to=2026-01-01", "from=amanha&to=2026-01-01", ""]) {
      expect((await api("GET", `/google/events?${q}`)).status).toBe(400);
    }
    // 43 days, the longest window, and not one more.
    expect((await api("GET", "/google/events?from=2026-01-01&to=2026-02-12")).status).toBe(200);
    expect((await api("GET", "/google/events?from=2026-01-01&to=2026-02-13")).status).toBe(400);
  });

  it("creates, changes and deletes an event, with nobody e-mailed and the version checked", async () => {
    await connect();
    await setMode(WORK, "write");
    const created = await api("POST", "/google/events", { calendarId: WORK, title: "Revisão", allDay: false, start: `${D5}T14:00`, end: `${D5}T15:00` });
    expect(created.status).toBe(201);
    const { event } = (await created.json()) as { event: AgendaEvent };
    expect(event).toMatchObject({ title: "Revisão", allDay: false, start: `${D5}T17:00:00.000Z`, end: `${D5}T18:00:00.000Z` });
    const insert = google.seen.find((r) => r.method === "POST" && r.url.includes("/events?"));
    expect(new URL(insert?.url ?? "x:").searchParams.get("sendUpdates")).toBe("none");
    expect(JSON.parse(insert?.body ?? "{}")).not.toHaveProperty("attendees");

    const moved = await api("PATCH", "/google/events", { calendarId: WORK, eventId: event.id, etag: event.etag, start: `${D5}T16:00` });
    expect(moved.status).toBe(200);
    const after = ((await moved.json()) as { event: AgendaEvent }).event;
    // Moving the start keeps the length.
    expect([after.start, after.end]).toEqual([`${D5}T19:00:00.000Z`, `${D5}T20:00:00.000Z`]);
    expect(google.seen.filter((r) => r.method === "PATCH").at(-1)?.headers["if-match"]).toBe(event.etag);

    // The old version: refused, nothing changed.
    const stalePatch = await api("PATCH", "/google/events", { calendarId: WORK, eventId: event.id, etag: event.etag, title: "Outro" });
    expect(stalePatch.status).toBe(409);
    expect((await errorBody(stalePatch)).code).toBe("TARGET_CHANGED");
    const staleDelete = await api("DELETE", "/google/events", { calendarId: WORK, eventId: event.id, etag: event.etag });
    expect(staleDelete.status).toBe(409);

    expect((await api("DELETE", "/google/events", { calendarId: WORK, eventId: event.id, etag: after.etag })).status).toBe(200);
    expect(google.events.get(WORK)?.find((e) => e.id === event.id)).toBeUndefined();
  });

  it("creates an all-day event with an inclusive end", async () => {
    await connect();
    await setMode(PRIMARY, "write");
    const res = await api("POST", "/google/events", { calendarId: PRIMARY, title: "Viagem", allDay: true, start: `${A20}`, end: `${A22}` });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { event: AgendaEvent }).event).toMatchObject({ allDay: true, start: `${A20}`, end: `${A23}` });
  });

  it("refuses changes in read-only and hidden calendars, bad dates and oversized fields", async () => {
    await connect();
    await setMode(READER, "read");
    await setMode(PRIMARY, "write");
    const base = { title: "X", allDay: false, start: `${D5}T14:00`, end: `${D5}T15:00` };
    expect((await api("POST", "/google/events", { ...base, calendarId: READER })).status).toBe(400);
    expect((await api("POST", "/google/events", { ...base, calendarId: WORK })).status).toBe(404);
    expect((await api("POST", "/google/events", { ...base, calendarId: PRIMARY, end: `${D5}T13:00` })).status).toBe(400);
    expect((await api("POST", "/google/events", { ...base, calendarId: PRIMARY, start: "2026-02-30T10:00", end: "2026-03-01T10:00" })).status).toBe(400);
    expect((await api("POST", "/google/events", { ...base, calendarId: PRIMARY, end: `${D20}T15:00` })).status).toBe(400);
    expect((await api("POST", "/google/events", { ...base, calendarId: PRIMARY, title: "x".repeat(201) })).status).toBe(400);
    expect((await api("POST", "/google/events", { ...base, calendarId: PRIMARY, title: "x".repeat(200) })).status).toBe(201);
    expect((await api("POST", "/google/events", { ...base, calendarId: PRIMARY, attendees: [{ email: "a@exemplo.com.br" }] })).status).toBe(400);
    expect((await api("POST", "/google/events", { ...base, calendarId: "a/../b" })).status).toBe(400);
  });

  it("reads the event's color at Google and takes it for nothing else than a color number", async () => {
    await connect();
    await setMode(PRIMARY, "read");
    const colors: unknown[] = ["10", undefined, "12", "0", 7, "<b>", "7 "];
    colors.forEach((colorId, index) => {
      seedEvent(PRIMARY, `E${index}`, index + 1);
      const event = google.events.get(PRIMARY)?.at(-1);
      if (event && colorId !== undefined) (event as { colorId?: unknown }).colorId = colorId;
    });
    const page = (await (await api("GET", `/google/events?from=${window().from}&to=${window().to}`)).json()) as AgendaPage;
    expect(page.events.map((e) => e.colorId)).toEqual(["10", "", "", "", "", "", ""]);
  });

  it("creates an event already with a status, and with nothing else than one of the four colors (delivery 3)", async () => {
    await connect();
    await setMode(WORK, "write");
    const base = { calendarId: WORK, title: "Consulta", allDay: false, start: `${D5}T14:00`, end: `${D5}T15:00` };
    const created = await api("POST", "/google/events", { ...base, colorId: "10" });
    expect(created.status).toBe(201);
    expect(((await created.json()) as { event: AgendaEvent }).event.colorId).toBe("10");
    expect(JSON.parse(google.seen.filter((r) => r.method === "POST" && r.url.includes("/events?")).at(-1)?.body ?? "{}").colorId).toBe("10");
    // Without one the event is born without a color, which counts as "Agendado".
    const plain = await api("POST", "/google/events", base);
    expect(((await plain.json()) as { event: AgendaEvent }).event.colorId).toBe("");
    expect(JSON.parse(google.seen.filter((r) => r.method === "POST" && r.url.includes("/events?")).at(-1)?.body ?? "{}")).not.toHaveProperty("colorId");
    const before = google.events.get(WORK)?.length;
    for (const colorId of ["", "1", "12", "07", 7, null, "tomate", ["7"]]) {
      expect((await api("POST", "/google/events", { ...base, colorId })).status).toBe(400);
    }
    expect(google.events.get(WORK)?.length).toBe(before);
  });

  it("CA13: a move that marks Reagendado is undone by the opposite change with the new version, never with the old one", async () => {
    await connect();
    await setMode(WORK, "write");
    const created = await api("POST", "/google/events", { calendarId: WORK, title: "Consulta", allDay: false, start: `${D5}T14:00`, end: `${D5}T15:00`, colorId: "10" });
    const { event } = (await created.json()) as { event: AgendaEvent };
    const target = { calendarId: WORK, eventId: event.id };
    const move = await api("PATCH", "/google/events", { ...target, etag: event.etag, start: `${D6}T09:15`, end: `${D6}T10:00`, colorId: "5" });
    expect(move.status).toBe(200);
    const moved = ((await move.json()) as { event: AgendaEvent }).event;
    expect(moved).toMatchObject({ start: `${D6}T12:15:00.000Z`, end: `${D6}T13:00:00.000Z`, colorId: "5" });
    expect(moved.etag).not.toBe(event.etag);

    const back = { allDay: false, start: `${D5}T14:00`, end: `${D5}T15:00`, colorId: "10" };
    // The version the screen had before the move: Google already has another.
    const stale = await api("PATCH", "/google/events", { ...target, etag: event.etag, ...back });
    expect(((await stale.json()) as { code: string }).code).toBe("TARGET_CHANGED");
    expect(google.events.get(WORK)?.find((e) => e.id === event.id)?.colorId).toBe("5");

    const undo = await api("PATCH", "/google/events", { ...target, etag: moved.etag, ...back });
    expect(undo.status).toBe(200);
    expect(((await undo.json()) as { event: AgendaEvent }).event).toMatchObject({ start: event.start, end: event.end, colorId: "10", title: "Consulta" });
  });

  it("changes the status by the color, with the version checked, and only to one of the four colors", async () => {
    await connect();
    await setMode(WORK, "write");
    const created = await api("POST", "/google/events", { calendarId: WORK, title: "Consulta", allDay: false, start: `${D5}T14:00`, end: `${D5}T15:00` });
    const { event } = (await created.json()) as { event: AgendaEvent };
    expect(event.colorId).toBe("");
    const target = { calendarId: WORK, eventId: event.id };

    const confirmed = await api("PATCH", "/google/events", { ...target, etag: event.etag, colorId: "10" });
    expect(confirmed.status).toBe(200);
    const after = ((await confirmed.json()) as { event: AgendaEvent }).event;
    expect(after).toMatchObject({ colorId: "10", title: "Consulta", start: event.start, end: event.end });
    const sent = google.seen.filter((r) => r.method === "PATCH").at(-1);
    // Only the color goes: nothing else of the event is rewritten.
    expect(JSON.parse(sent?.body ?? "{}")).toEqual({ colorId: "10" });
    expect(sent?.headers["if-match"]).toBe(event.etag);
    expect(new URL(sent?.url ?? "x:").searchParams.get("sendUpdates")).toBe("none");

    // The version the screen read before the change: refused, the color stays.
    const stale = await api("PATCH", "/google/events", { ...target, etag: event.etag, colorId: "11" });
    expect(stale.status).toBe(409);
    expect((await errorBody(stale)).code).toBe("TARGET_CHANGED");
    expect(google.events.get(WORK)?.find((e) => e.id === event.id)?.colorId).toBe("10");

    // A color outside the four, a number, a name: refused before Google hears of it.
    const patches = google.seen.filter((r) => r.method === "PATCH").length;
    for (const colorId of ["1", "12", "07", " 7", 7, null, "tomate", ["7"]]) {
      expect((await api("PATCH", "/google/events", { ...target, etag: after.etag, colorId })).status).toBe(400);
    }
    expect(google.seen.filter((r) => r.method === "PATCH").length).toBe(patches);

    // The color and the hour in one change.
    const both = await api("PATCH", "/google/events", { ...target, etag: after.etag, colorId: "5", start: `${D5}T16:00` });
    const moved = ((await both.json()) as { event: AgendaEvent }).event;
    expect(moved).toMatchObject({ colorId: "5", start: `${D5}T19:00:00.000Z`, end: `${D5}T20:00:00.000Z` });

    // A change without a color leaves the color alone, and says nothing of it to Google.
    const renamed = await api("PATCH", "/google/events", { ...target, etag: moved.etag, title: "Retorno" });
    const kept = ((await renamed.json()) as { event: AgendaEvent }).event;
    expect(kept).toMatchObject({ title: "Retorno", colorId: "5" });
    expect(JSON.parse(google.seen.filter((r) => r.method === "PATCH").at(-1)?.body ?? "{}")).toEqual({ summary: "Retorno" });
    // The color it already has: nothing to send.
    const sentSoFar = google.seen.filter((r) => r.method === "PATCH").length;
    expect((await api("PATCH", "/google/events", { ...target, etag: kept.etag, colorId: "5" })).status).toBe(200);
    expect(google.seen.filter((r) => r.method === "PATCH").length).toBe(sentSoFar);

    // Empty takes the color off: the event follows its calendar's again.
    const cleared = await api("PATCH", "/google/events", { ...target, etag: kept.etag, colorId: "" });
    expect(((await cleared.json()) as { event: AgendaEvent }).event.colorId).toBe("");
    expect(JSON.parse(google.seen.filter((r) => r.method === "PATCH").at(-1)?.body ?? "{}")).toEqual({ colorId: null });
  });

  it("refuses a color in a read-only calendar, changed or new", async () => {
    await connect();
    await setMode(READER, "read");
    await setMode(PRIMARY, "write");
    seedEvent(READER, "Atendimento", 1);
    const event = google.events.get(READER)?.at(-1);
    if (!event) throw new Error("the seed laid no event");
    const res = await api("PATCH", "/google/events", { calendarId: READER, eventId: event.id, etag: event.etag, colorId: "10" });
    expect(res.status).toBe(400);
    // Refused for the calendar, not for the shape of the request: Zuri read the event and stopped before writing.
    expect((await errorBody(res)).code).toBe("VALIDATION_FAILED");
    expect(google.seen.filter((r) => r.method === "PATCH")).toHaveLength(0);
    expect(google.events.get(READER)?.at(-1)).toEqual(event);
    expect(event.colorId).toBeUndefined();
    // A new event takes a status since delivery 3, in a calendar open for editing only, and never a color outside the four.
    expect((await api("POST", "/google/events", { calendarId: READER, title: "X", allDay: false, start: `${D5}T14:00`, end: `${D5}T15:00`, colorId: "10" })).status).toBe(400);
    expect((await api("POST", "/google/events", { calendarId: PRIMARY, title: "X", allDay: false, start: `${D5}T14:00`, end: `${D5}T15:00`, colorId: "3" })).status).toBe(400);
    expect(google.events.get(PRIMARY) ?? []).toHaveLength(0);
  });

  it("cleans what Google sends: no control or bidi characters in titles", async () => {
    await connect();
    await setMode(PRIMARY, "read");
    seedEvent(PRIMARY, "Reuni‮ão\u0007 <script>");
    const page = (await (await api("GET", `/google/events?from=${window().from}&to=${window().to}`)).json()) as AgendaPage;
    expect(page.events[0]?.title).toBe("Reuni ão <script>");
  });
});

describe("/api/google/events: the booking rule, checked again by the server (13/11/2026)", () => {
  const SP = "America/Sao_Paulo";
  /** "YYYY-MM-DD" of today in the owner's zone, plus some days. */
  const localDay = (plus: number) => new Intl.DateTimeFormat("en-CA", { timeZone: SP }).format(new Date(Date.now() + plus * 86_400_000));
  const weekday = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();
  /** The first day from a week on that is a weekday of `kind`, or any national holiday on a working day. */
  const findDay = (test: (day: string) => boolean) => {
    for (let plus = 7; plus < 400; plus++) if (test(localDay(plus))) return localDay(plus);
    throw new Error("no such day");
  };
  const monday = () => findDay((day) => weekday(day) === 1 && nationalHoliday(day) === null);
  const appointment = (day: string, from: string, to: string, more: Record<string, unknown> = {}) => ({
    calendarId: WORK,
    title: "Ana Souza",
    allDay: false,
    start: `${day}T${from}`,
    end: `${day}T${to}`,
    description: "Consulta | Consultório",
    ...more,
  });
  /** The owner's wall time of `day` as an instant (São Paulo is UTC−3 all year). */
  const localDate = (day: string, time: string) => new Date(`${day}T${time}:00-03:00`).toISOString();
  const problem = async (res: Response) => ({ status: res.status, problem: ((await res.json()) as { details?: { problem?: string } }).details?.problem });
  const inserts = () => google.seen.filter((r) => r.method === "POST" && r.url.includes("/events?")).length;

  afterEach(async () => {
    await inOwner((agent) => agent.store.settings.update({ agenda: { ...agent.store.settings.get().agenda, closed: [] } }));
  });

  it("books inside the hours and refuses lunch, the evening, the weekend and the past without asking Google", async () => {
    await connect();
    await setMode(WORK, "write");
    const day = monday();
    expect((await api("POST", "/google/events", appointment(day, "09:00", "10:00"))).status).toBe(201);
    const before = inserts();
    const reads = google.seen.filter((r) => r.method === "GET" && r.url.includes("/events?")).length;
    expect(await problem(await api("POST", "/google/events", appointment(day, "12:30", "13:30")))).toEqual({ status: 400, problem: "lunch" });
    expect(await problem(await api("POST", "/google/events", appointment(day, "17:30", "18:30")))).toEqual({ status: 400, problem: "hours" });
    expect(await problem(await api("POST", "/google/events", appointment(findDay((d) => weekday(d) === 6), "09:00", "10:00")))).toEqual({ status: 400, problem: "weekday" });
    // A day before today is closed before anything else (the record of the day), a meeting too.
    expect(await problem(await api("POST", "/google/events", appointment(localDay(-2), "09:00", "10:00")))).toEqual({ status: 400, problem: "frozen" });
    expect(await problem(await api("POST", "/google/events", { ...appointment(localDay(-1), "09:00", "10:00"), description: "Reunião com o contador" }))).toEqual({ status: 400, problem: "frozen" });
    expect(await problem(await api("POST", "/google/events", appointment(day, "09:02", "10:00")))).toEqual({ status: 400, problem: "step" });
    expect(await problem(await api("POST", "/google/events", appointment(day, "14:00", "14:10")))).toEqual({ status: 400, problem: "short" });
    expect(await problem(await api("POST", "/google/events", appointment(findDay((d) => d > localDay(366) && weekday(d) === 1 && nationalHoliday(d) === null), "09:00", "10:00")))).toEqual({ status: 400, problem: "far" });
    expect(inserts()).toBe(before);
    // Refused by a fixed rule: Google not even asked for the day.
    expect(google.seen.filter((r) => r.method === "GET" && r.url.includes("/events?")).length).toBe(reads);
    // A meeting has no type: any hour, even at lunch.
    expect((await api("POST", "/google/events", { ...appointment(day, "12:30", "13:30"), description: "Reunião com o contador" })).status).toBe(201);
  });

  it("refuses an appointment over another one, in any calendar read, and takes the edges touching", async () => {
    await connect();
    await setMode(WORK, "write");
    await setMode(PRIMARY, "read");
    const day = monday();
    expect((await api("POST", "/google/events", appointment(day, "14:00", "15:00"))).status).toBe(201);
    expect(await problem(await api("POST", "/google/events", appointment(day, "14:30", "15:30")))).toEqual({ status: 400, problem: "clash" });
    // One in the calendar only read, made in Google itself: it takes its hour too.
    const list = google.events.get(PRIMARY) ?? [];
    list.push({ id: "outra", etag: '"1"', summary: "Bruno Lima", description: "Retorno | Sala 2", start: { dateTime: localDate(day, "10:00") }, end: { dateTime: localDate(day, "11:00") } });
    google.events.set(PRIMARY, list);
    expect(await problem(await api("POST", "/google/events", appointment(day, "10:30", "11:30")))).toEqual({ status: 400, problem: "clash" });
    expect((await api("POST", "/google/events", appointment(day, "15:00", "16:00"))).status).toBe(201);
    // A cancelled one frees its hour.
    expect((await api("POST", "/google/events", appointment(day, "16:00", "17:00", { colorId: "11" }))).status).toBe(201);
    expect((await api("POST", "/google/events", appointment(day, "16:00", "17:00"))).status).toBe(201);
  });

  it("always closes a national holiday, and every day of a period off of the settings", async () => {
    await connect();
    await setMode(WORK, "write");
    const holiday = findDay((day) => nationalHoliday(day) !== null && weekday(day) >= 1 && weekday(day) <= 5);
    expect(await problem(await api("POST", "/google/events", appointment(holiday, "09:00", "10:00")))).toEqual({ status: 400, problem: "holiday" });
    // A record saved before 13/11/2026 with the holiday opened: the opening is dropped, the holiday stays closed.
    await inOwner((agent) => agent.store.db.run(`UPDATE zur_settings SET value = ? WHERE key = 'agenda'`, JSON.stringify({ ...agent.store.settings.get().agenda, openHolidays: [holiday] })));
    expect(await problem(await api("POST", "/google/events", appointment(holiday, "09:00", "10:00")))).toEqual({ status: 400, problem: "holiday" });
    const off = monday();
    await inOwner((agent) => agent.store.settings.update({ agenda: { ...agent.store.settings.get().agenda, closed: [{ from: off, to: dayPlus(off, 4), reason: "Recesso" }] } }));
    expect(await problem(await api("POST", "/google/events", appointment(dayPlus(off, 4), "09:00", "10:00")))).toEqual({ status: 400, problem: "closed" });
    const refused = await api("POST", "/google/events", appointment(off, "09:00", "10:00"));
    expect(refused.status).toBe(400);
    const body = (await refused.json()) as { code: string; message: string; details: unknown };
    expect(body).toMatchObject({ code: "VALIDATION_FAILED", details: { problem: "closed" } });
    expect(body.message).toMatch(/sem expediente/);
  });

  it("checks a move, never a change that keeps the day and the hours of an old appointment", async () => {
    await connect();
    await setMode(WORK, "write");
    const day = monday();
    const created = await api("POST", "/google/events", appointment(day, "10:00", "11:00"));
    const { event } = (await created.json()) as { event: AgendaEvent };
    expect(await problem(await api("PATCH", "/google/events", { calendarId: WORK, eventId: event.id, etag: event.etag, start: `${day}T12:00`, end: `${day}T13:00` }))).toEqual({ status: 400, problem: "lunch" });
    // Half an hour on, over its own old place: no clash with itself.
    const moved = await api("PATCH", "/google/events", { calendarId: WORK, eventId: event.id, etag: event.etag, start: `${day}T10:30`, end: `${day}T11:30` });
    expect(moved.status).toBe(200);
    const { event: back } = (await moved.json()) as { event: AgendaEvent };
    const home = await api("PATCH", "/google/events", { calendarId: WORK, eventId: event.id, etag: back.etag, start: `${day}T10:00`, end: `${day}T11:00` });
    expect(home.status).toBe(200);
    event.etag = ((await home.json()) as { event: AgendaEvent }).event.etag;
    // Lunch moved over it in the settings: the appointment stays, and a new title still goes.
    await inOwner((agent) => agent.store.settings.update({ agenda: { ...agent.store.settings.get().agenda, lunch: { from: 600, to: 660 } } }));
    try {
      const renamed = await api("PATCH", "/google/events", { calendarId: WORK, eventId: event.id, etag: event.etag, title: "Ana Souza Lima", start: `${day}T10:00`, end: `${day}T11:00` });
      expect(renamed.status).toBe(200);
      // Taking a cancelled appointment back is a booking again.
      const { event: renamedEvent } = (await renamed.json()) as { event: AgendaEvent };
      const cancelled = await api("PATCH", "/google/events", { calendarId: WORK, eventId: event.id, etag: renamedEvent.etag, colorId: "11" });
      const { event: off } = (await cancelled.json()) as { event: AgendaEvent };
      expect(await problem(await api("PATCH", "/google/events", { calendarId: WORK, eventId: event.id, etag: off.etag, colorId: "7" }))).toEqual({ status: 400, problem: "lunch" });
      // Turning a meeting into an appointment at lunch is refused too.
      const meeting = await api("POST", "/google/events", { ...appointment(day, "10:00", "10:30"), description: "" });
      const { event: plain } = (await meeting.json()) as { event: AgendaEvent };
      expect(await problem(await api("PATCH", "/google/events", { calendarId: WORK, eventId: plain.id, etag: plain.etag, description: "Retorno | Consultório" }))).toEqual({ status: 400, problem: "lunch" });
    } finally {
      await inOwner((agent) => agent.store.settings.update({ agenda: { ...agent.store.settings.get().agenda, lunch: DEFAULT_AGENDA_PREFS.lunch } }));
    }
  });
  it("refuses to change or delete an event of a day that already closed, and says when the last day closed", async () => {
    await connect();
    await setMode(WORK, "write");
    const id = seedEvent(WORK, "Ana Souza", -48);
    const deletes = () => google.seen.filter((r) => r.method === "DELETE" && r.url.includes("/events/")).length;
    const before = deletes();
    expect(await problem(await api("DELETE", "/google/events", { calendarId: WORK, eventId: id, etag: '"seed"' }))).toEqual({ status: 400, problem: "frozen" });
    expect(await problem(await api("PATCH", "/google/events", { calendarId: WORK, eventId: id, etag: '"seed"', title: "Outro" }))).toEqual({ status: 400, problem: "frozen" });
    expect(deletes()).toBe(before);
    expect(google.events.get(WORK)?.find((e) => e.id === id)?.summary).toBe("Ana Souza");
    const record = await api("GET", "/google/record");
    expect(record.status).toBe(200);
    expect(await record.json()).toHaveProperty("last");
  });
});

describe("/api/google/push: changes made elsewhere", () => {
  async function watched(): Promise<string> {
    await connect();
    await setMode(PRIMARY, "read");
    const [id] = [...google.channels.keys()];
    return id ?? "";
  }
  const version = () => inOwner((agent) => agent.store.db.one<{ calendar: number }>(`SELECT calendar FROM zur_area_versions WHERE id = 1`)?.calendar ?? 0);
  const push = (channel: string, token: string, state = "exists") =>
    call(`${ORIGIN}/api/google/push`, { method: "POST", headers: { "x-goog-channel-id": channel, "x-goog-channel-token": token, "x-goog-resource-state": state } });

  it("moves the calendar area for a notice with the channel's token", async () => {
    const channel = await watched();
    expect(google.channels.get(channel)?.token).toBe(await googlePushToken(testEnv.SESSION_SECRET, channel));
    const before = await version();
    const res = await push(channel, await googlePushToken(testEnv.SESSION_SECRET, channel));
    expect(res.status).toBe(200);
    expect(await version()).toBe(before + 1);
  });

  it("ignores the first sync notice, a wrong token, an unknown channel and a GET, always with an empty 200", async () => {
    const channel = await watched();
    const before = await version();
    const token = await googlePushToken(testEnv.SESSION_SECRET, channel);
    const other = crypto.randomUUID();
    for (const res of [
      await push(channel, token, "sync"),
      await push(channel, "0".repeat(64)),
      await push(other, await googlePushToken(testEnv.SESSION_SECRET, other)),
      await push("nao-e-uuid", token),
      await call(`${ORIGIN}/api/google/push`, { headers: { "x-goog-channel-id": channel, "x-goog-channel-token": token } }),
    ]) {
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("");
    }
    expect(await version()).toBe(before);
  });
});
