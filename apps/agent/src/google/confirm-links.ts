import {
  type AgendaPrefs,
  type Clinic,
  dayPlus,
  CONFIRM_LINK_LIMITS as L,
  CONFIRM_TOKEN,
  OUTBOX_LIMITS,
  COUNTRY_DIAL,
  type ConfirmAction,
  type ConfirmAnswer,
  type ConfirmChannel,
  type ConfirmLinkMade,
  type ConfirmLinkStatus,
  type ConfirmView,
  clinicLocation,
  EVENT_STATUS_COLOR,
  eventStatus,
  type ConfirmMail,
  type ConfirmMessageVars,
  confirmValueOk,
  escapeHtml,
  fillConfirmMessage,
  isMailAddress,
  type MailProblem,
  GOOGLE_LIMITS,
  HOME_COUNTRY,
  nationalHoliday,
  hmacSha256Hex,
  type RescheduleDays,
  type RescheduleOffer,
  type RescheduleTurn,
  randomToken,
  sha256Hex,
  t,
  typeLine,
  zonedParts,
} from "@zuri/shared";
import type { Database } from "../db/database.ts";
import { AppError } from "../http/errors.ts";
import { McpCredentials } from "../mcp/credentials.ts";
import { bound, minuteOf } from "./booking.ts";
import { type CalendarEvent, localInstant, localToday, nextDay } from "./events.ts";
import { type Busy, freeIn, gridOf, offerOf, type TurnWindow, turnsOf } from "./reschedule.ts";
import { type GoogleCalendar, GoogleError, GoogleMeter } from "./service.ts";

/**
 * The patient's confirmation link (E7a, docs/planos/link-de-confirmacao.md): one token per
 * appointment, found only by its SHA-256. Opening shows; only a tap changes the event's color at
 * Google. A stranger's tries are counted in memory and write nothing.
 */

interface LinkRow {
  id: string;
  calendar_id: string;
  event_id: string;
  token_sealed: string;
  answer: string | null;
  answer_start: string | null;
  answered_at: number | null;
  revoked_at: number | null;
  answer_day: string | null;
  answer_count: number;
  reschedules: number;
  previous_start: string | null;
}

export interface ConfirmNotice {
  kind: "confirmed" | "cancelled" | "rescheduled";
  name: string;
  when: string;
  /** The start before a move by the link, formatted as `when`; "" otherwise. */
  from: string;
}

export interface ConfirmLinkDeps {
  db: Database;
  google: () => Pick<GoogleCalendar, "event" | "updateEvent" | "usable" | "connected" | "calendar" | "readable" | "writable" | "events">;
  /** The opening hours, lunch and days off (Configurações › Agenda): the one source of the booking rule. */
  hours: () => AgendaPrefs;
  timeZone: () => string;
  locale: () => string;
  clinic: () => Clinic;
  /** The confirmation message of Configurações › Consultório (E7c1); "" is the catalog's default. */
  message: () => string;
  /** The confirmation e-mail of Integrações › E-mail para pacientes (E7c2); each "" is its default. */
  mailTemplate: () => ConfirmMail;
  /** MailService.send() of E6c: the saved way out, inside its daily cap. */
  sendMail: (message: { to: string; subject: string; text: string; html: string }) => Promise<{ ok: true } | { ok: false; problem: MailProblem }>;
  publicUrl: () => URL;
  credentialKey: string | undefined;
  /** The key of the networks' prints (HMAC), never kept. */
  secret: () => string;
  notify: (notice: ConfirmNotice) => void;
  /** Nothing changes during a lockdown (/bloquear). */
  lockdown: () => boolean;
  /** The automatic confirmation's hour while it is on for real (E7c3a), "" otherwise. */
  autoHour: () => string;
  clock?: () => number;
}

/** Google's reads and writes for one request: the event, a change, and once more after a 412. */
const BUDGET = 4;
/** Rescheduling: the event, one listing per calendar read, the change and a 412's second try. */
const MOVE_BUDGET = 4 + GOOGLE_LIMITS.listCalendars;
/** Distinct networks kept in memory; past it every new one waits, so a flood can't grow the object. */
const NETWORKS_MAX = 5_000;

type Resolved = { kind: "invalid" } | { kind: "expired"; event?: CalendarEvent; row: LinkRow } | { kind: "live"; event: CalendarEvent; row: LinkRow };

/** The first word of the title, without "Dr." or "Dra.": the page never shows the full name. */
export function firstName(title: string): string {
  const word = title.replace(/^\s*dra?\.?\s+/i, "").trim().split(/\s+/)[0] ?? "";
  return [...word].slice(0, 40).join("");
}

/** An empty value leaves no "**", no ": ." and no run of blank lines behind (the clinic's details may be unfilled). */
function tidy(filled: string): string {
  return filled
    .replace(/\*[ \t]*\*/g, "")
    .replace(/[ \t]*:[ \t]*\./g, ".")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Whether the type line ends in "| Online". */
const onlineLine = (description: string) => /\|\s*Online\s*$/i.test(typeLine(description));

export class ConfirmLinks {
  readonly #vault: McpCredentials;
  #window = -1;
  #views = new Map<string, number>();
  #answers = new Map<string, number>();
  #invalid = new Map<string, number>();
  #blocked = new Map<string, number>();
  /** One move at a time in the whole object: two patients never get the same hour. */
  #moving: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: ConfirmLinkDeps) {
    this.#vault = new McpCredentials(deps.credentialKey, "confirm-link-v1");
  }

  private now(): number {
    return this.deps.clock?.() ?? Date.now();
  }

  // ---------- The owner, in the Agenda's details ----------

  /** The link's state for an appointment, without making one. */
  status(calendarId: string, eventId: string): ConfirmLinkStatus {
    const row = this.row(`calendar_id = ? AND event_id = ?`, calendarId, eventId);
    return this.statusOf(row);
  }

  /** The link of an appointment, made the first time: the same address every time after. */
  async link(calendarId: string, eventId: string): Promise<ConfirmLinkMade> {
    const { event, row, url } = await this.made(calendarId, eventId);
    return { ...this.statusOf(row), url, message: this.message(event, url) };
  }

  /**
   * "Enviar por e-mail" (E7c2): the e-mail of the template, to the patient's e-mail kept on the
   * appointment (never one the request names), with the link as the button. Recorded only when it went.
   */
  async mail(calendarId: string, eventId: string): Promise<ConfirmLinkStatus> {
    // Without an e-mail, no link is made for it (P4).
    const { event, row, url } = await this.made(calendarId, eventId, (found) => {
      if (!isMailAddress((found.email ?? "").trim().toLowerCase())) throw new AppError("CONFLICT", "error.confirmNoEmail");
    });
    const to = (event.email ?? "").trim().toLowerCase();
    // Once per start (SEC-E7c2-04): the send is claimed before it goes, so two taps or two tabs send
    // one e-mail, and a session that isn't the owner's can't spend the day's cap on one patient. A
    // moved appointment has a new start and sends again. A send that fails gives the claim back.
    const claimed = this.deps.db.run(
      `INSERT INTO zur_confirm_sends (link_id, start, channel, sent_at) VALUES (?, ?, 'email', ?) ON CONFLICT (link_id, start, channel) DO NOTHING`,
      row.id,
      event.start,
      this.now(),
    );
    if (claimed.rowsWritten === 0) throw new AppError("CONFLICT", "error.confirmMailed");
    const sent = await this.deps.sendMail({ to, ...this.mailOf(event, url) }).catch(() => ({ ok: false as const, problem: "unreachable" as const }));
    if (!sent.ok) {
      this.deps.db.run(`DELETE FROM zur_confirm_sends WHERE link_id = ? AND start = ? AND channel = 'email'`, row.id, event.start);
      throw new AppError("SERVICE_UNAVAILABLE", "error.confirmMailFailed", { problem: sent.problem });
    }
    return this.statusOf(row);
  }

  /** The appointment and its link, made the first time. */
  private async made(calendarId: string, eventId: string, check?: (event: CalendarEvent) => void): Promise<{ event: CalendarEvent; row: LinkRow; url: string }> {
    if (!this.#vault.available) throw new AppError("NOT_CONFIGURED");
    // The patient's tap changes the event: a calendar the Zuri only reads has no link to give.
    if (!this.canWrite(calendarId)) throw new AppError("CONFLICT", "error.confirmLinkReadOnly");
    const event = await this.deps.google().event(calendarId, eventId, new GoogleMeter(BUDGET));
    if (!isAppointment(event)) throw new AppError("VALIDATION_FAILED", "error.confirmLinkNotAppointment");
    const row = this.row(`calendar_id = ? AND event_id = ?`, calendarId, eventId);
    if (row?.revoked_at || event.colorId === EVENT_STATUS_COLOR.cancelled || this.expiresAt(event) <= this.now()) {
      throw new AppError("CONFLICT", "error.confirmLinkGone");
    }
    check?.(event);
    return { event, ...(await this.linkOf(calendarId, eventId, row)) };
  }

  /** The link of an appointment already checked, made the first time: the same address every time after. */
  private async linkOf(calendarId: string, eventId: string, found: LinkRow | null): Promise<{ row: LinkRow; url: string }> {
    let row = found;
    let token: string | null = null;
    if (row) token = await this.#vault.decrypt(row.id, row.token_sealed);
    else {
      const id = randomToken(12);
      token = randomToken(16);
      const sealed = await this.#vault.encrypt(id, token);
      const hash = await sha256Hex(token);
      // Two taps at once: the second finds the first's row and sends the same address.
      this.deps.db.run(
        `INSERT INTO zur_appointment_links (id, calendar_id, event_id, token_hash, token_sealed, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (calendar_id, event_id) DO NOTHING`,
        id,
        calendarId,
        eventId,
        hash,
        sealed,
        this.now(),
      );
      row = this.row(`calendar_id = ? AND event_id = ?`, calendarId, eventId);
      if (row && row.id !== id) token = await this.#vault.decrypt(row.id, row.token_sealed);
    }
    // A key changed since: the old address can't be rebuilt, so this one says so instead of a wrong link.
    if (!row || !token) throw new AppError("NOT_CONFIGURED");
    return { row, url: `${this.deps.publicUrl().origin}/c/${token}` };
  }

  // ---------- The automatic confirmation (E7c3a) ----------

  /**
   * The appointments whose working eve is `day` (the last working day before them): from tomorrow to
   * the end of the next working day, so Friday covers the weekend and Monday. Only the ones still to
   * ask: a type, Agendado or Reagendado, a mobile, a calendar the Zuri writes, the link still valid
   * and no answer or send for that start, by any channel. Live, each with its link and the message of
   * the WhatsApp button; a rehearsal (`make` false) makes no link and reads only who.
   */
  async eve(day: string, make: boolean, max = Number.POSITIVE_INFINITY): Promise<EveItem[]> {
    const google = this.deps.google();
    if (!this.#vault.available || !google.connected()) return [];
    const zone = this.deps.timeZone();
    const first = nextDay(day);
    let last = first;
    while (!workingDay(last)) last = nextDay(last);
    const from = localInstant(first, zone);
    const to = localInstant(nextDay(last), zone);
    const open = google.writable().slice(0, GOOGLE_LIMITS.listCalendars);
    if (!from || !to || open.length === 0) return [];
    const { events } = await google.events(open, from, to, new GoogleMeter(GOOGLE_LIMITS.listCalendars * 2), { timeZone: zone, perCalendar: 250, max: 1_000 });
    const now = this.now();
    const out: EveItem[] = [];
    for (const event of events) {
      const status = eventStatus(event.colorId);
      if (!isAppointment(event) || (status !== "scheduled" && status !== "rescheduled") || this.expiresAt(event) <= now) continue;
      const phone = e164(event);
      if (!phone || !this.canWrite(event.calendarId)) continue;
      const row = this.row(`calendar_id = ? AND event_id = ?`, event.calendarId, event.id);
      if (row && (row.revoked_at || this.answeredFor(row, event.start) || this.sentFor(row.id, event.start))) continue;
      if (out.length >= max) break;
      const notAfter = new Date(this.expiresAt(event)).toISOString();
      // SEC-E7c3a-03: the contact's name at Chatwoot and in the history is the first name only, as in the
      // message: the title may carry a treatment or a note. Without a usable one, the number stands in.
      const name = firstName(event.title);
      const label = name && confirmValueOk(name) ? name : phone;
      if (!make) {
        const print = (await sha256Hex(`${event.calendarId}\n${event.id}`)).slice(0, 24);
        out.push({ key: `${print}:${event.start}`, label, phone, text: "", notAfter });
        continue;
      }
      // SEC-E7c3a-02: a message the queue would refuse (the template near its limit, filled) is left to the
      // buttons, before a link is made, instead of stopping the day's run. The link's length is fixed.
      if ([...this.message(event, `${this.deps.publicUrl().origin}/c/${"x".repeat(TOKEN_CHARS)}`)].length > OUTBOX_LIMITS.text) continue;
      const { row: link, url } = await this.linkOf(event.calendarId, event.id, row);
      out.push({ key: confirmKey(link.id, event.start), label, phone, text: this.message(event, url), notAfter });
    }
    return out;
  }

  /** The patient answered by the link for this start (a cancellation, for any). */
  private answeredFor(row: LinkRow, start: string): boolean {
    return row.answer === "cancelled" || (row.answer !== null && row.answer_start === start);
  }

  /** The owner already sent for this start, by the WhatsApp button or by e-mail. */
  private sentFor(linkId: string, start: string): boolean {
    return this.deps.db.one(`SELECT 1 AS hit FROM zur_confirm_sends WHERE link_id = ? AND start = ? LIMIT 1`, linkId, start) !== null;
  }

  /**
   * The owner sent the confirmation (E7c1), now, for the start the event has at Google now: a moved
   * appointment sends again. Only for a link already made; the same tap within a minute writes nothing.
   */
  async sent(calendarId: string, eventId: string, channel: ConfirmChannel): Promise<ConfirmLinkStatus> {
    const row = this.row(`calendar_id = ? AND event_id = ?`, calendarId, eventId);
    if (!row) throw new AppError("NOT_FOUND", "error.confirmLinkGone");
    const event = await this.deps.google().event(calendarId, eventId, new GoogleMeter(BUDGET));
    if (row.revoked_at || !isAppointment(event) || event.colorId === EVENT_STATUS_COLOR.cancelled || this.expiresAt(event) <= this.now()) {
      throw new AppError("CONFLICT", "error.confirmLinkGone");
    }
    this.record(row.id, event.start, channel);
    return this.statusOf(row);
  }

  /** One send for a start and a channel; the same one again within a minute writes nothing (P4). */
  private record(linkId: string, start: string, channel: ConfirmChannel): void {
    this.deps.db.run(
      `INSERT INTO zur_confirm_sends (link_id, start, channel, sent_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (link_id, start, channel) DO UPDATE SET sent_at = excluded.sent_at WHERE excluded.sent_at - sent_at >= 60000`,
      linkId,
      start,
      channel,
      this.now(),
    );
  }

  /**
   * The values of the variables for one appointment, in the owner's language and zone. What the event
   * or the clinic's details carry goes in only without an address (SEC-E7c1-02/03).
   */
  private values(event: CalendarEvent, url: string): ConfirmMessageVars {
    const locale = this.deps.locale();
    const zone = this.deps.timeZone();
    const clinic = this.deps.clinic();
    const day = (at: Date) => new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", timeZone: zone }).format(at);
    const time = (at: Date) => new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", timeZone: zone }).format(at);
    const start = new Date(event.start);
    const until = new Date(this.cancelUntil(event));
    const meet = event.meet && event.meet !== "pending" && event.meet !== "failed" ? event.meet : "";
    const place = clinicLocation(clinic);
    const local = onlineLine(event.description)
      ? meet
        ? t(locale, "confirm.message.meet", { url: meet })
        : t(locale, "confirm.message.online")
      : place && confirmValueOk(place)
        ? t(locale, "confirm.message.address", { place })
        : "";
    const plain = (value: string) => (confirmValueOk(value) ? value : "");
    const kind = plain((typeLine(event.description).split("|")[0] ?? "").trim().slice(0, 80).toLocaleLowerCase(locale));
    return {
      nome: plain(firstName(event.title)),
      tipo: kind || t(locale, "confirm.message.type"),
      dia: day(start),
      hora: time(start),
      local,
      link: url,
      prazo: t(locale, "confirm.message.deadline", { day: day(until), time: time(until) }),
      consultorio: plain(clinic.name) || t(locale, "confirm.message.clinic"),
      whatsapp: phoneText(clinic.whatsapp),
    };
  }

  /**
   * The message of Configurações › Consultório for one appointment. Only the known variables are put
   * in, once (fillConfirmMessage): the event's title stays text.
   */
  private message(event: CalendarEvent, url: string): string {
    const text = this.deps.message() || t(this.deps.locale(), "confirm.message.default");
    return tidy(fillConfirmMessage(text, this.values(event, url)));
  }

  /**
   * The confirmation e-mail (E7c2): the text, and the same as HTML with every value escaped, where only
   * the button is markup, a link to the patient's own page. No image, nothing that tracks.
   */
  private mailOf(event: CalendarEvent, url: string): { subject: string; text: string; html: string } {
    const locale = this.deps.locale();
    const template = this.deps.mailTemplate();
    const values = this.values(event, url);
    const subject = tidy(fillConfirmMessage(template.subject || t(locale, "confirm.mail.subject"), values)).replace(/\s+/g, " ");
    const body = tidy(fillConfirmMessage(template.body || t(locale, "confirm.mail.body"), values));
    const button = template.button || t(locale, "confirm.mail.button");
    const clinic = this.deps.clinic();
    const place = clinicLocation(clinic);
    // Without the clinic's name, the footer doesn't stand "consultório" alone on a line.
    const footer = [[clinic.name.trim() ? values.consultorio : "", place && confirmValueOk(place) ? place : ""].filter(Boolean).join(" · "), t(locale, "confirm.mail.footer")].filter(Boolean);
    const text = `${body}\n\n${button}: ${url}\n\n--\n${footer.join("\n")}\n`;
    const lines = (value: string) => escapeHtml(value).replace(/\n/g, "<br>\n");
    const html = [
      // nosemgrep: html-in-template-string -- every value passes escapeHtml (lines() escapes too); the markup is fixed
      `<!doctype html><html lang="${escapeHtml(locale)}"><body style="margin:0;padding:24px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#1f2328;background:#ffffff">`,
      // nosemgrep: html-in-template-string -- every value passes escapeHtml (lines() escapes too); the markup is fixed
      `<p style="margin:0 0 20px">${lines(body)}</p>`,
      // nosemgrep: html-in-template-string -- every value passes escapeHtml (lines() escapes too); the markup is fixed
      `<p style="margin:0 0 24px"><a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 20px;border-radius:8px;background:#1a7f4b;color:#ffffff;font-weight:bold;text-decoration:none">${escapeHtml(button)}</a></p>`,
      // nosemgrep: html-in-template-string -- every value passes escapeHtml (lines() escapes too); the markup is fixed
      `<p style="margin:0;font-size:13px;color:#57606a">${footer.map(lines).join("<br>\n")}</p>`,
      "</body></html>",
    ].join("\n");
    return { subject, text, html };
  }

  private statusOf(row: LinkRow | null): ConfirmLinkStatus {
    const answer: ConfirmAnswer = row?.answer === "confirmed" || row?.answer === "cancelled" || row?.answer === "rescheduled" ? row.answer : "none";
    // Every send of the link at once (one per start and channel: a handful), the last of each kind picked here.
    const sends = row ? this.deps.db.all<{ start: string; channel: string; sent_at: number }>(`SELECT start, channel, sent_at FROM zur_confirm_sends WHERE link_id = ?`, row.id) : [];
    const last = (channel?: string) => sends.filter((send) => !channel || send.channel === channel).reduce<(typeof sends)[number] | null>((best, send) => (!best || send.sent_at > best.sent_at ? send : best), null);
    const sent = last();
    const mailed = last("email");
    // The automation's last message for this link: its keys are the link's id and a start (P2: the unique index).
    const job = row
      ? this.deps.db.one<{ key: string; status: string; created_at: string; done_at: string | null }>(
          `SELECT key, status, created_at, done_at FROM zur_outbox WHERE automation_id = ? AND key > ? AND key < ? ORDER BY created_at DESC LIMIT 1`,
          CONFIRM_AUTOMATION,
          `${row.id}:`,
          `${row.id};`,
        )
      : null;
    const autoState = !job ? "" : job.status === "sent" || job.status === "delivered" ? "sent" : WAITING.has(job.status) ? "queued" : "missed";
    return {
      autoHour: this.deps.autoHour(),
      autoState,
      autoStart: job ? job.key.slice(row ? row.id.length + 1 : 0) : "",
      autoAt: job ? (job.done_at ?? job.created_at) : "",
      sentChannel: sent?.channel === "whatsapp" || sent?.channel === "email" ? sent.channel : "",
      mailedStart: mailed?.start ?? "",
      sentAt: sent ? new Date(sent.sent_at).toISOString() : "",
      sentStart: sent?.start ?? "",
      made: row !== null,
      answer,
      answeredAt: row?.answered_at ? new Date(row.answered_at).toISOString() : "",
      answerStart: row?.answer_start ?? "",
      previousStart: row?.previous_start ?? "",
    };
  }

  // ---------- /c/<token>, the patient ----------

  /** The page of a link. Opening never changes the appointment. */
  async view(token: string, network: string): Promise<ConfirmView> {
    const key = await this.gate(network, "view");
    const found = await this.resolve(token, key);
    return this.page(found);
  }

  /** The patient's tap: the same tap again shows the state and changes nothing. */
  async answer(token: string, action: ConfirmAction, network: string): Promise<ConfirmView> {
    const key = await this.gate(network, "answer");
    const found = await this.resolve(token, key);
    if (found.kind !== "live") return this.page(found);
    if (this.deps.lockdown()) throw new AppError("SERVICE_UNAVAILABLE");
    const { row } = found;
    let { event } = found;
    if (action === "confirm" && this.shown(event, row) === "confirmed") return this.page(found);
    if (action === "cancel" && this.now() > this.cancelUntil(event)) throw new AppError("CONFLICT", "error.confirmLate");
    const today = localToday(this.deps.timeZone(), new Date(this.now()));
    const count = row.answer_day === today ? row.answer_count : 0;
    if (count >= L.answersPerDay) throw new AppError("RATE_LIMITED", "error.confirmTooMany", { retryAfter: 3_600 });
    const color = action === "confirm" ? EVENT_STATUS_COLOR.confirmed : EVENT_STATUS_COLOR.cancelled;
    const meter = new GoogleMeter(BUDGET);
    // Another tap got there first (two at once): this one writes and rings nothing.
    let already = false;
    // Confirmed already, by the owner or for an earlier time: only the answer is written, Google keeps its color.
    if (event.colorId !== color) {
      event = await this.google(async () => {
      try {
        return await this.deps.google().updateEvent(row.calendar_id, row.event_id, { colorId: color }, event.etag, meter);
      } catch (error) {
        // Changed at Google meanwhile (412): read it once more and decide on that version.
        if (!(error instanceof GoogleError) || error.kind !== "changed") throw error;
        const fresh = await this.deps.google().event(row.calendar_id, row.event_id, meter);
        if (!isAppointment(fresh) || fresh.colorId === EVENT_STATUS_COLOR.cancelled || this.expiresAt(fresh) <= this.now()) throw new AppError("CONFLICT", "error.confirmLinkChanged");
        if (fresh.colorId === color) {
          already = true;
          return fresh;
        }
        if (action === "cancel" && this.now() > this.cancelUntil(fresh)) throw new AppError("CONFLICT", "error.confirmLate");
        return this.deps.google().updateEvent(row.calendar_id, row.event_id, { colorId: color }, fresh.etag, meter);
      }
    });
    }
    if (already) return this.page({ kind: "live", event, row });
    const now = this.now();
    this.deps.db.run(
      `UPDATE zur_appointment_links SET answer = ?, answer_start = ?, answered_at = ?, answer_day = ?, answer_count = ?, revoked_at = CASE WHEN ? THEN ? ELSE revoked_at END WHERE id = ?`,
      action === "confirm" ? "confirmed" : "cancelled",
      event.start,
      now,
      today,
      count + 1,
      action === "cancel" ? 1 : 0,
      now,
      row.id,
    );
    this.deps.notify({ kind: action === "confirm" ? "confirmed" : "cancelled", name: [...event.title].slice(0, 60).join(""), when: this.when(event.start), from: "" });
    const view = this.page({ kind: "live", event, row: { ...row, answer: action === "confirm" ? "confirmed" : "cancelled", answer_start: event.start } });
    return action === "cancel" ? { ...view, state: "cancelled", canCancel: false, canReschedule: false } : view;
  }

  // ---------- /c/<token>, rescheduling (E7b) ----------

  /** Steps 1 and 2: the next days with a free hour, and their halves with one. */
  async days(token: string, network: string): Promise<RescheduleDays> {
    const key = await this.gate(network, "view");
    const { event, row } = this.movable(await this.resolve(token, key));
    const length = this.lengthOf(event);
    const today = this.today();
    const first = dayPlus(today, 1);
    const last = dayPlus(today, L.rescheduleDays);
    const busy = await this.busyBetween(first, last, row, new GoogleMeter(GOOGLE_LIMITS.listCalendars));
    const hours = this.deps.hours();
    const out: RescheduleDays["days"] = [];
    for (let day = first; day <= last; day = nextDay(day)) {
      const turns = turnsOf(hours)
        .filter((window) => this.free(day, window, length, busy.get(day) ?? [], event).length > 0)
        .map((window) => ({ turn: window.turn, from: window.from, to: window.to, hours: gridOf(window, length) }));
      if (turns.length > 0) out.push({ day, turns });
    }
    return { length, days: out };
  }

  /** Step 4: the slots of a day's half, near the hour the patient prefers. */
  async offer(input: { token: string; day: string; turn: RescheduleTurn; pref: number }, network: string): Promise<RescheduleOffer> {
    const key = await this.gate(network, "view");
    const { event, row } = this.movable(await this.resolve(input.token, key));
    return { slots: await this.slots(input, event, row, new GoogleMeter(GOOGLE_LIMITS.listCalendars)) };
  }

  /**
   * The patient's new hour: offered again right now, under the object's one lock, or refused with
   * "taken". The same event moves at Google (its start, end and the Reagendado color); nothing is made.
   */
  async reschedule(input: { token: string; day: string; turn: RescheduleTurn; pref: number; start: number }, network: string): Promise<ConfirmView> {
    const key = await this.gate(network, "answer");
    const run = this.#moving.then(() => this.move(input, key));
    this.#moving = run.catch(() => undefined);
    return run;
  }

  private async move(input: { token: string; day: string; turn: RescheduleTurn; pref: number; start: number }, key: string): Promise<ConfirmView> {
    const found = this.movable(await this.resolve(input.token, key));
    if (this.deps.lockdown()) throw new AppError("SERVICE_UNAVAILABLE");
    const { row } = found;
    let { event } = found;
    const today = this.today();
    const count = row.answer_day === today ? row.answer_count : 0;
    if (count >= L.answersPerDay) throw new AppError("RATE_LIMITED", "error.confirmTooMany", { retryAfter: 3_600 });
    const meter = new GoogleMeter(MOVE_BUDGET);
    // The day read again inside the lock: what another patient took a moment ago is gone from the offer.
    const offered = await this.slots(input, event, row, meter);
    if (!offered.includes(input.start)) throw new AppError("CONFLICT", "error.rescheduleTaken", { problem: "taken" });
    const length = this.lengthOf(event);
    const zone = this.deps.timeZone();
    const startAt = localInstant(`${input.day}T${clock(input.start)}`, zone);
    const endAt = localInstant(`${input.day}T${clock(input.start + length)}`, zone);
    if (!startAt || !endAt) throw new AppError("CONFLICT", "error.rescheduleTaken", { problem: "taken" });
    const body = {
      start: { dateTime: startAt.toISOString(), timeZone: zone },
      end: { dateTime: endAt.toISOString(), timeZone: zone },
      colorId: EVENT_STATUS_COLOR.rescheduled,
    };
    const before = event.start;
    event = await this.google(async () => {
      try {
        return await this.deps.google().updateEvent(row.calendar_id, row.event_id, body, event.etag, meter);
      } catch (error) {
        // Changed at Google meanwhile (412): moved, cancelled or gone there, the patient's choice no longer stands.
        if (!(error instanceof GoogleError) || error.kind !== "changed") throw error;
        const fresh = await this.deps.google().event(row.calendar_id, row.event_id, meter);
        if (!isAppointment(fresh) || fresh.colorId === EVENT_STATUS_COLOR.cancelled || fresh.start !== before || fresh.end !== event.end) throw new AppError("CONFLICT", "error.confirmLinkChanged");
        return this.deps.google().updateEvent(row.calendar_id, row.event_id, body, fresh.etag, meter);
      }
    });
    const now = this.now();
    this.deps.db.run(
      `UPDATE zur_appointment_links SET answer = 'rescheduled', answer_start = ?, answered_at = ?, answer_day = ?, answer_count = ?, reschedules = reschedules + 1, previous_start = ? WHERE id = ?`,
      event.start,
      now,
      today,
      count + 1,
      before,
      row.id,
    );
    this.deps.notify({ kind: "rescheduled", name: [...event.title].slice(0, 60).join(""), when: this.when(event.start), from: this.when(before) });
    return this.page({ kind: "live", event, row: { ...row, answer: "rescheduled", answer_start: event.start, previous_start: before, reschedules: row.reschedules + 1 } });
  }

  /** A live link whose appointment may still move by it; anything else is the page as it stands, or 409. */
  private movable(found: Resolved): { event: CalendarEvent; row: LinkRow } {
    if (found.kind !== "live") {
      this.page(found);
      throw new AppError("CONFLICT", "error.rescheduleClosed");
    }
    if (!this.canMove(found.event, found.row)) throw new AppError("CONFLICT", "error.rescheduleClosed");
    return found;
  }

  private canMove(event: CalendarEvent, row: LinkRow): boolean {
    const length = this.lengthOf(event);
    return this.now() <= this.cancelUntil(event) && row.reschedules < L.reschedulesMax && length >= 15 && length <= 240;
  }

  /** The slots of one half of a day in the window, read from Google now. */
  private async slots(input: { day: string; turn: RescheduleTurn; pref: number }, event: CalendarEvent, row: LinkRow, meter: GoogleMeter): Promise<number[]> {
    const today = this.today();
    if (input.day < dayPlus(today, 1) || input.day > dayPlus(today, L.rescheduleDays)) throw new AppError("CONFLICT", "error.rescheduleTaken", { problem: "taken" });
    const window = turnsOf(this.deps.hours()).find((each) => each.turn === input.turn);
    if (!window) throw new AppError("CONFLICT", "error.rescheduleTaken", { problem: "taken" });
    const busy = (await this.busyBetween(input.day, input.day, row, meter)).get(input.day) ?? [];
    const length = this.lengthOf(event);
    const free = this.free(input.day, window, length, busy, event);
    const seed = await hmacSha256Hex(this.deps.secret(), `zuri:reschedule-draw:v1:${row.id}:${input.day}:${input.turn}`);
    return offerOf({ window, length, busy, free, pref: input.pref, seed: bytes(seed) });
  }

  private free(day: string, window: TurnWindow, length: number, busy: readonly Busy[], event: CalendarEvent): number[] {
    const zone = this.deps.timeZone();
    const clockNow = zonedParts(new Date(this.now()), zone);
    // The appointment's own hour is no new hour.
    const own = localToday(zone, new Date(event.start)) === day ? minuteOf(new Date(event.start), day, zone) : undefined;
    return freeIn({ day, window, length, busy, hours: this.deps.hours(), today: this.today(), nowMinute: clockNow.hour * 60 + clockNow.minute, exclude: own });
  }

  /**
   * Every timed event of the days, from every calendar read (meetings and calendars only read too), but
   * the appointment itself and the cancelled ones. A listing read in part could hide one: nothing is offered.
   */
  private async busyBetween(first: string, last: string, row: LinkRow, meter: GoogleMeter): Promise<Map<string, Busy[]>> {
    const zone = this.deps.timeZone();
    const from = localInstant(first, zone);
    const to = localInstant(nextDay(last), zone);
    const google = this.deps.google();
    const open = google.readable();
    if (!from || !to || open.length > GOOGLE_LIMITS.listCalendars) throw new AppError("SERVICE_UNAVAILABLE", "error.confirmUnavailable");
    const { events, more, skipped } = await this.google(() => google.events(open, from, to, meter, { timeZone: zone, perCalendar: 250, max: 1_000 }));
    if (more || skipped.length > 0) throw new AppError("SERVICE_UNAVAILABLE", "error.confirmUnavailable");
    const out = new Map<string, Busy[]>();
    for (const other of events) {
      if (other.allDay || other.colorId === EVENT_STATUS_COLOR.cancelled) continue;
      if (other.id === row.event_id && other.calendarId === row.calendar_id) continue;
      const start = new Date(other.start);
      const end = new Date(other.end);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;
      // An event over midnight takes its hours on each day it touches, walked only inside the window:
      // an event of a hundred years costs the days asked, never one loop per day it lasts.
      const began = localToday(zone, start);
      const ended = localToday(zone, end);
      const stop = ended < last ? ended : last;
      for (let day = began > first ? began : first; day <= stop; day = nextDay(day)) {
        const list = out.get(day) ?? [];
        list.push({ start: minuteOf(start, day, zone), end: minuteOf(end, day, zone), appointment: bound(other) });
        out.set(day, list);
      }
    }
    return out;
  }

  /** The appointment's length in minutes, on the owner's clock. */
  private lengthOf(event: CalendarEvent): number {
    const zone = this.deps.timeZone();
    const start = new Date(event.start);
    const day = localToday(zone, start);
    return minuteOf(new Date(event.end), day, zone) - minuteOf(start, day, zone);
  }

  private today(): string {
    return localToday(this.deps.timeZone(), new Date(this.now()));
  }

  /** The link and its appointment as Google has it now; anything that doesn't stand is "invalid", with no hint why. */
  private async resolve(token: string, network: string): Promise<Resolved> {
    // A wrong shape is never looked up, and counts as a guess like an unknown token.
    if (!CONFIRM_TOKEN.test(token)) return this.guess(network);
    const row = this.row(`token_hash = ?`, await sha256Hex(token));
    if (!row) return this.guess(network);
    if (row.revoked_at) return { kind: "expired", row };
    // Google disconnected is the owner's to fix: the patient tries again later, the link is not dead.
    if (!this.deps.google().connected()) throw new AppError("SERVICE_UNAVAILABLE", "error.confirmUnavailable");
    // Turned to "only read" since: the patient's tap could never reach Google.
    if (!this.canWrite(row.calendar_id)) return { kind: "invalid" };
    let event: CalendarEvent;
    try {
      event = await this.deps.google().event(row.calendar_id, row.event_id, new GoogleMeter(BUDGET));
    } catch (error) {
      if (error instanceof GoogleError && error.kind === "not_found") return { kind: "invalid" };
      throw unavailable(error);
    }
    if (!isAppointment(event)) return { kind: "invalid" };
    if (event.colorId === EVENT_STATUS_COLOR.cancelled) {
      // Cancelled at the Agenda or at Google: the link never comes back, even if the event is reopened.
      this.deps.db.run(`UPDATE zur_appointment_links SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`, this.now(), row.id);
      return { kind: "expired", event, row };
    }
    if (this.expiresAt(event) <= this.now()) return { kind: "expired", event, row };
    return { kind: "live", event, row };
  }

  private guess(network: string): Resolved {
    const tries = (this.#invalid.get(network) ?? 0) + 1;
    this.#invalid.set(network, tries);
    // The third unknown token in the window shuts the network out of /c/ for an hour.
    if (tries >= L.invalidPerWindow) this.#blocked.set(network, this.now() + L.blockMs);
    return { kind: "invalid" };
  }

  /** The network's print, once it may go on: past a limit, 429 with when to come back. */
  private async gate(network: string, kind: "view" | "answer"): Promise<string> {
    const now = this.now();
    const key = network ? await hmacSha256Hex(this.deps.secret(), `zuri:confirm-link-network:v1:${network}`) : "none";
    const window = Math.floor(now / L.windowMs);
    if (window !== this.#window) {
      this.#window = window;
      this.#views = new Map();
      this.#answers = new Map();
      this.#invalid = new Map();
      for (const [blocked, until] of this.#blocked) if (until <= now) this.#blocked.delete(blocked);
    }
    const until = this.#blocked.get(key);
    if (until !== undefined && until > now) throw limited(until - now);
    const counts = kind === "view" ? this.#views : this.#answers;
    const max = kind === "view" ? L.viewsPerWindow : L.answersPerWindow;
    const n = counts.get(key) ?? 0;
    if (n >= max || (n === 0 && counts.size >= NETWORKS_MAX)) throw limited((window + 1) * L.windowMs - now);
    counts.set(key, n + 1);
    return key;
  }

  private page(found: Resolved): ConfirmView {
    if (found.kind === "invalid") throw new AppError("NOT_FOUND", "error.confirmLinkInvalid");
    const clinic = this.deps.clinic();
    const zone = this.deps.timeZone();
    const event = found.event;
    if (found.kind === "expired" && !event) return { ...EMPTY, state: "expired", clinic: clinic.name, zone, team: clinic.whatsapp };
    if (!event) throw new AppError("NOT_FOUND", "error.confirmLinkInvalid");
    const online = onlineLine(event.description);
    const until = this.cancelUntil(event);
    const state = found.kind === "expired" ? "expired" : this.shown(event, found.row);
    if (state === "expired") return { ...EMPTY, state, clinic: clinic.name, zone, team: clinic.whatsapp };
    return {
      state,
      clinic: clinic.name,
      first: firstName(event.title),
      start: event.start,
      end: event.end,
      zone,
      type: (typeLine(event.description).split("|")[0] ?? "").trim().slice(0, 80),
      online,
      place: online ? "" : clinicLocation(clinic),
      cancelUntil: new Date(until).toISOString(),
      canCancel: this.now() <= until,
      canReschedule: found.kind === "live" && this.canMove(event, found.row),
      team: clinic.whatsapp,
    };
  }

  /**
   * Confirmed when the event is, unless the patient's own "yes" was for another time: moved at Google
   * with its color kept, the appointment asks again.
   */
  private shown(event: CalendarEvent, row: LinkRow): "confirmed" | "rescheduled" | "open" {
    // Moved by the link and still where the patient put it: "Consulta remarcada".
    if (row.answer === "rescheduled" && row.answer_start === event.start && event.colorId === EVENT_STATUS_COLOR.rescheduled) return "rescheduled";
    if (event.colorId !== EVENT_STATUS_COLOR.confirmed) return "open";
    return row.answer === "confirmed" && row.answer_start !== event.start ? "open" : "confirmed";
  }

  private canWrite(calendarId: string): boolean {
    const calendar = this.deps.google().calendar(calendarId);
    return calendar !== null && calendar.mode === "write" && calendar.writable;
  }

  /** An hour before the start. */
  private expiresAt(event: CalendarEvent): number {
    return Date.parse(event.start) - L.expireBeforeMs;
  }

  /** Whichever comes first: 12 hours before the start, or 23:59 of the day before, in the owner's zone. */
  cancelUntil(event: Pick<CalendarEvent, "start">): number {
    const start = Date.parse(event.start);
    const day = localToday(this.deps.timeZone(), new Date(start));
    const midnight = localInstant(day, this.deps.timeZone())?.getTime() ?? start;
    return Math.min(start - L.cancelBeforeMs, midnight - 60_000);
  }

  private when(start: string): string {
    return new Intl.DateTimeFormat(this.deps.locale(), { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: this.deps.timeZone() }).format(new Date(start));
  }

  private row(where: string, ...params: string[]): LinkRow | null {
    return this.deps.db.one<LinkRow>(
      `SELECT id, calendar_id, event_id, token_sealed, answer, answer_start, answered_at, revoked_at, answer_day, answer_count, reschedules, previous_start FROM zur_appointment_links WHERE ${where}`,
      ...params,
    );
  }

  private async google<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      throw unavailable(error);
    }
  }
}

const EMPTY: Omit<ConfirmView, "state" | "clinic" | "zone" | "team"> = { first: "", start: "", end: "", type: "", online: false, place: "", cancelUntil: "", canCancel: false, canReschedule: false };

/** The team's WhatsApp as people write it: "(41) 3333-0000" or "(41) 93333-0000"; "" with none. */
export function phoneText(digits: string): string {
  if (digits.length < 10) return digits;
  const cut = digits.length === 11 ? 7 : 6;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, cut)}-${digits.slice(cut)}`;
}

/** "HH:MM" of a minute of the day. */
function clock(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

/** The bytes of a hex string. */
function bytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Only an appointment has a link: timed, with a type, and a color that is a status (Cancelado included). */
function isAppointment(event: CalendarEvent): boolean {
  return !event.allDay && typeLine(event.description) !== "" && eventStatus(event.colorId) !== null;
}

function limited(ms: number): AppError {
  return new AppError("RATE_LIMITED", "error.confirmLimited", { retryAfter: Math.max(1, Math.ceil(ms / 1000)) });
}

/** Google's refusals reach the patient as "try again in a moment", never with Google's words. */
function unavailable(error: unknown): unknown {
  if (error instanceof AppError) return error;
  return new AppError("SERVICE_UNAVAILABLE", "error.confirmUnavailable");
}

/** An item of the working eve: what the automation hands to the outbox. */
export interface EveItem {
  key: string;
  /** The event's title: the contact's name in the queue's history. */
  label: string;
  /** E.164. */
  phone: string;
  /** The message with the link; "" in a rehearsal. */
  text: string;
  /** The link expires an hour before the start: after it, the message doesn't go ("Não saiu"). */
  notAfter: string;
}

/** A message of the outbox still on its way. */
const WAITING = new Set(["queued", "sending", "checking"]);

/** The automation's id in the CRM's catalog and its key in the outbox: the link and the start. */
/** The patient's token: `randomToken(16)`, 22 characters of base64url. */
const TOKEN_CHARS = 22;

export const CONFIRM_AUTOMATION = "appointment-confirmation";
export const confirmKey = (linkId: string, start: string) => `${linkId}:${start}`;

/** A weekday that is not a national holiday. */
function workingDay(day: string): boolean {
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  return weekday !== 0 && weekday !== 6 && nationalHoliday(day) === null;
}

/** The patient's mobile as E.164, from the country's code kept on the event (E5e); null without one. */
function e164(event: CalendarEvent): string | null {
  const dial = (COUNTRY_DIAL[event.country ?? HOME_COUNTRY] ?? "").replace(/\D/g, "");
  const digits = (event.phone ?? "").replace(/\D/g, "");
  const phone = `+${dial}${digits}`;
  // In Brazil only a mobile (DDD and 9 digits starting with 9): a landline has no WhatsApp to write to.
  if ((event.country ?? HOME_COUNTRY) === HOME_COUNTRY && !/^[1-9]{2}9\d{8}$/.test(digits)) return null;
  return dial && digits && /^\+[1-9]\d{7,14}$/.test(phone) ? phone : null;
}
