import { AGENT_INSTANCE_NAME, GMAIL_SEND_SCOPE, MAIL_LIMITS, type MailStatus, type MailTest } from "@zuri/shared";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ZuriAgent } from "../src/agent/zuri-agent.ts";
import { InternalState } from "../src/db/internal-state.ts";
import { type DevGoogle, devGoogle, googleNetwork } from "../src/google/dev-google.ts";
import { type FakeSmtpLog, type FakeSmtpOptions, fakeSmtp } from "../src/mail/dev-mail.ts";
import { MailService } from "../src/mail/service.ts";
import { call, CSRF, HUMAN_TOKEN, ORIGIN, TEST_EMAIL, TEST_PASSWORD, signedCookies, testEnv } from "./helpers.ts";

// E6c (plano email-para-pacientes.md): Configurações › Integrações › E-mail. How e-mail to patients
// goes out (Gmail or SMTP), the test to the owner, the daily cap, and the password that never comes back.

const IP = "192.0.2.196";
const OWNER_EMAIL = "dono@exemplo.com.br";
const PASSWORD = "senha-de-app-exemplo";
let cookie = "";
let google: DevGoogle;
let smtp: FakeSmtpLog;
let dns: string[] = ["8.8.8.8"];
const owner = () => testEnv.AGENT.get(testEnv.AGENT.idFromName(AGENT_INSTANCE_NAME));
const inOwner = <T>(fn: (agent: ZuriAgent) => T | Promise<T>) => runInDurableObject(owner(), (agent: ZuriAgent) => fn(agent));
const headers = () => ({ ...CSRF, "content-type": "application/json", "cf-connecting-ip": IP, cookie });
const api = (method: string, path: string, body?: unknown) =>
  call(`${ORIGIN}/api${path}`, { method, headers: headers(), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const stale = () => inOwner((agent) => agent.store.db.run(`UPDATE zur_sessions SET confirmed_at = ?`, Date.now() - 16 * 60_000));

const SMTP = { host: "smtp.exemplo.com.br", port: 465, user: "contato@exemplo.com.br", from: "contato@exemplo.com.br" };
const saveSmtp = (patch: Record<string, unknown> = {}, smtpPatch: Record<string, unknown> = { password: PASSWORD }) =>
  api("PUT", "/mail", { mode: "smtp", name: "Consultório Exemplo", replyTo: "", smtp: { ...SMTP, ...smtpPatch }, ...patch });
const status = async () => (await (await api("GET", "/mail")).json()) as MailStatus;
const runTest = async () => {
  const res = await api("POST", "/mail/test");
  return { res, body: res.status === 200 ? ((await res.json()) as { test: MailTest; status: MailStatus }) : null };
};
const useSmtp = (options: FakeSmtpOptions = {}) =>
  inOwner((agent) => {
    const server = fakeSmtp(options);
    smtp = server.log;
    agent.store.mail.network = { connect: server.connect, resolve: async () => dns };
  });
const alerts = () => inOwner((agent) => agent.store.db.all(`SELECT kind FROM zur_auth_events WHERE kind = 'mail_changed'`));

async function connectGoogle(): Promise<void> {
  const begin = await api("POST", "/google/connect");
  const params = new URL(((await begin.json()) as { url: string }).url).searchParams;
  expect((await api("POST", "/google/callback", { state: params.get("state") ?? "", code: `dev.${params.get("code_challenge") ?? ""}` })).status).toBe(200);
}

async function allowGmail(): Promise<{ status: number; purpose?: string }> {
  const begin = await api("POST", "/mail/gmail/connect");
  expect(begin.status).toBe(200);
  const url = new URL(((await begin.json()) as { url: string }).url);
  expect(url.searchParams.get("scope")).toBe(GMAIL_SEND_SCOPE);
  const params = url.searchParams;
  const res = await api("POST", "/google/callback", { state: params.get("state") ?? "", code: `dev.${params.get("code_challenge") ?? ""}` });
  return { status: res.status, ...(res.status === 200 ? { purpose: ((await res.json()) as { purpose: string }).purpose } : {}) };
}

beforeAll(async () => {
  const res = await call(`${ORIGIN}/api/auth/login`, {
    method: "POST",
    headers: { ...CSRF, "content-type": "application/json", "cf-connecting-ip": IP },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD, turnstileToken: HUMAN_TOKEN }),
  });
  expect(res.status).toBe(200);
  cookie = signedCookies(res);
});

beforeEach(async () => {
  dns = ["8.8.8.8"];
  google = devGoogle({ clientId: testEnv.GOOGLE_CLIENT_ID, clientSecret: testEnv.GOOGLE_CLIENT_SECRET });
  await useSmtp();
  await inOwner((agent) => {
    agent.store.google.network = googleNetwork(google, { fetch: () => Promise.reject(new Error("no network in tests")) });
    agent.store.db.run(`UPDATE zur_sessions SET confirmed_at = ?`, Date.now());
  });
});

afterEach(async () => {
  await inOwner((agent) => {
    const { db } = agent.store;
    new InternalState(db).delete("google_oauth_pending");
    for (const table of ["zur_google_calendars", "zur_google_account", "zur_mail", "zur_auth_events"]) db.run(`DELETE FROM ${table}`);
  });
});

describe("E6c: saving how e-mail goes out", () => {
  it("starts off, saves the SMTP server, never answers the password and raises one security notice", async () => {
    const empty = await status();
    expect(empty).toMatchObject({ mode: "off", smtp: null, testTo: OWNER_EMAIL, sentToday: 0, perDay: MAIL_LIMITS.perDay, vault: true });
    const res = await saveSmtp();
    expect(res.status, await res.clone().text()).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(PASSWORD);
    expect(JSON.parse(text)).toMatchObject({ mode: "smtp", smtp: { ...SMTP, hasPassword: true, passwordEnd: "mplo" } });
    const row = await inOwner((agent) => agent.store.db.one<{ credential: string }>(`SELECT credential FROM zur_mail`));
    expect(row?.credential).not.toContain(PASSWORD);
    expect(await alerts()).toHaveLength(1);
    // Saving the same again changes nothing sensitive: no second notice.
    expect((await saveSmtp({}, {})).status).toBe(200);
    expect(await alerts()).toHaveLength(1);
    // The name patients see: a notice (QA-E6c-08).
    expect((await saveSmtp({ name: "Outro nome" }, {})).status).toBe(200);
    expect(await alerts()).toHaveLength(2);
    // The Reply-to decides where answers go: a notice.
    expect((await saveSmtp({ name: "Outro nome", replyTo: "equipe@exemplo.com.br" }, {})).status).toBe(200);
    expect(await alerts()).toHaveLength(3);
  });

  it("keeps a short password's end hidden", async () => {
    expect((await saveSmtp({}, { password: "curta123456" })).status).toBe(200);
    expect((await status()).smtp?.passwordEnd).toBeNull();
    expect((await saveSmtp({}, { password: "longa1234567" })).status).toBe(200);
    expect((await status()).smtp?.passwordEnd).toBe("4567");
  });

  it("asks for the password typed recently: 14:50 ago goes, 15:01 ago is refused and writes nothing", async () => {
    await inOwner((agent) => agent.store.db.run(`UPDATE zur_sessions SET confirmed_at = ?`, Date.now() - (14 * 60 + 50) * 1000));
    expect((await saveSmtp()).status).toBe(200);
    await inOwner((agent) => agent.store.db.run(`DELETE FROM zur_mail`));
    await inOwner((agent) => agent.store.db.run(`DELETE FROM zur_auth_events`));
    await inOwner((agent) => agent.store.db.run(`UPDATE zur_sessions SET confirmed_at = ?`, Date.now() - (15 * 60 + 1) * 1000));
    expect((await saveSmtp()).status).toBe(403);
    expect((await status()).mode).toBe("off");
    expect(await alerts()).toHaveLength(0);
    await stale();
    const res = await saveSmtp();
    expect(res.status).toBe(403);
    expect((await status()).mode).toBe("off");
    expect(await alerts()).toHaveLength(0);
    expect((await api("POST", "/mail/gmail/connect")).status).toBe(403);
  });

  it("asks for the password again when the server or the user changes", async () => {
    expect((await saveSmtp()).status).toBe(200);
    for (const moved of [{ host: "smtp2.exemplo.com.br" }, { user: "outro@exemplo.com.br" }]) {
      const res = await saveSmtp({}, moved);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { details?: { fields: string[] } }).details?.fields).toEqual(["smtp.password"]);
    }
    expect((await status()).smtp?.host).toBe(SMTP.host);
    // The port alone keeps the password.
    expect((await saveSmtp({}, { port: 587 })).status).toBe(200);
    expect((await status()).smtp).toMatchObject({ port: 587, hasPassword: true });
  });

  it("refuses an IP, a local name and a server whose name answers a private address", async () => {
    for (const host of ["192.168.0.10", "localhost", "smtp.local", "smtp"]) {
      const res = await saveSmtp({}, { host, password: PASSWORD });
      expect(res.status, host).toBe(400);
    }
    dns = ["10.0.0.5"];
    const res = await saveSmtp();
    expect(res.status).toBe(400);
    expect(((await res.json()) as { details?: { fields: string[] } }).details?.fields).toEqual(["smtp.host"]);
    expect((await status()).mode).toBe("off");
  });

  it("refuses hostile and oversized values naming only the field", async () => {
    const cases: [Record<string, unknown>, Record<string, unknown>][] = [
      [{ name: "a".repeat(MAIL_LIMITS.name + 1) }, {}],
      [{ name: "Consultório\r\nBcc: x@exemplo.com.br" }, {}],
      [{ replyTo: "x@exemplo.com.br\r\nBcc: y@exemplo.com.br" }, {}],
      [{}, { from: "<script>@exemplo.com.br" }],
      [{}, { password: "a".repeat(MAIL_LIMITS.password + 1) }],
      [{}, { port: 25 }],
      [{ mode: "smtp", smtp: undefined }, {}],
    ];
    const fields = [["name"], ["name"], ["replyTo"], ["smtp.from"], ["smtp.password"], ["smtp.port"], ["smtp"]];
    for (const [index, [patch, smtpPatch]] of cases.entries()) {
      const res = await saveSmtp(patch, { password: PASSWORD, ...smtpPatch });
      expect(res.status, JSON.stringify([patch, smtpPatch])).toBe(400);
      const text = await res.text();
      expect(text).not.toContain("script");
      expect((JSON.parse(text) as { details?: { fields: string[] } }).details?.fields, JSON.stringify([patch, smtpPatch])).toEqual(fields[index]);
    }
    // A body over 8 KB is refused before it is read.
    const large = await saveSmtp({ name: "a".repeat(9 * 1024) });
    expect(large.status).toBe(400);
    expect(await large.json()).toMatchObject({ details: { fields: ["_body"] } });
    expect((await status()).mode).toBe("off");
  });
});

describe("E6c: the Gmail way out", () => {
  it("refuses Gmail before the sending is allowed, then turns it on after Google's page", async () => {
    google.grant = ["https://www.googleapis.com/auth/calendar.calendarlist.readonly", "https://www.googleapis.com/auth/calendar.events"];
    await connectGoogle();
    expect((await status()).gmail).toMatchObject({ connected: true, granted: false });
    const refused = await api("PUT", "/mail", { mode: "gmail", name: "", replyTo: "" });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ code: "VALIDATION_FAILED", details: { fields: ["mode"] } });
    // Google's page grants less than asked: refused, nothing changes.
    expect((await allowGmail()).status).toBe(400);
    expect((await status()).mode).toBe("off");
    google.grant = null;
    expect(await allowGmail()).toEqual({ status: 200, purpose: "gmail" });
    expect((await status())).toMatchObject({ mode: "gmail", gmail: { granted: true } });
    const saved = await inOwner((agent) => agent.store.db.one<{ detail: string }>(`SELECT detail FROM zur_activity WHERE kind = 'mail.saved' ORDER BY rowid DESC LIMIT 1`));
    expect(JSON.parse(saved?.detail ?? "{}")).toEqual({ mode: "gmail", sensitive: true });
  });

  it("a way out already chosen stays when the sending is allowed later", async () => {
    await connectGoogle();
    expect((await saveSmtp()).status).toBe(200);
    expect((await allowGmail()).status).toBe(200);
    expect((await status()).mode).toBe("smtp");
  });

  it("sends the test by Gmail to the owner, with the account as the sender", async () => {
    await connectGoogle();
    expect((await api("PUT", "/mail", { mode: "gmail", name: "Consultório Exemplo", replyTo: "" })).status).toBe(200);
    const { body } = await runTest();
    expect(body?.test).toEqual({ ok: true, to: OWNER_EMAIL, via: "gmail" });
    const sent = google.seen.find((r) => r.url.includes("/gmail/v1/users/me/messages/send"));
    const raw = (JSON.parse(sent?.body ?? "{}") as { raw: string }).raw;
    expect(raw).not.toMatch(/[+/=]/);
    const data = atob(raw.replace(/-/g, "+").replace(/_/g, "/"));
    expect(data).toContain(`To: <${OWNER_EMAIL}>`);
    expect(body?.status.sentToday).toBe(1);
  });

  it("tells the scope was taken away at Google", async () => {
    await connectGoogle();
    expect((await api("PUT", "/mail", { mode: "gmail", name: "", replyTo: "" })).status).toBe(200);
    // The grant lost gmail.send (revoked at Google after it was allowed).
    await inOwner((agent) => {
      const row = agent.store.db.one<{ scopes: string }>(`SELECT scopes FROM zur_google_account`);
      agent.store.db.run(`UPDATE zur_google_account SET scopes = ?`, (row?.scopes ?? "").split(" ").filter((s) => s !== GMAIL_SEND_SCOPE).join(" "));
    });
    expect((await runTest()).body?.test).toEqual({ ok: false, problem: "gmail_scope" });
  });
});

describe("E6c: the test and the daily cap", () => {
  it("sends the test by SMTP to the owner only, with the office's name and the Reply-to", async () => {
    expect((await saveSmtp({ replyTo: "equipe@exemplo.com.br" })).status).toBe(200);
    const { body } = await runTest();
    expect(body?.test).toEqual({ ok: true, to: OWNER_EMAIL, via: "smtp" });
    expect(smtp.messages).toHaveLength(1);
    expect(smtp.messages[0]).toMatchObject({ from: SMTP.from, to: OWNER_EMAIL });
    expect(smtp.messages[0]?.data).toContain("Reply-To: <equipe@exemplo.com.br>");
    expect(smtp.messages[0]?.data).toMatch(/^From: =\?UTF-8\?B\?/m);
  });

  it("says why it didn't go, in a word the screen explains", async () => {
    expect((await runTest()).body?.test).toEqual({ ok: false, problem: "not_configured" });
    expect((await saveSmtp()).status).toBe(200);
    await useSmtp({ refuse: PASSWORD });
    expect((await runTest()).body?.test).toEqual({ ok: false, problem: "auth" });
    await useSmtp({ down: true });
    expect((await runTest()).body?.test).toEqual({ ok: false, problem: "unreachable" });
    // The server's name now answers a private address: blocked, nothing connects.
    await useSmtp();
    dns = ["127.0.0.1"];
    const blocked = await inOwner((agent) => agent.store.mail.send({ to: OWNER_EMAIL, subject: "s", text: "t" }));
    expect(blocked).toEqual({ ok: false, problem: "blocked" });
    expect(smtp.connects).toHaveLength(0);
  });

  it("the test goes to the address the first access stored, and nowhere without one", async () => {
    expect((await saveSmtp()).status).toBe(200);
    await inOwner(async (agent) => {
      expect(agent.store.mail.status().testTo).toBe(agent.store.auth.ownerEmail());
      const google = { connected: () => false, granted: () => false, accountEmail: () => null, gmailSend: async () => null };
      const server = fakeSmtp();
      const lone = new MailService(
        { db: agent.store.db, credentialKey: testEnv.MCP_CREDENTIAL_KEY, google: () => google, ownerEmail: () => "", timeZone: () => "America/Sao_Paulo", clinicName: () => "", development: () => false, lockdown: () => false },
        { connect: server.connect, resolve: async () => dns },
      );
      expect(await lone.test({ subject: "s", text: "t" })).toEqual({ ok: false, problem: "not_configured" });
      expect(server.log.connects).toHaveLength(0);
    });
  });

  it("587 without STARTTLS never sends the password", async () => {
    expect((await saveSmtp({}, { port: 587, password: PASSWORD })).status).toBe(200);
    await useSmtp({ starttls: false });
    expect((await runTest()).body?.test).toEqual({ ok: false, problem: "no_tls" });
    expect(smtp.lines.some((line) => line.text.includes(btoa(PASSWORD)) || line.text.startsWith("AUTH"))).toBe(false);
  });

  it("the password opens only for the server and the user it was saved with", async () => {
    expect((await saveSmtp()).status).toBe(200);
    await inOwner((agent) => agent.store.db.run(`UPDATE zur_mail SET smtp_user = 'outro@exemplo.com.br'`));
    expect((await runTest()).body?.test).toEqual({ ok: false, problem: "password" });
    expect(smtp.connects).toHaveLength(0);
    // Nothing went out: the patients' cap is untouched (QA-E6c-04).
    expect((await status()).sentToday).toBe(0);
  });

  it("allows 3 tests in 10 minutes, then asks to wait", async () => {
    expect((await saveSmtp()).status).toBe(200);
    for (let i = 0; i < MAIL_LIMITS.tests; i++) expect((await runTest()).res.status).toBe(200);
    const res = await api("POST", "/mail/test");
    expect(res.status).toBe(429);
    const body = (await res.json()) as { code: string; details?: { retryAfter: number } };
    expect(body.code).toBe("RATE_LIMITED");
    expect(body.details?.retryAfter).toBeGreaterThan(0);
    expect(body.details?.retryAfter).toBeLessThanOrEqual(600);
    expect(smtp.messages).toHaveLength(MAIL_LIMITS.tests);
  });

  it("tests have a cap of their own, 10 a day, so a stolen session can't spend the patients' (SEC-E6c-01)", async () => {
    expect((await saveSmtp()).status).toBe(200);
    const today = await inOwner((agent) => (agent.store.mail as unknown as { today(): string }).today());
    await inOwner((agent) => agent.store.db.run(`UPDATE zur_mail SET test_day = ?, test_count = ?`, today, MAIL_LIMITS.testsPerDay - 1));
    expect((await runTest()).body?.test).toMatchObject({ ok: true });
    const res = await api("POST", "/mail/test");
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ code: "RATE_LIMITED", details: { max: MAIL_LIMITS.testsPerDay } });
    expect(smtp.messages).toHaveLength(1);
    expect((await status()).sentToday).toBe(1);
    // Yesterday's tests don't count.
    await inOwner((agent) => agent.store.db.run(`UPDATE zur_mail SET test_day = '2000-01-01', test_times = ''`));
    expect((await runTest()).res.status).toBe(200);
  });

  it("sends nothing during a lockdown, and refuses a recipient that isn't a plain address (SEC-E6c-03, SEC-E6c-04)", async () => {
    expect((await saveSmtp()).status).toBe(200);
    for (const to of ["p@exemplo.com.br>\r\nBcc: <alvo@exemplo.com.br", "p@exemplo.com.br\nRCPT TO:<x@exemplo.com.br>", "a b@exemplo.com.br", ""]) {
      expect(await inOwner((agent) => agent.store.mail.send({ to, subject: "s", text: "t" })), JSON.stringify(to)).toEqual({ ok: false, problem: "refused" });
    }
    expect(smtp.connects).toHaveLength(0);
    expect((await status()).sentToday).toBe(0);
    await inOwner((agent) => {
      (agent.store.mail as unknown as { deps: { lockdown: () => boolean } }).deps.lockdown = () => true;
    });
    try {
      expect(await inOwner((agent) => agent.store.mail.send({ to: OWNER_EMAIL, subject: "s", text: "t" }))).toEqual({ ok: false, problem: "blocked" });
      expect(smtp.connects).toHaveLength(0);
    } finally {
      await inOwner((agent) => {
        (agent.store.mail as unknown as { deps: { lockdown: () => boolean } }).deps.lockdown = () => agent.store.auth.lockdown.active();
      });
    }
  });

  it("the day is the owner's: 23:30 in São Paulo counts on that day, midnight starts the next; the tests' window opens again after 10 minutes", async () => {
    await inOwner(async (agent) => {
      const clock = { now: Date.UTC(2026, 10, 14, 2, 30) };
      const google = { connected: () => false, granted: () => false, accountEmail: () => null, gmailSend: async () => null };
      const server = fakeSmtp();
      const mail = new MailService(
        { db: agent.store.db, credentialKey: testEnv.MCP_CREDENTIAL_KEY, google: () => google, ownerEmail: () => OWNER_EMAIL, timeZone: () => "America/Sao_Paulo", clinicName: () => "", development: () => false, lockdown: () => false, clock: () => clock.now },
        { connect: server.connect, resolve: async () => dns },
      );
      await mail.save({ mode: "smtp", name: "", replyTo: "", smtp: { ...SMTP, password: PASSWORD } }, { development: false });
      for (let i = 0; i < MAIL_LIMITS.tests; i++) expect(await mail.test({ subject: "s", text: "t" })).toMatchObject({ ok: true });
      expect(agent.store.db.one<{ sent_day: string }>(`SELECT sent_day FROM zur_mail`)?.sent_day).toBe("2026-11-13");
      await expect(mail.test({ subject: "s", text: "t" })).rejects.toMatchObject({ code: "RATE_LIMITED" });
      clock.now += MAIL_LIMITS.testWindowMs - 1_000;
      await expect(mail.test({ subject: "s", text: "t" })).rejects.toMatchObject({ code: "RATE_LIMITED" });
      clock.now = Date.UTC(2026, 10, 14, 3, 0);
      expect(mail.status().sentToday).toBe(0);
      expect(await mail.test({ subject: "s", text: "t" })).toMatchObject({ ok: true });
      expect(mail.status().sentToday).toBe(1);
      expect(server.log.messages).toHaveLength(MAIL_LIMITS.tests + 1);
    });
  });

  it("a password can't be kept without the installation's key", async () => {
    await inOwner(async (agent) => {
      const google = { connected: () => false, granted: () => false, accountEmail: () => null, gmailSend: async () => null };
      const mail = new MailService(
        { db: agent.store.db, credentialKey: undefined, google: () => google, ownerEmail: () => OWNER_EMAIL, timeZone: () => "America/Sao_Paulo", clinicName: () => "", development: () => false, lockdown: () => false },
        { connect: fakeSmtp().connect, resolve: async () => dns },
      );
      expect(mail.status().vault).toBe(false);
      await expect(mail.save({ mode: "smtp", name: "", replyTo: "", smtp: { ...SMTP, password: PASSWORD } }, { development: false })).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
      expect(agent.store.db.all(`SELECT id FROM zur_mail`)).toEqual([]);
    });
  });

  it("stops at the daily cap: n−1 goes, n goes, n+1 doesn't", async () => {
    expect((await saveSmtp()).status).toBe(200);
    const send = () => inOwner((agent) => agent.store.mail.send({ to: OWNER_EMAIL, subject: "s", text: "t" }));
    const today = (await status()).sentToday;
    expect(today).toBe(0);
    await inOwner((agent) => {
      const day = agent.store.db.one<{ sent_day: string | null }>(`SELECT sent_day FROM zur_mail`)?.sent_day;
      expect(day).toBeNull();
    });
    // Set the count right before the cap, on today's date.
    await send();
    await inOwner((agent) => agent.store.db.run(`UPDATE zur_mail SET sent_count = ?`, MAIL_LIMITS.perDay - 2));
    expect(await send()).toMatchObject({ ok: true });
    expect((await status()).sentToday).toBe(MAIL_LIMITS.perDay - 1);
    expect(await send()).toMatchObject({ ok: true });
    expect((await status()).sentToday).toBe(MAIL_LIMITS.perDay);
    const before = smtp.messages.length;
    expect(await send()).toEqual({ ok: false, problem: "daily_limit" });
    expect(smtp.messages).toHaveLength(before);
    // A new day starts the count again.
    await inOwner((agent) => agent.store.db.run(`UPDATE zur_mail SET sent_day = '2000-01-01'`));
    expect((await status()).sentToday).toBe(0);
    expect(await send()).toMatchObject({ ok: true });
    expect((await status()).sentToday).toBe(1);
  });

  it("two sends at once never pass the cap", async () => {
    expect((await saveSmtp()).status).toBe(200);
    await inOwner((agent) => agent.store.mail.send({ to: OWNER_EMAIL, subject: "s", text: "t" }));
    await inOwner((agent) => agent.store.db.run(`UPDATE zur_mail SET sent_count = ?`, MAIL_LIMITS.perDay - 1));
    const results = await Promise.all([0, 1, 2].map(() => inOwner((agent) => agent.store.mail.send({ to: OWNER_EMAIL, subject: "s", text: "t" }))));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect((await status()).sentToday).toBe(MAIL_LIMITS.perDay);
  });
});
