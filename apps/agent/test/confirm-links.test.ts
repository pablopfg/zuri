import { AGENT_INSTANCE_NAME, type Clinic, SECURITY_ALERT_EVENTS, CONFIRM_LINK_LIMITS, type ConfirmLinkMade, type ConfirmLinkStatus, type ConfirmView, EVENT_STATUS_COLOR } from "@zuri/shared";
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
    for (const table of ["zur_google_calendars", "zur_google_account", "zur_appointment_links", "zur_confirm_sends", "zur_notices", "zur_auth_events"]) db.run(`DELETE FROM ${table}`);
    db.run(`DELETE FROM zur_settings WHERE key IN ('clinic', 'confirm_message', 'confirm_mail')`);
  }),
);

describe("E7c2: the confirmation e-mail", () => {
  type Mail = { to: string; subject: string; text: string; html: string };
  /** The links of the owner's object, with an e-mail way out of the test's own. */
  const deps = (agent: ZuriAgent): ConstructorParameters<typeof ConfirmLinks>[0] => ({
    db: agent.store.db,
    google: () => agent.store.google,
    timeZone: () => "America/Sao_Paulo",
    locale: () => "pt-BR",
    clinic: () => CLINIC,
    message: () => "",
    mailTemplate: () => ({ subject: "", body: "", button: "" }),
    sendMail: async () => ({ ok: true }),
    publicUrl: () => new URL(ORIGIN),
    credentialKey: testEnv.MCP_CREDENTIAL_KEY,
    secret: () => "segredo-de-teste",
    hours: () => agent.store.settings.field("agenda"),
    notify: () => {},
    lockdown: () => false,
  });
  const links = (agent: ZuriAgent, sent: Mail[], template = { subject: "", body: "", button: "" }, answer: () => { ok: true } | { ok: false; problem: "daily_limit" } = () => ({ ok: true })) =>
    new ConfirmLinks({
      db: agent.store.db,
      google: () => agent.store.google,
      timeZone: () => "America/Sao_Paulo",
      locale: () => "pt-BR",
      clinic: () => CLINIC,
      message: () => "",
      mailTemplate: () => template,
      sendMail: async (mail) => {
        const result = answer();
        if (result.ok) sent.push(mail);
        return result;
      },
      publicUrl: () => new URL(ORIGIN),
      credentialKey: testEnv.MCP_CREDENTIAL_KEY,
      secret: () => "segredo-de-teste",
      hours: () => agent.store.settings.field("agenda"),
      notify: () => {},
      lockdown: () => false,
    });

  it("sends the default e-mail to the appointment's e-mail, the link only in the button, and records it for that start", async () => {
    const event = seed(0, { start: { dateTime: "2099-12-10T14:00:00-03:00" }, end: { dateTime: "2099-12-10T15:00:00-03:00" } });
    const { sent, status, url } = await inOwner(async (agent) => {
      const sent: Mail[] = [];
      const status = await links(agent, sent).mail(WORK, event.id);
      const url = (await links(agent, []).link(WORK, event.id)).url;
      return { sent, status, url };
    });
    expect(sent).toHaveLength(1);
    const mail = sent[0] as Mail;
    expect(mail.to).toBe("paciente@exemplo.com.br");
    expect(mail.subject).toBe("Confirme sua consulta de quinta-feira, 10 de dezembro");
    expect(mail.text).toBe(
      `Olá, Beatriz!\n\nSua consulta no Consultório Exemplo está marcada para quinta-feira, 10 de dezembro, às 14:00.\nEndereço: Rua das Flores, 120, Curitiba, PR.\n\nToque no botão abaixo para confirmar sua presença. Se não puder vir, cancele pelo mesmo botão até quarta-feira, 9 de dezembro, às 23:59.\n\nPara mudar o dia ou o horário, fale com a nossa equipe pelo WhatsApp (41) 3333-0000.\n\nConfirmar presença: ${url}\n\n--\nConsultório Exemplo · Rua das Flores, 120, Curitiba, PR\nVocê recebeu este e-mail porque tem uma consulta marcada.\n`,
    );
    // The HTML: only the button is a link, to the patient's own page; no image.
    expect([...mail.html.matchAll(/<a /g)]).toHaveLength(1);
    expect(mail.html).toContain(`<a href="${url}"`);
    expect(mail.html).not.toMatch(/<img|<script/i);
    expect(status).toMatchObject({ sentChannel: "email", mailedStart: new Date("2099-12-10T17:00:00.000Z").toISOString() });
    expect(await inOwner((agent) => agent.store.db.all(`SELECT channel, start FROM zur_confirm_sends`))).toEqual([{ channel: "email", start: "2099-12-10T17:00:00.000Z" }]);
  });

  it("escapes what the owner and the event carry in the HTML, and keeps the subject on one line", async () => {
    const event = seed(0, { summary: "<script>x</script> Souza", start: { dateTime: "2099-12-11T09:00:00-03:00" }, end: { dateTime: "2099-12-11T10:00:00-03:00" } });
    const template = { subject: "Oi {nome}, {consultorio}", body: "Oi {nome} \"<i>aspas</i>\" & {consultorio}", button: "Vou <sim>" };
    const sent = await inOwner(async (agent) => {
      const sent: Mail[] = [];
      await links(agent, sent, template).mail(WORK, event.id);
      return sent;
    });
    const html = sent[0]?.html ?? "";
    expect(html).not.toMatch(/<script|<i>|<sim>/i);
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt;");
    expect(html).toContain("&quot;&lt;i&gt;aspas&lt;/i&gt;&quot; &amp; Consultório Exemplo");
    expect(html).toContain(">Vou &lt;sim&gt;</a>");
    expect(sent[0]?.subject).not.toMatch(/[\r\n]/);
  });

  it("a line separator the event carries into the subject becomes a space", async () => {
    const event = seed(0, { description: "Retorno\u2028curto | Consultório", start: { dateTime: "2099-12-14T09:00:00-03:00" }, end: { dateTime: "2099-12-14T10:00:00-03:00" } });
    const sent = await inOwner(async (agent) => {
      const sent: Mail[] = [];
      await links(agent, sent, { subject: "Sua {tipo}", body: "", button: "" }).mail(WORK, event.id);
      return sent;
    });
    expect(sent[0]?.subject).toBe("Sua retorno curto");
  });

  it("SEC-E7c2-04: one e-mail per start, even for two taps at once; a send that failed can be tried again", async () => {
    const event = seed(4 * 24 * HOUR);
    const failed = seed(4 * 24 * HOUR);
    const result = await inOwner(async (agent) => {
      const sent: Mail[] = [];
      const codeOf = (run: Promise<unknown>) => run.then(() => "ok", (error: { code?: string; messageKey?: string }) => `${error.code} ${error.messageKey}`);
      const both = await Promise.all([codeOf(links(agent, sent).mail(WORK, event.id)), codeOf(links(agent, sent).mail(WORK, event.id))]);
      const later = await codeOf(links(agent, sent).mail(WORK, event.id));
      const first = await codeOf(links(agent, [], undefined, () => ({ ok: false, problem: "daily_limit" })).mail(WORK, failed.id));
      const again = await codeOf(links(agent, sent).mail(WORK, failed.id));
      return { both: both.sort(), later, first, again, sent: sent.length };
    });
    expect(result.both).toEqual(["CONFLICT error.confirmMailed", "ok"]);
    expect(result.later).toBe("CONFLICT error.confirmMailed");
    expect(result.first).toBe("SERVICE_UNAVAILABLE error.confirmMailFailed");
    expect(result.again).toBe("ok");
    expect(result.sent).toBe(2);
  });

  it("the footer leaves out the clinic's name when there is none", async () => {
    const event = seed(0, { start: { dateTime: "2099-12-15T09:00:00-03:00" }, end: { dateTime: "2099-12-15T10:00:00-03:00" } });
    const sent = await inOwner(async (agent) => {
      const sent: Mail[] = [];
      await new ConfirmLinks({ ...deps(agent), clinic: () => ({ ...CLINIC, name: "" }), sendMail: async (mail) => {
          sent.push(mail);
          return { ok: true };
        },
      }).mail(WORK, event.id);
      return sent;
    });
    expect(sent[0]?.text).toMatch(/\n--\nRua das Flores, 120, Curitiba, PR\nVocê recebeu/);
  });

  it("without an e-mail on the appointment, with the e-mail not going out or for a cancelled one, nothing is recorded", async () => {
    const none = seed(3 * 24 * HOUR, { extendedProperties: { private: { zuriPhone: "41999990000" } } });
    const codes = await inOwner(async (agent) => {
      const codeOf = async (run: () => Promise<unknown>) => run().then(() => "ok", (error: { code?: string; details?: unknown }) => [error.code, error.details]);
      const capped = seed(3 * 24 * HOUR);
      const cancelled = seed(3 * 24 * HOUR, { colorId: EVENT_STATUS_COLOR.cancelled });
      return [
        await codeOf(() => links(agent, []).mail(WORK, none.id)),
        await codeOf(() => links(agent, [], undefined, () => ({ ok: false, problem: "daily_limit" })).mail(WORK, capped.id)),
        await codeOf(() => links(agent, []).mail(WORK, cancelled.id)),
      ];
    });
    expect(codes).toEqual([["CONFLICT", undefined], ["SERVICE_UNAVAILABLE", { problem: "daily_limit" }], ["CONFLICT", undefined]]);
    expect(await inOwner((agent) => agent.store.db.all(`SELECT * FROM zur_confirm_sends`))).toEqual([]);
    // Without an e-mail, no link is made for it either.
    expect(await inOwner((agent) => agent.store.db.all(`SELECT id FROM zur_appointment_links WHERE event_id = ?`, none.id))).toEqual([]);
  });

  it("the route sends only to the appointment's own e-mail: a recipient in the body is refused, and an e-mail not set up says so", async () => {
    const event = seed(3 * 24 * HOUR);
    expect((await api("POST", "/google/events/link/mail", { calendarId: WORK, eventId: event.id, to: "outro@exemplo.com.br" })).status).toBe(400);
    const res = await api("POST", "/google/events/link/mail", { calendarId: WORK, eventId: event.id });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "SERVICE_UNAVAILABLE", message: "O e-mail não saiu. Confira Integrações › E-mail para pacientes e tente de novo.", details: { problem: "not_configured" } });
    const none = seed(3 * 24 * HOUR, { extendedProperties: { private: {} } });
    expect(await (await api("POST", "/google/events/link/mail", { calendarId: WORK, eventId: none.id })).json()).toMatchObject({ code: "CONFLICT", message: "Este agendamento não tem o e-mail do paciente." });
  });

  it("SEC-E7c2: the server refuses an e-mail template out of the rules, field by field", async () => {
    const ok = { subject: "", body: "", button: "" };
    for (const confirmMail of [
      { ...ok, subject: "Oi\n{nome}" },
      { ...ok, subject: "Oi {local}" },
      { ...ok, subject: "x".repeat(121) },
      { ...ok, body: "Clique: {link}" },
      { ...ok, body: "Veja https://pix.exemplo.com.br" },
      { ...ok, body: "Ligue (41) 98888-7777" },
      { ...ok, body: "y".repeat(2001) },
      { ...ok, button: "z".repeat(31) },
      { ...ok, button: "   " },
      { ...ok, extra: "" },
    ]) {
      expect((await api("PATCH", "/settings", { confirmMail })).status, JSON.stringify(confirmMail).slice(0, 60)).toBe(400);
    }
    expect((await api("PATCH", "/settings", { confirmMail: { subject: "x".repeat(120), body: "y".repeat(2000), button: "z".repeat(30) } })).status).toBe(200);
  });
});

describe("E7c1: the confirmation message and the WhatsApp send", () => {
  const sent = (eventId: string, body: Record<string, unknown> = {}) => api("POST", "/google/events/link/sent", { calendarId: WORK, eventId, channel: "whatsapp", ...body });
  const status = async (eventId: string) => (await api("GET", `/google/events/link?calendarId=${encodeURIComponent(WORK)}&eventId=${eventId}`)).json() as Promise<ConfirmLinkStatus>;

  it("fills the default message for the appointment: first name, type, day, time, address, link, deadline, office and team", async () => {
    // Thursday 10/12/2099 at 14:00 in São Paulo: far ahead, so the clock of the test never reaches it.
    const event = seed(0, { start: { dateTime: "2099-12-10T14:00:00-03:00" }, end: { dateTime: "2099-12-10T15:00:00-03:00" } });
    const { made, url } = await linkOf(event);
    expect(made.message).toBe(
      `Olá, Beatriz! Sua *consulta* no *Consultório Exemplo* está marcada para *quinta-feira, 10 de dezembro, às 14:00*.\nEndereço: Rua das Flores, 120, Curitiba, PR.\n\nConfirme sua presença por este link:\n${url}\n\nSe não puder vir, cancele pelo mesmo link até quarta-feira, 9 de dezembro, às 23:59. Para mudar o dia ou o horário, fale com a nossa equipe: (41) 3333-0000.`,
    );
    // Never the rest of the title nor the notes of the event.
    for (const word of ["Novaes", "dipirona", "Dra"]) expect(made.message).not.toContain(word);
  });

  it("uses the owner's message, the Meet link of an online one, and keeps a variable a title carries as text", async () => {
    expect((await api("PATCH", "/settings", { confirmMessage: "{nome}|{tipo}|{local}|{link}|{prazo}|{whatsapp}" })).status).toBe(200);
    const online = seed(0, {
      summary: "{link} Souza",
      description: "Retorno | Online",
      start: { dateTime: "2099-12-10T09:00:00-03:00" },
      end: { dateTime: "2099-12-10T10:00:00-03:00" },
      hangoutLink: "https://meet.google.com/abc-defg-hij",
    });
    const { made, url } = await linkOf(online);
    expect(made.message).toBe(`{link}|retorno|Link da chamada (Google Meet): https://meet.google.com/abc-defg-hij|${url}|quarta-feira, 9 de dezembro, às 21:00|(41) 3333-0000`);
    // No call yet, and an office with no address: the line says so, or stays empty.
    const waiting = seed(0, { description: "Retorno | Online", start: { dateTime: "2099-12-11T09:00:00-03:00" }, end: { dateTime: "2099-12-11T10:00:00-03:00" } });
    expect((await linkOf(waiting)).made.message).toContain("|Atendimento online: o link da chamada chega antes da consulta.|");
    expect((await api("PATCH", "/settings", { clinic: { ...CLINIC, address: "", whatsapp: "" } })).status).toBe(200);
    const nowhere = seed(0, { start: { dateTime: "2099-12-12T09:00:00-03:00" }, end: { dateTime: "2099-12-12T10:00:00-03:00" } });
    expect((await linkOf(nowhere)).made.message).toMatch(/^Beatriz\|consulta\|\|https:.*\|$/);
    // Saving a message without {link} or with an unknown variable is refused; "" is back to the default.
    expect((await api("PATCH", "/settings", { confirmMessage: "Oi {nome}" })).status).toBe(400);
    expect((await api("PATCH", "/settings", { confirmMessage: "Oi {nome} {data} {link}" })).status).toBe(400);
    expect((await api("PATCH", "/settings", { confirmMessage: "" })).status).toBe(200);
    expect((await linkOf(nowhere)).made.message).toMatch(/^Olá, Beatriz!/);
  });

  it("with the office's details unfilled, the default leaves no empty bold, no stray colon and no run of blank lines", async () => {
    expect((await api("PATCH", "/settings", { clinic: { name: "", whatsapp: "", address: "", city: "" } })).status).toBe(200);
    const event = seed(0, { start: { dateTime: "2099-12-14T09:00:00-03:00" }, end: { dateTime: "2099-12-14T10:00:00-03:00" } });
    const { made, url } = await linkOf(event);
    expect(made.message).toBe(
      `Olá, Beatriz! Sua *consulta* no *consultório* está marcada para *segunda-feira, 14 de dezembro, às 09:00*.\n\nConfirme sua presença por este link:\n${url}\n\nSe não puder vir, cancele pelo mesmo link até domingo, 13 de dezembro, às 21:00. Para mudar o dia ou o horário, fale com a nossa equipe.`,
    );
  });

  it("SEC-E7c1-01/02/03: an address or a phone typed into the message is refused; one in the event or the office's name never goes in", async () => {
    for (const confirmMessage of ["Oi {nome}: {link} https://pix.exemplo.com.br", "Oi {nome}: {link} fale com (41) 98888-7777", "Oi\u202e {link}"]) {
      expect((await api("PATCH", "/settings", { confirmMessage })).status, confirmMessage).toBe(400);
    }
    expect((await api("PATCH", "/settings", { clinic: { ...CLINIC, name: "Consultório pix.exemplo.com" } })).status).toBe(200);
    const event = seed(0, {
      summary: "pix.exemplo.com Souza",
      description: "Consulta https://pix.exemplo.com.br",
      start: { dateTime: "2099-12-15T09:00:00-03:00" },
      end: { dateTime: "2099-12-15T10:00:00-03:00" },
    });
    const { made, url } = await linkOf(event);
    expect(made.message.replace(url, "")).not.toMatch(/pix|https?:/);
    expect(made.message).toMatch(/^Olá, ! Sua \*consulta\* no \*consultório\*/);
  });

  it("records the WhatsApp send for the current start, once a minute; a moved appointment is not sent yet", async () => {
    const event = seed(3 * 24 * HOUR);
    expect((await sent(event.id)).status).toBe(404);
    await linkOf(event);
    const first = await sent(event.id);
    expect(first.status).toBe(200);
    const after = (await first.json()) as ConfirmLinkStatus;
    expect(after).toMatchObject({ sentChannel: "whatsapp", sentStart: new Date(event.start.dateTime ?? "").toISOString() });
    expect(Date.now() - Date.parse(after.sentAt)).toBeLessThan(60_000);
    expect(await inOwner((agent) => agent.store.db.all(`SELECT channel FROM zur_confirm_sends`))).toEqual([{ channel: "whatsapp" }]);
    // Neither the text nor the phone is kept.
    const row = JSON.stringify(await inOwner((agent) => agent.store.db.all(`SELECT * FROM zur_confirm_sends`)));
    for (const word of ["41999990000", "Beatriz", "Olá"]) expect(row).not.toContain(word);
    // The same tap again within the minute writes nothing.
    const writes = await inOwner(async (agent) => {
      const before = agent.store.db.usage.rowsWritten;
      await agent.store.confirmLinks.sent(WORK, event.id, "whatsapp");
      return agent.store.db.usage.rowsWritten - before;
    });
    expect(writes).toBe(0);
    // Moved at Google: the send was for the old start.
    const original = new Date(event.start.dateTime ?? "").toISOString();
    const moved = new Date(Date.parse(event.start.dateTime ?? "") + 24 * HOUR).toISOString();
    const at = atGoogle(event.id);
    if (at) at.start = { dateTime: moved };
    expect((await status(event.id)).sentStart).toBe(original);
    expect((await sent(event.id)).status).toBe(200);
    expect((await status(event.id)).sentStart).toBe(moved);
    expect(await inOwner((agent) => agent.store.db.all(`SELECT start FROM zur_confirm_sends ORDER BY start`))).toHaveLength(2);
  });

  it("refuses a cancelled or expired appointment, an unknown channel and a body out of shape", async () => {
    const event = seed(3 * 24 * HOUR);
    await linkOf(event);
    expect((await sent(event.id, { channel: "email" })).status).toBe(400);
    expect((await sent(event.id, { extra: 1 })).status).toBe(400);
    const at = atGoogle(event.id);
    if (at) at.colorId = EVENT_STATUS_COLOR.cancelled;
    expect((await sent(event.id)).status).toBe(409);
    const soon = seed(30 * 60_000);
    // Made while it still could be, then past the hour before: gone.
    await inOwner((agent) => agent.store.db.run(`INSERT INTO zur_appointment_links (id, calendar_id, event_id, token_hash, token_sealed, created_at) VALUES ('old', ?, ?, 'h-old', 's', 1)`, WORK, soon.id));
    expect((await sent(soon.id)).status).toBe(409);
    expect(await inOwner((agent) => agent.store.db.all(`SELECT * FROM zur_confirm_sends`))).toEqual([]);
  });
});

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
    expect(await status.json()).toEqual({ made: false, answer: "none", answeredAt: "", answerStart: "", previousStart: "", sentChannel: "", sentAt: "", sentStart: "", mailedStart: "" });
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
      message: () => "",
      mailTemplate: () => ({ subject: "", body: "", button: "" }),
      sendMail: async () => ({ ok: true as const }),
      publicUrl: () => new URL(ORIGIN),
      credentialKey: testEnv.MCP_CREDENTIAL_KEY,
      secret: () => "segredo-de-teste",
      hours: () => agent.store.settings.field("agenda"),
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

describe("E7b: rescheduling by the link", () => {
  // Tuesday 01/12/2026, 09:00 in São Paulo: the window is Wed 02 to Wed 09, the weekend closed.
  const T = Date.parse("2026-12-01T12:00:00Z");
  const OFFICE = "consultorio@exemplo.com.br";
  const local = (day: string, time: string) => new Date(`${day}T${time}:00-03:00`).toISOString();
  /** An event at Google on the owner's wall clock. */
  const put = (calendar: string, day: string, from: string, to: string, extra: Partial<DevEvent> = {}): DevEvent => {
    const event: DevEvent = { id: `rm${n++}`, etag: `"r${n}"`, summary: "Carla Mendes Rocha", description: "Consulta | Consultório", start: { dateTime: local(day, from) }, end: { dateTime: local(day, to) }, ...extra };
    const list = google.events.get(calendar) ?? [];
    list.push(event);
    google.events.set(calendar, list);
    return event;
  };
  const links = (agent: ZuriAgent, clock = T, zone = "America/Sao_Paulo") =>
    new ConfirmLinks({
      db: agent.store.db,
      google: () => agent.store.google,
      timeZone: () => zone,
      locale: () => "pt-BR",
      clinic: () => CLINIC,
      message: () => "",
      mailTemplate: () => ({ subject: "", body: "", button: "" }),
      sendMail: async () => ({ ok: true as const }),
      publicUrl: () => new URL(ORIGIN),
      credentialKey: testEnv.MCP_CREDENTIAL_KEY,
      secret: () => "segredo-de-teste",
      hours: () => agent.store.settings.field("agenda"),
      notify: (notice) => notices.push(notice),
      lockdown: () => false,
      clock: () => clock,
    });
  let notices: { kind: string; from: string; when: string }[] = [];
  const codeOf = (error: unknown) => (error as { code?: string }).code ?? String(error);
  const keyOf = (error: unknown) => (error as { messageKey?: string }).messageKey ?? "";
  const fail = async (work: Promise<unknown>) => {
    try {
      await work;
    } catch (error) {
      return error;
    }
    throw new Error("expected a refusal");
  };

  beforeEach(async () => {
    notices = [];
    expect((await api("PATCH", `/google/calendars/${encodeURIComponent(OFFICE)}`, { mode: "read" })).status).toBe(200);
  });

  it("lists only the next 8 days with a free hour and their halves with one; meetings and calendars only read take time too", async () => {
    const mine = put(WORK, "2026-12-03", "10:00", "11:00");
    const { token } = await linkOf(mine);
    // Friday full with a meeting of a calendar the Zuri only reads; Monday's afternoon taken by an errand.
    put(OFFICE, "2026-12-04", "08:00", "18:00", { summary: "Congresso de nutrição", description: "" });
    put(WORK, "2026-12-07", "14:00", "18:00", { summary: "Dentista", description: "" });
    // Cancelled ones and all-day ones take nothing.
    put(WORK, "2026-12-08", "08:00", "18:00", { colorId: EVENT_STATUS_COLOR.cancelled });
    put(WORK, "2026-12-09", "08:00", "09:00", { start: { date: "2026-12-09" }, end: { date: "2026-12-10" }, description: "" });
    const days = await inOwner((agent) => links(agent).days(token, "net-a"));
    expect(days.length).toBe(60);
    expect(days.days.map((each) => each.day)).toEqual(["2026-12-02", "2026-12-03", "2026-12-07", "2026-12-08", "2026-12-09"]);
    expect(days.days.find((each) => each.day === "2026-12-07")?.turns.map((each) => each.turn)).toEqual(["morning"]);
    expect(days.days[0]?.turns).toEqual([
      { turn: "morning", from: 480, to: 720, hours: [480, 540, 600, 660] },
      { turn: "afternoon", from: 840, to: 1080, hours: [840, 900, 960, 1020] },
    ]);
    // Only days, halves and minutes: never a title, a type or how many.
    const text = JSON.stringify(days);
    for (const word of ["Congresso", "Dentista", "Carla", "Consulta"]) expect(text).not.toContain(word);
  });

  it("an event of centuries takes only the days asked, without a loop per day it lasts (security audit E7b-1)", async () => {
    const mine = put(WORK, "2026-12-03", "10:00", "11:00");
    const { token } = await linkOf(mine);
    // A stranger's invitation from year 100 to 9000: walked day by day, it would hold the object for minutes.
    put(OFFICE, "2026-12-01", "08:00", "18:00", { summary: "Convite", description: "", start: { dateTime: "0100-01-01T08:00:00-03:00" }, end: { dateTime: "9000-01-01T18:00:00-03:00" } });
    const started = performance.now();
    const days = await inOwner((agent) => links(agent).days(token, "net-z"));
    expect(days.days).toEqual([]);
    expect(performance.now() - started).toBeLessThan(2_000);
  });

  it("offers the hours next to an appointment, the same draw on a half without one, and never the appointment's own hour", async () => {
    const mine = put(WORK, "2026-12-03", "10:00", "11:00");
    const { token } = await linkOf(mine);
    put(WORK, "2026-12-07", "10:00", "11:00", { summary: "Diego Farias Lopes" });
    await inOwner(async (agent) => {
      const at = links(agent);
      expect(await at.offer({ token, day: "2026-12-07", turn: "morning", pref: 480 }, "net-b")).toEqual({ slots: [540, 660] });
      expect(await at.offer({ token, day: "2026-12-07", turn: "morning", pref: 660 }, "net-b")).toEqual({ slots: [660, 540] });
      // Its own day: 10:00 is no new hour; nothing else there, so a draw of 2, the same on every ask.
      const own = await at.offer({ token, day: "2026-12-03", turn: "morning", pref: 480 }, "net-b");
      expect(own.slots).toHaveLength(2);
      expect(own.slots).not.toContain(600);
      expect(await at.offer({ token, day: "2026-12-03", turn: "morning", pref: 660 }, "net-b")).toEqual(own);
      // Out of the window, or a half that doesn't exist that day: refused.
      for (const day of ["2026-12-01", "2026-12-10"]) expect(keyOf(await fail(at.offer({ token, day, turn: "morning", pref: 480 }, "net-b")))).toBe("error.rescheduleTaken");
    });
  });

  it("moves the same event, marks it Reagendado, keeps the link, rings the bell; twice at most", async () => {
    const mine = put(WORK, "2026-12-03", "10:00", "11:00");
    const { token } = await linkOf(mine);
    put(WORK, "2026-12-07", "10:00", "11:00", { summary: "Diego Farias Lopes" });
    const view = await inOwner((agent) => links(agent).reschedule({ token, day: "2026-12-07", turn: "morning", pref: 480, start: 540 }, "net-c"));
    expect(view).toMatchObject({ state: "rescheduled", start: local("2026-12-07", "09:00"), end: local("2026-12-07", "10:00"), canReschedule: true, canCancel: true });
    expect(atGoogle(mine.id)).toMatchObject({ colorId: EVENT_STATUS_COLOR.rescheduled, start: { dateTime: local("2026-12-07", "09:00") }, end: { dateTime: local("2026-12-07", "10:00") } });
    expect(google.events.get(WORK)?.filter((event) => event.summary === mine.summary)).toHaveLength(1);
    expect(notices).toEqual([expect.objectContaining({ kind: "rescheduled", from: expect.stringContaining("03/12"), when: expect.stringContaining("07/12") })]);
    const status = await api("GET", `/google/events/link?calendarId=${encodeURIComponent(WORK)}&eventId=${mine.id}`);
    expect(await status.json()).toMatchObject({ answer: "rescheduled", answerStart: local("2026-12-07", "09:00"), previousStart: local("2026-12-03", "10:00") });
    // Opened again, the same link says it moved; a second move, and then no more.
    expect(await inOwner((agent) => links(agent).view(token, "net-c"))).toMatchObject({ state: "rescheduled", canReschedule: true });
    const second = await inOwner(async (agent) => {
      const slot = (await links(agent).offer({ token, day: "2026-12-08", turn: "afternoon", pref: 840 }, "net-c")).slots[0] ?? 0;
      return links(agent).reschedule({ token, day: "2026-12-08", turn: "afternoon", pref: 840, start: slot }, "net-c");
    });
    expect(second).toMatchObject({ state: "rescheduled", canReschedule: false });
    const third = await inOwner((agent) => fail(links(agent).days(token, "net-c")));
    expect([codeOf(third), keyOf(third)]).toEqual(["CONFLICT", "error.rescheduleClosed"]);
    // The move itself, not only the listing: the third is refused and the event stays put.
    const thirdMove = await inOwner((agent) => fail(links(agent).reschedule({ token, day: "2026-12-09", turn: "morning", pref: 480, start: 480 }, "net-c")));
    expect([codeOf(thirdMove), keyOf(thirdMove)]).toEqual(["CONFLICT", "error.rescheduleClosed"]);
    expect(atGoogle(mine.id)?.start.dateTime).not.toContain("2026-12-09");
    expect(await inOwner((agent) => agent.store.db.one(`SELECT reschedules, answer_count FROM zur_appointment_links`))).toEqual({ reschedules: 2, answer_count: 2 });
  });

  it("refuses an hour the page never offered, and one taken since: the event stays where it was", async () => {
    const mine = put(WORK, "2026-12-03", "10:00", "11:00");
    const { token } = await linkOf(mine);
    put(WORK, "2026-12-07", "10:00", "11:00", { summary: "Diego Farias Lopes" });
    await inOwner(async (agent) => {
      // 08:00 is free but not offered (not next to Diego's appointment).
      expect(keyOf(await fail(links(agent).reschedule({ token, day: "2026-12-07", turn: "morning", pref: 480, start: 480 }, "net-d")))).toBe("error.rescheduleTaken");
    });
    put(OFFICE, "2026-12-07", "09:00", "10:00", { summary: "Ligação", description: "" });
    const taken = await inOwner((agent) => fail(links(agent).reschedule({ token, day: "2026-12-07", turn: "morning", pref: 480, start: 540 }, "net-d")));
    expect([codeOf(taken), keyOf(taken)]).toEqual(["CONFLICT", "error.rescheduleTaken"]);
    expect(atGoogle(mine.id)?.start.dateTime).toBe(local("2026-12-03", "10:00"));
    expect(atGoogle(mine.id)?.colorId).toBeUndefined();
    expect(notices).toEqual([]);
  });

  it("two patients after the same hour at once: one gets it, the other hears it was just taken", async () => {
    const first = put(WORK, "2026-12-03", "10:00", "11:00");
    const other = put(WORK, "2026-12-04", "15:00", "16:00", { summary: "Elisa Prado Campos" });
    const a = (await linkOf(first)).token;
    const b = (await linkOf(other)).token;
    put(WORK, "2026-12-07", "10:00", "11:00", { summary: "Diego Farias Lopes" });
    const results = await inOwner((agent) => {
      const shared = links(agent);
      return Promise.allSettled([
        shared.reschedule({ token: a, day: "2026-12-07", turn: "morning", pref: 480, start: 540 }, "net-e"),
        shared.reschedule({ token: b, day: "2026-12-07", turn: "morning", pref: 480, start: 540 }, "net-f"),
      ]);
    });
    expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
    const refused = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect(keyOf(refused.reason)).toBe("error.rescheduleTaken");
    const nine = google.events.get(WORK)?.filter((event) => event.start.dateTime === local("2026-12-07", "09:00"));
    expect(nine).toHaveLength(1);
  });

  it("past the cancel deadline, a cancelled or an expired appointment: no rescheduling, and the page says so", async () => {
    const mine = put(WORK, "2026-12-03", "10:00", "11:00");
    const { token } = await linkOf(mine);
    // 12 hours before 10:00 comes before 23:59 of the day before: 22:00 is the deadline, a minute later closed.
    const deadline = Date.parse(local("2026-12-02", "22:00"));
    await inOwner(async (agent) => {
      expect(await links(agent, deadline).view(token, "net-g")).toMatchObject({ canReschedule: true });
      const late = await links(agent, deadline + 60_000).view(token, "net-g");
      expect(late).toMatchObject({ canReschedule: false, canCancel: false });
      expect(keyOf(await fail(links(agent, deadline + 60_000).days(token, "net-g")))).toBe("error.rescheduleClosed");
    });
    const gone = put(WORK, "2026-12-04", "10:00", "11:00");
    const goneToken = (await linkOf(gone)).token;
    gone.colorId = EVENT_STATUS_COLOR.cancelled;
    expect(keyOf(await inOwner((agent) => fail(links(agent).days(goneToken, "net-g"))))).toBe("error.rescheduleClosed");
  });

  it("shares the network's limits: the days and the offer count as openings, the move as an answer", async () => {
    const mine = put(WORK, "2026-12-03", "10:00", "11:00");
    const { token } = await linkOf(mine);
    await inOwner(async (agent) => {
      const at = links(agent);
      for (let i = 0; i < CONFIRM_LINK_LIMITS.viewsPerWindow; i++) await at.view(token, "net-h");
      expect(codeOf(await fail(at.days(token, "net-h")))).toBe("RATE_LIMITED");
      expect(codeOf(await fail(at.offer({ token, day: "2026-12-07", turn: "morning", pref: 480 }, "net-h")))).toBe("RATE_LIMITED");
      // An unknown token in the days counts as a guess, as on the page.
      expect(codeOf(await fail(at.days("x".repeat(22), "net-i")))).toBe("NOT_FOUND");
      // The move is an answer: the network's answers spent, it is refused before reading Google.
      for (let i = 0; i < CONFIRM_LINK_LIMITS.answersPerWindow; i++) await at.answer(token, "confirm", "net-j");
      expect(codeOf(await fail(at.reschedule({ token, day: "2026-12-07", turn: "morning", pref: 480, start: 480 }, "net-j")))).toBe("RATE_LIMITED");
      // And the link's answers of the day, confirmations and moves together: the 11th is refused.
      agent.store.db.run(`UPDATE zur_appointment_links SET answer_day = ?, answer_count = ?`, "2026-12-01", CONFIRM_LINK_LIMITS.answersPerDay);
      const tooMany = await fail(at.reschedule({ token, day: "2026-12-07", turn: "morning", pref: 480, start: 480 }, "net-k"));
      expect([codeOf(tooMany), keyOf(tooMany)]).toEqual(["RATE_LIMITED", "error.confirmTooMany"]);
    });
    expect(atGoogle(mine.id)?.start.dateTime).toBe(local("2026-12-03", "10:00"));
  });

  it("only an appointment of 15 minutes to 4 hours moves by the link: 14, 15, 240 and 241 minutes", async () => {
    const lengths: [string, boolean][] = [
      ["10:14", false],
      ["10:15", true],
      ["14:00", true],
      ["14:01", false],
    ];
    for (const [end, can] of lengths) {
      const mine = put(WORK, "2026-12-03", "10:00", end);
      const { token } = await linkOf(mine);
      expect(await inOwner((agent) => links(agent).view(token, `net-l${end}`)), end).toMatchObject({ canReschedule: can });
    }
  });

  it("across the change to summer time in another zone: the days, the hours and the move keep the wall clock", async () => {
    // New York moves its clocks on Sunday 14/03/2027: Monday 15/03 is on −04:00, the days before on −05:00.
    const zone = "America/New_York";
    const ny = (day: string, time: string, offset: string) => new Date(`${day}T${time}:00${offset}`).toISOString();
    const clock = Date.parse(ny("2027-03-12", "09:00", "-05:00"));
    const at = (calendar: string, start: string, end: string, extra: Partial<DevEvent> = {}) => put(calendar, "2027-03-12", "10:00", "11:00", { start: { dateTime: start }, end: { dateTime: end }, ...extra });
    const mine = at(WORK, ny("2027-03-16", "15:00", "-04:00"), ny("2027-03-16", "16:00", "-04:00"));
    const { token } = await linkOf(mine);
    at(WORK, ny("2027-03-15", "10:00", "-04:00"), ny("2027-03-15", "11:00", "-04:00"), { summary: "Diego Farias Lopes" });
    // A meeting of a calendar only read, over the night of the change: Saturday 22:00 to Sunday 02:00.
    at(OFFICE, ny("2027-03-13", "22:00", "-05:00"), ny("2027-03-14", "03:00", "-04:00"), { summary: "Plantão", description: "" });
    const days = await inOwner((agent) => links(agent, clock, zone).days(token, "net-m"));
    expect(days.length).toBe(60);
    expect(days.days.map((each) => each.day)).toEqual(["2027-03-15", "2027-03-16", "2027-03-17", "2027-03-18", "2027-03-19"]);
    expect(days.days[0]?.turns[0]?.hours).toEqual([480, 540, 600, 660]);
    const offer = await inOwner((agent) => links(agent, clock, zone).offer({ token, day: "2027-03-15", turn: "morning", pref: 480 }, "net-m"));
    expect(offer.slots).toEqual([540, 660]);
    const moved = await inOwner((agent) => links(agent, clock, zone).reschedule({ token, day: "2027-03-15", turn: "morning", pref: 480, start: 540 }, "net-m"));
    expect(moved).toMatchObject({ state: "rescheduled", start: ny("2027-03-15", "09:00", "-04:00"), end: ny("2027-03-15", "10:00", "-04:00") });
  });

  it("the routes: public, by the token in the body, and refuse a body out of shape", async () => {
    const mine = put(WORK, "2026-12-03", "10:00", "11:00");
    const { token } = await linkOf(mine);
    const post = (path: string, body: unknown) => call(`${ORIGIN}/api/c/${path}`, { method: "POST", headers: headers(false, patientIp), body: JSON.stringify(body) });
    expect((await post("days", { token })).status).toBe(200);
    expect((await post("offer", { token, day: "2026-12-07", turn: "evening", pref: 480 })).status).toBe(400);
    expect((await post("offer", { token, day: "07/12/2026", turn: "morning", pref: 480 })).status).toBe(400);
    expect((await post("reschedule", { token, day: "2026-12-07", turn: "morning", pref: 480, start: 1_440 })).status).toBe(400);
    expect((await post("reschedule", { token, day: "2026-12-07", turn: "morning", pref: 480, start: 540, extra: 1 })).status).toBe(400);
  });
});
