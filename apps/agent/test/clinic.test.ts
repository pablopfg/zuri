import { AGENT_INSTANCE_NAME, type AgendaEvent, type Clinic, dayPlus, nationalHoliday, type Settings } from "@zuri/shared";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ZuriAgent } from "../src/agent/zuri-agent.ts";
import { InternalState } from "../src/db/internal-state.ts";
import { type DevGoogle, devGoogle, googleNetwork } from "../src/google/dev-google.ts";
import { call, CSRF, HUMAN_TOKEN, ORIGIN, TEST_EMAIL, TEST_PASSWORD, testEnv, signedCookies } from "./helpers.ts";

// E6a (plano consultorio-dados.md): Configurações › Consultório keeps the office's details in one
// place, and an in-person appointment takes its address as the location at Google.

const IP = "192.0.2.194";
let cookie = "";
let google: DevGoogle;
const owner = () => testEnv.AGENT.get(testEnv.AGENT.idFromName(AGENT_INSTANCE_NAME));
const inOwner = <T>(fn: (agent: ZuriAgent) => T | Promise<T>) => runInDurableObject(owner(), (agent: ZuriAgent) => fn(agent));
const headers = (withCookie = true) => ({ ...CSRF, "content-type": "application/json", "cf-connecting-ip": IP, ...(withCookie ? { cookie } : {}) });
const api = (method: string, path: string, body?: unknown, withCookie = true) =>
  call(`${ORIGIN}/api${path}`, { method, headers: headers(withCookie), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

const WORK = "trabalho@exemplo.com.br";
const CLINIC: Clinic = { name: "Consultório Exemplo", whatsapp: "4133330000", address: "Rua das Flores, 120, sala 304 · Centro", city: "Curitiba, PR" };
const WHERE = "Rua das Flores, 120, sala 304 · Centro, Curitiba, PR";

async function connect(): Promise<void> {
  const begin = await api("POST", "/google/connect");
  const params = new URL(((await begin.json()) as { url: string }).url).searchParams;
  expect((await api("POST", "/google/callback", { state: params.get("state") ?? "", code: `dev.${params.get("code_challenge") ?? ""}` })).status).toBe(200);
  expect((await api("PATCH", `/google/calendars/${encodeURIComponent(WORK)}`, { mode: "write" })).status).toBe(200);
}

function workDay(): string {
  let day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(Date.now() + 30 * 86_400_000));
  while ([0, 6].includes(new Date(`${day}T12:00:00Z`).getUTCDay()) || nationalHoliday(day) !== null) day = dayPlus(day, 1);
  return day;
}

// Each appointment of a test in its own hour of the office's day: two at once clash.
const HOURS = ["08", "09", "10", "11", "14", "15", "16", "17"];
let slot = 0;
const booking = (description: string, extra: Record<string, unknown> = {}) => {
  const day = workDay();
  const hour = HOURS[slot++ % HOURS.length] ?? "08";
  return { calendarId: WORK, title: "Beatriz Novaes", allDay: false, start: `${day}T${hour}:00`, end: `${day}T${hour}:55`, description, ...extra };
};
const lastBody = () => JSON.parse(google.seen.filter((r) => r.method !== "GET" && r.url.includes("/events")).at(-1)?.body ?? "{}") as { location?: string };
const saveClinic = (clinic: Partial<Clinic>) => api("PATCH", "/settings", { clinic: { ...CLINIC, ...clinic } });
const create = async (description: string, extra: Record<string, unknown> = {}) => {
  const res = await api("POST", "/google/events", booking(description, extra));
  expect(res.status, await res.clone().text()).toBe(201);
  return ((await res.json()) as { event: AgendaEvent }).event;
};
const change = (event: AgendaEvent, patch: Record<string, unknown>) => api("PATCH", "/google/events", { calendarId: WORK, eventId: event.id, etag: event.etag, ...patch });

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
  slot = 0;
  google = devGoogle({ clientId: testEnv.GOOGLE_CLIENT_ID, clientSecret: testEnv.GOOGLE_CLIENT_SECRET });
  await inOwner((agent) => {
    agent.store.google.network = googleNetwork(google, { fetch: () => Promise.reject(new Error("no network in tests")) });
    agent.store.db.run(`UPDATE zur_sessions SET confirmed_at = ?`, Date.now());
  });
});

afterEach(async () => {
  await inOwner((agent) => {
    const { db } = agent.store;
    new InternalState(db).delete("google_oauth_pending");
    for (const table of ["zur_google_calendars", "zur_google_account", "zur_agenda_record"]) db.run(`DELETE FROM ${table}`);
    db.run(`DELETE FROM zur_settings WHERE key = 'clinic'`);
  });
});

describe("E6a: the office's details", () => {
  it("start empty, save whole, read back and go to the activity log", async () => {
    expect(((await (await api("GET", "/settings")).json()) as Settings).clinic).toEqual({ name: "", whatsapp: "", address: "", city: "" });
    const saved = await saveClinic({ name: "  Consultório   Exemplo " });
    expect(saved.status).toBe(200);
    expect(((await saved.json()) as Settings).clinic).toEqual(CLINIC);
    expect(((await (await api("GET", "/settings")).json()) as Settings).clinic).toEqual(CLINIC);
    const detail = await inOwner((agent) => agent.store.db.one<{ detail: string }>(`SELECT detail FROM zur_activity WHERE kind = 'settings.updated' ORDER BY rowid DESC LIMIT 1`)?.detail);
    expect(JSON.parse(detail ?? "{}")).toEqual({ fields: ["clinic"] });
  });

  it("refuses a WhatsApp out of shape, a line too long, a tag and half the details, naming only the field", async () => {
    for (const bad of [{ whatsapp: "413333000" }, { whatsapp: "(41) 3333-0000" }, { name: "a".repeat(81) }, { address: "<img src=x onerror=alert(1)>" }, { city: "Curitiba\nPR" }]) {
      const res = await saveClinic(bad);
      expect(res.status, JSON.stringify(bad)).toBe(400);
      const body = (await res.json()) as { code: string; details?: { fields: string[] } };
      expect(body.code).toBe("VALIDATION_FAILED");
      expect(body.details?.fields[0]).toMatch(/^clinic\./);
      expect(JSON.stringify(body)).not.toContain("onerror");
    }
    expect((await api("PATCH", "/settings", { clinic: { name: "Só o nome" } })).status).toBe(400);
    expect(((await (await api("GET", "/settings")).json()) as Settings).clinic.name).toBe("");
  });
});

describe("E6a: the in-person appointment's location", () => {
  it("an appointment at the office with no location takes the address; one online, one with a location or with no address saved does not", async () => {
    await connect();
    // No address saved: nothing changes.
    await create("Consulta | Consultório");
    expect(lastBody().location).toBeUndefined();
    expect((await saveClinic({})).status).toBe(200);
    const office = await create("Consulta | Consultório");
    expect(lastBody().location).toBe(WHERE);
    expect(office.location).toBe(WHERE);
    await create("Consulta | Online");
    expect(lastBody().location).toBeUndefined();
    // A location the owner wrote wins.
    await create("Retorno | Consultório", { location: "Sala 2" });
    expect(lastBody().location).toBe("Sala 2");
    // A meeting with no type is no appointment, nor one whose line names another place (SEC-E6a-02).
    await create("Reunião do conselho");
    expect(lastBody().location).toBeUndefined();
    await create("Reunião | Diretoria");
    expect(lastBody().location).toBeUndefined();
  });

  it("moving between the office and online moves the address; a location written by hand stays", async () => {
    await connect();
    expect((await saveClinic({})).status).toBe(200);
    const online = await create("Consulta | Online");
    // To the office, with no location: the address.
    expect((await change(online, { description: "Consulta | Consultório" })).status).toBe(200);
    expect(lastBody().location).toBe(WHERE);
    const office = await create("Consulta | Consultório");
    // Online again: the office's address leaves.
    expect((await change(office, { description: "Consulta | Online" })).status).toBe(200);
    expect(lastBody().location).toBe("");
    // A location written by hand is kept when it goes online.
    const own = await create("Consulta | Consultório", { location: "Sala 2" });
    expect((await change(own, { description: "Consulta | Online" })).status).toBe(200);
    expect(lastBody().location).toBeUndefined();
    // Online to the office with a location written by hand: it stays.
    const handOnline = await create("Consulta | Online", { location: "Sala 2" });
    expect((await change(handOnline, { description: "Consulta | Consultório" })).status).toBe(200);
    expect(lastBody().location).toBeUndefined();
    // No type before, an appointment at the office now: the address.
    const plain = await create("Reunião | Diretoria");
    expect((await change(plain, { description: "Consulta | Consultório" })).status).toBe(200);
    expect(lastBody().location).toBe(WHERE);
    // A change of the title alone leaves the place and the location alone.
    const titled = await create("Consulta | Online");
    expect((await change(titled, { title: "Beatriz Novaes Conceição" })).status).toBe(200);
    expect(lastBody().location).toBeUndefined();
    // The same place: nothing written about the location.
    const same = await create("Consulta | Consultório");
    expect((await change(same, { description: "Retorno | Consultório" })).status).toBe(200);
    expect(lastBody().location).toBeUndefined();
  });
});
