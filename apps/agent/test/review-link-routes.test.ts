import { AGENT_INSTANCE_NAME, REVIEW_REQUEST_LIMITS, type ReviewRequestSettings, type ReviewRequestsPage } from "@zuri/shared";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ZuriAgent } from "../src/agent/zuri-agent.ts";
import { call, CSRF, errorBody, HUMAN_TOKEN, ORIGIN, signedCookies, TEST_EMAIL, TEST_PASSWORD, testEnv } from "./helpers.ts";

// PR S20: the short address /a/<code> through the Worker, and the owner's routes of Avaliações › Pedidos.

const IP = "192.0.2.201";
const LINK = "https://g.page/r/exemplo-consultorio/review";
const CODE = "k7Q2mX9pAB";
let cookie = "";
const owner = () => testEnv.AGENT.get(testEnv.AGENT.idFromName(AGENT_INSTANCE_NAME));
const inOwner = <T>(fn: (agent: ZuriAgent) => T | Promise<T>) => runInDurableObject(owner(), (agent: ZuriAgent) => fn(agent));
const headers = (withCookie = true) => ({ ...CSRF, "content-type": "application/json", "cf-connecting-ip": IP, ...(withCookie ? { cookie } : {}) });
const api = (method: string, path: string, body?: unknown) => call(`${ORIGIN}/api${path}`, { method, headers: headers(), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const open = (path: string, init: RequestInit = {}, overrides = {}) =>
  call(`${ORIGIN}${path}`, { redirect: "manual", ...init, headers: { "cf-connecting-ip": "198.51.100.20", "user-agent": "Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile", ...(init.headers ?? {}) } }, overrides);

beforeAll(async () => {
  const res = await call(`${ORIGIN}/api/auth/login`, { method: "POST", headers: headers(false), body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD, turnstileToken: HUMAN_TOKEN }) });
  expect(res.status).toBe(200);
  cookie = signedCookies(res);
});

beforeEach(() =>
  inOwner((agent) => {
    const { db } = agent.store;
    db.run(`INSERT INTO zur_review_locations (google_name, title, selected, review_uri) VALUES ('accounts/1/locations/2', 'Exemplo Centro', 1, ?)`, LINK);
    db.run(`INSERT INTO zur_review_requests (id, contact_id, person, appointment_day, due_day, attempts, sent_at, created_at, updated_at) VALUES ('q1', 'c1', 'people/c1', '2026-11-03', '2026-11-11', 1, 1, 1, 1)`);
    db.run(`INSERT INTO zur_review_links (code, request_id, attempt, created_at, expires_at) VALUES (?, 'q1', 1, ?, ?)`, CODE, Date.now(), Date.now() + 30 * 86_400_000);
    db.run(`UPDATE zur_sessions SET confirmed_at = ?`, Date.now());
  }),
);

afterEach(() =>
  inOwner((agent) => {
    for (const table of ["zur_review_locations", "zur_review_requests", "zur_review_links", "zur_review_link_hits", "zur_auth_events", "zur_notices"]) agent.store.db.run(`DELETE FROM ${table}`);
  }),
);

const openedAt = () => inOwner((agent) => agent.store.db.one<{ opened_at: number | null }>(`SELECT opened_at FROM zur_review_requests WHERE id = 'q1'`)?.opened_at ?? null);

describe("/a/<code>", () => {
  it("goes on to the profile's review page, notes the first opening and leaks nothing", async () => {
    const res = await open(`/a/${CODE}`);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(LINK);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(await openedAt()).not.toBeNull();
  });

  it("lets a preview robot and a HEAD through without noting an opening", async () => {
    expect((await open(`/a/${CODE}`, { headers: { "user-agent": "WhatsApp/2.24 A" } })).status).toBe(302);
    expect((await open(`/a/${CODE}`, { method: "HEAD" })).status).toBe(302);
    expect(await openedAt()).toBeNull();
  });

  it("answers 404 to a wrong code, a wrong shape or method, without a JSON body or the destination", async () => {
    for (const path of ["/a/AAAAAAAAAA", "/a/abc", `/a/${CODE}/`, "/a/", `/a/${CODE.toLowerCase()}`]) {
      const res = await open(path);
      expect(res.status, path).toBe(404);
      expect(res.headers.get("location")).toBeNull();
      expect(res.headers.get("content-type")).toContain("text/plain");
    }
    expect((await open(`/a/${CODE}`, { method: "POST", body: "x" })).status).toBe(404);
    expect(await openedAt()).toBeNull();
    // Anything in the address after the code is never a destination.
    expect((await open(`/a/${CODE}?next=https://exemplo.com.br`)).headers.get("location")).toBe(LINK);
  });

  it("is never redirected anywhere the database doesn't hold a Google review page for", async () => {
    await inOwner((agent) => agent.store.db.run(`UPDATE zur_review_locations SET review_uri = 'https://exemplo.com.br/avalie'`));
    expect((await open(`/a/${CODE}`)).status).toBe(404);
  });

  it("holds a network after 30 openings a minute (429)", async () => {
    let last = 0;
    for (let i = 0; i <= REVIEW_REQUEST_LIMITS.hitsPerMinute; i++) last = (await open("/a/BBBBBBBBBB")).status;
    expect(last).toBe(429);
    expect((await open(`/a/${CODE}`)).status).toBe(429);
    expect((await open(`/a/${CODE}`, { headers: { "cf-connecting-ip": "198.51.100.21" } })).status).toBe(302);
  });

  it("passes before Cloudflare Access, which the patient can't sign in to", async () => {
    const access = { ACCESS_TEAM_DOMAIN: "exemplo.cloudflareaccess.com", ACCESS_AUD: "a".repeat(64) };
    expect((await open(`/a/${CODE}`, {}, access)).status).toBe(302);
    // Access is on: the rest still needs it.
    expect((await open("/api/health", {}, access)).status).toBe(403);
    expect((await open("/avaliacoes", {}, access)).status).toBe(403);
  });

  it("can't be reached past the Worker: the internal route needs the Worker's own header", async () => {
    const res = await call(`${ORIGIN}/api/reviews/open/${CODE}`, { headers: { "x-zuri-client-review-open": "go", "cf-connecting-ip": IP } });
    expect(res.status).toBe(404);
    expect(await openedAt()).toBeNull();
  });
});

describe("/api/reviews/requests", () => {
  it("shows the list and the settings, stopped while the reviews are off", async () => {
    const page = (await (await api("GET", "/reviews/requests")).json()) as ReviewRequestsPage;
    expect(page).toMatchObject({ blocked: "reviews", items: [] });
    const settings = (await (await api("GET", "/reviews/requests/settings")).json()) as ReviewRequestSettings;
    expect(settings).toMatchObject({ link: { google: LINK, manual: null, location: "Exemplo Centro" }, shortBase: "zuri.exemplo.com.br/a/", days: 8, hour: "09:00", reminder: true });
  });

  it("changes the link only with the password typed recently, with a security alert", async () => {
    await inOwner((agent) => agent.store.db.run(`UPDATE zur_sessions SET confirmed_at = ?`, Date.now() - 16 * 60_000));
    const refused = await api("PUT", "/reviews/requests/link", { link: "https://g.page/r/outro/review" });
    expect((await errorBody(refused)).code).toBe("RECENT_AUTH_REQUIRED");
    expect(await inOwner((agent) => agent.store.db.one(`SELECT review_uri_manual FROM zur_review_locations`))).toEqual({ review_uri_manual: null });
    await inOwner((agent) => agent.store.db.run(`UPDATE zur_sessions SET confirmed_at = ?`, Date.now()));
    for (const link of ["http://g.page/r/x", "https://exemplo.com.br/r", "https://g.page/r/x y", 5]) {
      expect((await errorBody(await api("PUT", "/reviews/requests/link", { link }))).code, String(link)).toBe("VALIDATION_FAILED");
    }
    const saved = await api("PUT", "/reviews/requests/link", { link: " https://g.page/r/outro/review " });
    expect(saved.status).toBe(200);
    expect(((await saved.json()) as ReviewRequestSettings).link.manual).toBe("https://g.page/r/outro/review");
    expect(await inOwner((agent) => agent.store.db.all(`SELECT kind FROM zur_auth_events WHERE kind = 'review_link_changed'`))).toHaveLength(1);
    expect((await open(`/a/${CODE}`)).headers.get("location")).toBe("https://g.page/r/outro/review");
    expect((await api("PUT", "/reviews/requests/link", { link: null })).status).toBe(200);
    expect((await open(`/a/${CODE}`)).headers.get("location")).toBe(LINK);
  });

  it("checks the message and \"Quando pedir\"", async () => {
    for (const body of [{ message: "sem o link" }, { message: `${"a".repeat(501)} {link}` }, { days: 2 }, { days: 31 }, { hour: "05:59" }, { hour: "21:01" }, { other: 1 }, { message: "oi‮ {link}" }]) {
      expect((await errorBody(await api("PATCH", "/reviews/requests/settings", body))).code, JSON.stringify(body)).toBe("VALIDATION_FAILED");
    }
    const res = await api("PATCH", "/reviews/requests/settings", { message: "Oi, {primeiro_nome}.\r\nVeja: {link}  ", days: 3, hour: "21:00", reminder: false });
    expect(await res.json()).toMatchObject({ message: "Oi, {primeiro_nome}.\nVeja: {link}", days: 3, hour: "21:00", reminder: false });
    expect((await api("PATCH", "/reviews/requests/settings", { message: null, days: 8, hour: "09:00", reminder: true })).status).toBe(200);
  });

  it("refuses a send while stopped, and a choice for an unknown review", async () => {
    expect((await errorBody(await api("POST", "/reviews/requests/q1/send"))).code).toBe("NOT_FOUND");
    expect((await errorBody(await api("POST", "/reviews/requests/00000000-0000-4000-8000-000000000000/send"))).code).toBe("CONFLICT");
    expect((await errorBody(await api("POST", "/reviews/00000000-0000-4000-8000-000000000000/match", { contactId: null }))).code).toBe("NOT_FOUND");
    expect((await errorBody(await api("POST", "/reviews/00000000-0000-4000-8000-000000000000/match", { contactId: "x" }))).code).toBe("VALIDATION_FAILED");
  });
});
