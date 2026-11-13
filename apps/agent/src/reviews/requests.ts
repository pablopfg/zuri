import {
  GOOGLE_LIMITS,
  hmacSha256Hex,
  type Locale,
  nationalHoliday,
  REVIEW_REQUEST_GROUP,
  REVIEW_REQUEST_GROUPS,
  REVIEW_REQUEST_LIMITS,
  type ReviewRequestGroup,
  type ReviewRequestItem,
  type ReviewRequestSend,
  type ReviewRequestSettings,
  type ReviewRequestsBlocked,
  type ReviewRequestsPage,
  type ReviewRequestState,
  type ReviewRequestStep,
  reviewLinkProblem,
  t,
} from "@zuri/shared";
import type { Database } from "../db/database.ts";
import { readAppointment, titleKeys } from "../google/appointments.ts";
import { type GoogleContacts, searchText } from "../google/contacts.ts";
import { localInstant, localToday } from "../google/events.ts";
import { type GoogleCalendar, GoogleError, GoogleMeter } from "../google/service.ts";
import { CODE_PATTERN } from "../gates/review-link.ts";
import { AppError } from "../http/errors.ts";
import { currentWake } from "../agent/wake-budget.ts";
import { log } from "../log.ts";
import type { ReviewMatches } from "./matches.ts";
import { namePrints } from "./names.ts";

/**
 * Review requests with one tap (PR S20, option A of 09/11/2026;
 * docs/planos/s20-pedido-de-avaliacao.md). Once a day, at the owner's hour, the
 * list is made from the calendar: who had an appointment that already took
 * place, whose event names one contact (a person with the name of another only
 * with something of theirs in the event), due on the 8th day after it or the
 * next working day. One request per contact, ever, and one reminder.
 * "Enviar link de avaliação" checks everything again on the server and hands
 * the owner's WhatsApp the text with a link of the person's own: Zuri's short
 * address, which notes the first opening and goes on to the profile's review
 * page. Nothing here ever writes to a person: the owner sends.
 */

const DAY_MS = 86_400_000;
const MINUTE = 60_000;
const BR_MOBILE = /^\+55\d{2}9\d{8}$/;

export type RequestNotice = { kind: "reviews.requests"; count: number };

export interface RequestsDeps {
  db: Database;
  google: GoogleCalendar;
  contacts: () => GoogleContacts;
  matches: ReviewMatches;
  /** The reviews are on (the requests are theirs) and Google lets them in. */
  reviewsOn: () => boolean;
  timeZone: () => string;
  locale: () => Locale;
  publicUrl: () => URL;
  /** The key of the name prints and of the networks' counts: a Worker secret. */
  secret: () => string;
  notify: (notice: RequestNotice) => void;
  clock?: () => number;
}

interface SettingsRow {
  request_message: string | null;
  request_days: number;
  request_hour: string;
  request_reminder: number;
  requests_day: string;
  requests_built_at: number | null;
  requests_told_day: string;
}

/** The columns' own defaults (migration 41), for a database with no row yet. */
const NO_ROW: SettingsRow = { request_message: null, request_days: 8, request_hour: "09:00", request_reminder: 1, requests_day: "", requests_built_at: null, requests_told_day: "" };

interface RequestRow {
  id: string;
  contact_id: string;
  appointment_day: string;
  due_day: string;
  attempts: number;
  sent_at: number | null;
  reminded_at: number | null;
  opened_at: number | null;
  created_at: number;
}

interface ListedRow extends RequestRow {
  name: string;
  review_id: string | null;
  pending: number;
}

/** A local day, `n` days later (or earlier). */
export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Monday to Friday, not a national holiday. */
export function workingDay(day: string): boolean {
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  return weekday !== 0 && weekday !== 6 && nationalHoliday(day) === null;
}

/** The day itself when it is a working one, else the next working day. */
export function nextWorking(day: string): string {
  let next = day;
  for (let i = 0; i < 14 && !workingDay(next); i++) next = addDays(next, 1);
  return next;
}

/** The day a request is due: `days` after the appointment, moved to the next working day. */
export function dueDay(appointmentDay: string, days: number): string {
  return nextWorking(addDays(appointmentDay, days));
}

/** The first name as the message writes it: letters (and ' -) only, up to 20; "" otherwise. */
export function firstNameFor(given: string, name: string): string {
  const word = (given.trim() || name.trim()).split(/\s+/)[0] ?? "";
  const clean = word.replace(/[^\p{L}'-]/gu, "");
  return clean && clean.length === word.length && [...clean].length <= 20 ? clean : "";
}

/** The owner's message with the person's first name and link. Without a first name, the greeting loses its comma. */
export function fillMessage(message: string, first: string, link: string): string {
  const named = first ? message.replaceAll("{primeiro_nome}", first) : message.replace(/,?[ \t]*\{primeiro_nome\}/g, "");
  return named.replaceAll("{link}", link);
}

/** A code of the short address: 10 of the 57 letters and digits, drawn without bias. */
export function drawCode(): string {
  const alphabet = REVIEW_REQUEST_LIMITS.codeAlphabet;
  const out: string[] = [];
  // 57 * 4 = 228: bytes from 228 up are drawn again, so every letter is as likely.
  const ceiling = Math.floor(256 / alphabet.length) * alphabet.length;
  while (out.length < REVIEW_REQUEST_LIMITS.codeLength) {
    for (const byte of crypto.getRandomValues(new Uint8Array(16))) {
      if (byte < ceiling && out.length < REVIEW_REQUEST_LIMITS.codeLength) out.push(alphabet[byte % alphabet.length] as string);
    }
  }
  return out.join("");
}

/** What an opening of /a/<code> answers. */
export type LinkAnswer = { kind: "go"; location: string } | { kind: "missing" } | { kind: "limited" };

export class ReviewRequests {
  constructor(private readonly deps: RequestsDeps) {}

  private get db(): Database {
    return this.deps.db;
  }

  private now(): number {
    return this.deps.clock?.() ?? Date.now();
  }

  private today(): string {
    return localToday(this.deps.timeZone(), new Date(this.now()));
  }

  private dayOf(at: number): string {
    return localToday(this.deps.timeZone(), new Date(at));
  }

  /** Reading never writes: the alarm asks this every time, and an owner who never opened Avaliações keeps no row. */
  private row(): SettingsRow {
    return (
      this.db.one<SettingsRow>(
        `SELECT request_message, request_days, request_hour, request_reminder, requests_day, requests_built_at, requests_told_day FROM zur_review_settings WHERE id = 1`,
      ) ?? { ...NO_ROW }
    );
  }

  /** The row the writes below change, made the first time one of them runs. */
  private ensureRow(): void {
    this.db.run(`INSERT INTO zur_review_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING`);
  }

  /** A row out of range (damaged) reads as the default. */
  private days(row: SettingsRow): number {
    const n = row.request_days;
    return Number.isInteger(n) && n >= REVIEW_REQUEST_LIMITS.daysMin && n <= REVIEW_REQUEST_LIMITS.daysMax ? n : REVIEW_REQUEST_LIMITS.daysDefault;
  }

  private hour(row: SettingsRow): string {
    const h = row.request_hour;
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(h) && h >= REVIEW_REQUEST_LIMITS.hourMin && h <= REVIEW_REQUEST_LIMITS.hourMax ? h : REVIEW_REQUEST_LIMITS.hourDefault;
  }

  // ---------- The link ----------

  /** The profile the requests are of: the first one chosen (a request doesn't know which unit the appointment was at). */
  private location(): { google_name: string; title: string; review_uri: string | null; review_uri_manual: string | null; review_uri_at: number | null } | null {
    return this.db.one(`SELECT google_name, title, review_uri, review_uri_manual, review_uri_at FROM zur_review_locations WHERE selected = 1 ORDER BY google_name LIMIT 1`);
  }

  /** The review page a code leads to: the owner's, else Google's; checked again, whatever the database holds. */
  link(): string | null {
    const location = this.location();
    for (const value of [location?.review_uri_manual, location?.review_uri]) {
      if (value && reviewLinkProblem(value) === null) return value;
    }
    return null;
  }

  settings(): ReviewRequestSettings {
    const row = this.row();
    const location = this.location();
    const url = this.deps.publicUrl();
    return {
      link: {
        google: location?.review_uri ?? null,
        manual: location?.review_uri_manual ?? null,
        readAt: location?.review_uri_at ? new Date(location.review_uri_at).toISOString() : null,
        location: location?.title ?? null,
      },
      shortBase: `${url.host}/a/`,
      message: row.request_message,
      defaultMessage: t(this.deps.locale(), "reviews.request.message"),
      days: this.days(row),
      hour: this.hour(row),
      reminder: row.request_reminder === 1,
    };
  }

  /** The owner's link (null: back to Google's). Needs a chosen profile. */
  setLink(manual: string | null): ReviewRequestSettings {
    const location = this.location();
    if (!location) throw new AppError("CONFLICT", "error.reviewRequestsNoProfile");
    if (manual !== location.review_uri_manual) {
      this.db.run(`UPDATE zur_review_locations SET review_uri_manual = ? WHERE google_name = ?`, manual, location.google_name);
      this.rebuildSoon();
    }
    return this.settings();
  }

  /** The message and "Quando pedir"; the same values again write nothing. */
  update(patch: { message?: string | null | undefined; days?: number | undefined; hour?: string | undefined; reminder?: boolean | undefined }): ReviewRequestSettings {
    const row = this.row();
    const next = {
      message: patch.message === undefined ? row.request_message : patch.message,
      days: patch.days ?? this.days(row),
      hour: patch.hour ?? this.hour(row),
      reminder: patch.reminder === undefined ? row.request_reminder : patch.reminder ? 1 : 0,
    };
    if (next.message === row.request_message && next.days === row.request_days && next.hour === row.request_hour && next.reminder === row.request_reminder) return this.settings();
    // One transaction: the settings and the rows that follow them, or nothing.
    this.db.transaction(() => {
      this.ensureRow();
      this.db.run(
        `UPDATE zur_review_settings SET request_message = ?, request_days = ?, request_hour = ?, request_reminder = ? WHERE id = 1`,
        next.message,
        next.days,
        next.hour,
        next.reminder,
      );
      // Rows not sent yet follow the new number of days; a sent one keeps its history.
      if (next.days !== this.days(row)) {
        for (const request of this.db.all<{ id: string; appointment_day: string }>(`SELECT id, appointment_day FROM zur_review_requests WHERE attempts = 0`)) {
          this.db.run(`UPDATE zur_review_requests SET due_day = ?, updated_at = ? WHERE id = ? AND due_day != ?`, dueDay(request.appointment_day, next.days), this.now(), request.id, dueDay(request.appointment_day, next.days));
        }
      }
    });
    this.rebuildSoon();
    return this.settings();
  }

  /** The list is made again on the next wake (at most once a minute, whatever the screen sends). */
  private rebuildSoon(): void {
    this.db.run(`UPDATE zur_review_settings SET requests_day = '' WHERE id = 1 AND (requests_built_at IS NULL OR requests_built_at < ?)`, this.now() - MINUTE);
  }

  // ---------- The list ----------

  blocked(): ReviewRequestsBlocked | null {
    if (!this.deps.reviewsOn()) return "reviews";
    if (!this.link()) return "link";
    if (!this.deps.contacts().enabled()) return "contacts";
    if (!this.deps.google.usable()) return "calendar";
    return null;
  }

  /** When the alarm has the list to make (ms): today's hour until it is made, then tomorrow's; nothing while something it needs is off. */
  nextDue(): number | null {
    if (!this.deps.reviewsOn() || this.blocked()) return null;
    const row = this.row();
    const today = this.today();
    const day = row.requests_day === today ? addDays(today, 1) : today;
    const [h, m] = this.hour(row).split(":").map(Number);
    return localInstant(`${day}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`, this.deps.timeZone())?.getTime() ?? null;
  }

  due(): boolean {
    const at = this.nextDue();
    return at !== null && at <= this.now() && this.row().requests_day !== this.today();
  }

  /** From the alarm: the day's list and the owner's notice. True when it ran. */
  async tick(): Promise<boolean> {
    if (!this.due()) return false;
    await this.run();
    return true;
  }

  /**
   * The first list, made when Pedidos opens (the owner just turned everything on): no waiting for
   * tomorrow's hour. Only once; from then on, the alarm's hour. With its own count of calls (buildBudget).
   */
  async firstBuild(): Promise<void> {
    if (this.row().requests_built_at !== null || !this.deps.reviewsOn() || this.blocked()) return;
    await this.run();
  }

  private async run(): Promise<void> {
    const today = this.today();
    // A wake with too few calls left (a renewal and a page): the next wake tries, the day not marked yet.
    if (currentWake()?.room(2) === false) return;
    // Marked first: a failure waits for tomorrow's hour (or the owner's next change), never every minute.
    this.ensureRow();
    this.db.run(`UPDATE zur_review_settings SET requests_day = ? WHERE id = 1`, today);
    this.prune();
    try {
      await this.build(new GoogleMeter(REVIEW_REQUEST_LIMITS.buildBudget));
    } catch (error) {
      // What was read before the failure is kept; the day's list waits for tomorrow.
      log("warn", "review_requests_failed", { error: error instanceof GoogleError ? error.kind : "error" });
    }
    this.db.run(`UPDATE zur_review_settings SET requests_built_at = ? WHERE id = 1`, this.now());
    const row = this.row();
    if (workingDay(today) && row.requests_told_day !== today) {
      const count = this.list().counts.today;
      if (count > 0) {
        this.db.run(`UPDATE zur_review_settings SET requests_told_day = ? WHERE id = 1`, today);
        this.deps.notify({ kind: "reviews.requests", count });
      }
    }
  }

  /**
   * The appointments of the last weeks, from every calendar open to Zuri, each one to the contact it
   * names: a title with the name of one contact alone, or of a contact of a shared name with something
   * of theirs in the event (`readAppointment`'s "certain"). Anything else asks nobody.
   */
  async build(meter: GoogleMeter): Promise<number> {
    const contacts = this.deps.contacts();
    const timeZone = this.deps.timeZone();
    const row = this.row();
    const days = this.days(row);
    const today = this.today();
    const from = localInstant(addDays(today, -(days + REVIEW_REQUEST_LIMITS.lookbackExtraDays)), timeZone)?.toISOString();
    const to = new Date(this.now()).toISOString();
    if (!from) return 0;
    const byKey = new Map<string, string[]>();
    const idsOf = (key: string): string[] => {
      const cached = byKey.get(key);
      if (cached) return cached;
      // The name alone, or the name and its note: only this very name, however many share a first name.
      const ids = contacts
        .inNameRange(key, `${key}\u0002`, REVIEW_REQUEST_LIMITS.candidatesRead)
        .items.filter((contact) => searchText(contact.name) === key)
        .map((contact) => contact.id);
      byKey.set(key, ids);
      return ids;
    };
    const latest = new Map<string, string>();
    try {
      await this.read(meter, from, to, idsOf, latest, today);
    } catch (error) {
      // What was read before a failure is kept all the same.
      await this.keep(latest, days, today);
      throw error;
    }
    return this.keep(latest, days, today);
  }

  private async read(
    meter: GoogleMeter,
    from: string,
    to: string,
    idsOf: (key: string) => string[],
    latest: Map<string, string>,
    today: string,
  ): Promise<void> {
    const google = this.deps.google;
    const contacts = this.deps.contacts();
    const timeZone = this.deps.timeZone();
    const identities = new Map<string, ReturnType<GoogleContacts["identity"]>>();
    for (const calendar of google.readable().slice(0, GOOGLE_LIMITS.listCalendars)) {
      let pageToken: string | undefined;
      for (let page = 0; page < 4; page++) {
        // A page and a token renewal.
        if (!meter.room(2)) return;
        const body = await google.api(`/calendars/${encodeURIComponent(calendar.id)}/events`, meter, {
          query: { timeMin: from, timeMax: to, singleEvents: "true", orderBy: "startTime", maxResults: "250", ...(pageToken ? { pageToken } : {}) },
        });
        for (const item of Array.isArray(body?.items) ? body.items : []) {
          const title = typeof (item as { summary?: unknown })?.summary === "string" ? (item as { summary: string }).summary : "";
          if (!title) continue;
          const found = new Set<string>();
          for (const key of titleKeys(title)) {
            for (const id of idsOf(key)) {
              if (!identities.has(id)) identities.set(id, contacts.identity(id));
              const who = identities.get(id);
              if (!who) continue;
              const appointment = readAppointment(item, who, timeZone);
              // A shared name with nothing in the event that says whose: nobody (rule of the homonyms).
              if (appointment?.certain && Date.parse(appointment.start) <= this.now()) found.add(`${id}\n${appointment.allDay ? appointment.start : this.dayOf(Date.parse(appointment.start))}`);
            }
          }
          // Two contacts certain of one event (it carries something of each): nobody.
          if (found.size !== 1) continue;
          const [id, day] = ([...found][0] as string).split("\n") as [string, string];
          if (day < today && (latest.get(id) ?? "") < day) latest.set(id, day);
        }
        pageToken = typeof body?.nextPageToken === "string" && body.nextPageToken ? body.nextPageToken : undefined;
        if (!pageToken) break;
      }
    }
  }

  /** The new requests of a read: one per contact, ever; a contact asked before is never asked again. */
  private async keep(latest: Map<string, string>, days: number, today: string): Promise<number> {
    const secret = this.deps.secret();
    const contacts = this.deps.contacts();
    const oldest = addDays(today, -REVIEW_REQUEST_LIMITS.unsentDays);
    const fresh: { id: string; person: string; day: string; due: string }[] = [];
    const found: { request: string; id: string }[] = [];
    for (const [id, day] of latest) {
      const due = dueDay(day, days);
      if (due < oldest) continue;
      if (this.db.one(`SELECT 1 AS yes FROM zur_review_requests WHERE contact_id = ?`, id)) continue;
      const person = this.db.one<{ name: string }>(`SELECT resource_name AS name FROM zur_contacts WHERE id = ?`, id)?.name;
      if (!person) continue;
      // Asked before, under the id of an older copy of the contacts: the same person, never asked again.
      const before = this.db.one<{ id: string }>(`SELECT id FROM zur_review_requests WHERE person = ?`, person);
      if (before) found.push({ request: before.id, id });
      else fresh.push({ id, person, day, due });
    }
    // The prints wait (HMAC): made before the transaction.
    const prints = new Map<string, Awaited<ReturnType<typeof namePrints>>>();
    for (const item of fresh) prints.set(item.id, await namePrints(secret, contacts.reach(item.id)?.name ?? ""));
    const now = this.now();
    this.db.transaction(() => {
      for (const item of found) this.db.run(`UPDATE zur_review_requests SET contact_id = ? WHERE id = ?`, item.id, item.request);
      for (const item of fresh) {
        // A review of the contact's name nobody linked yet becomes a guess for the owner first.
        this.deps.matches.flagged(item.id, prints.get(item.id) ?? null);
        this.db.run(
          `INSERT INTO zur_review_requests (id, contact_id, person, appointment_day, due_day, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
          crypto.randomUUID(),
          item.id,
          item.person,
          item.day,
          item.due,
          now,
          now,
        );
      }
    });
    return fresh.length;
  }

  /** Requests never sent long after their day and codes long past their time. */
  private prune(): void {
    const now = this.now();
    this.db.run(`DELETE FROM zur_review_requests WHERE attempts = 0 AND due_day < ?`, addDays(this.today(), -REVIEW_REQUEST_LIMITS.unsentDays));
    this.db.run(`DELETE FROM zur_review_links WHERE expires_at < ?`, now - REVIEW_REQUEST_LIMITS.linkKeepDays * DAY_MS);
  }

  private mobile(contactId: string): string | null {
    const phones = this.deps.contacts().reach(contactId)?.phones ?? [];
    // A Brazilian mobile, else a number of another country (it can't be told from a landline there).
    return phones.find((phone) => BR_MOBILE.test(phone)) ?? phones.find((phone) => !phone.startsWith("+55") && phone.length >= 9) ?? null;
  }

  private reminderDay(row: RequestRow, reminder: boolean): string | null {
    if (!reminder || row.attempts !== 1 || row.sent_at === null) return null;
    return nextWorking(addDays(this.dayOf(row.sent_at), REVIEW_REQUEST_LIMITS.reminderAfterDays));
  }

  private item(row: ListedRow, review: { rating: number; state: string; created_at: string } | null, reminder: boolean, today: string): ReviewRequestItem {
    const reminderDay = this.reminderDay(row, reminder);
    let state: ReviewRequestState;
    if (row.review_id && review) state = review.state === "removed" ? "removed" : "reviewed";
    else if (row.pending) state = "pending";
    else if (row.attempts >= 2) state = "reminded";
    else if (row.attempts === 1) state = reminderDay !== null && reminderDay <= today && this.mobile(row.contact_id) ? "reminder" : "waiting";
    else if (!this.mobile(row.contact_id)) state = "no_phone";
    else state = row.due_day > today ? "scheduled" : "today";
    const steps: ReviewRequestStep[] = [];
    if (row.sent_at !== null) steps.push({ kind: "sent", at: new Date(row.sent_at).toISOString() });
    if (row.reminded_at !== null) steps.push({ kind: "reminded", at: new Date(row.reminded_at).toISOString() });
    if (row.opened_at !== null) steps.push({ kind: "opened", at: new Date(row.opened_at).toISOString() });
    if (review) steps.push({ kind: "reviewed", at: review.created_at, rating: review.rating });
    steps.sort((a, b) => a.at.localeCompare(b.at));
    return {
      id: row.id,
      contactId: row.contact_id,
      name: row.name,
      appointmentDay: row.appointment_day,
      dueDay: row.due_day,
      reminderDay: state === "waiting" || state === "reminder" ? reminderDay : null,
      state,
      reviewId: review ? row.review_id : null,
      rating: review?.rating ?? null,
      steps,
    };
  }

  private listed(where = "", ...params: (string | number)[]): ListedRow[] {
    return this.db.all<ListedRow>(
      `SELECT r.*, c.display_name AS name,
         (SELECT m.review_id FROM zur_review_matches m WHERE m.contact_id = r.contact_id AND m.kind IN ('auto', 'confirmed') LIMIT 1) AS review_id,
         EXISTS (SELECT 1 FROM zur_review_match_candidates k WHERE k.contact_id = r.contact_id) AS pending
       FROM zur_review_requests r JOIN zur_contacts c ON c.id = r.contact_id ${where}
       ORDER BY r.due_day DESC, r.id LIMIT ?`,
      ...params,
      REVIEW_REQUEST_LIMITS.listMax,
    );
  }

  private reviewsOf(rows: readonly ListedRow[]): Map<string, { rating: number; state: string; created_at: string }> {
    const ids = [...new Set(rows.map((row) => row.review_id).filter((id): id is string => !!id))];
    const out = new Map<string, { rating: number; state: string; created_at: string }>();
    for (let i = 0; i < ids.length; i += 50) {
      const part = ids.slice(i, i + 50);
      for (const review of this.db.all<{ id: string; rating: number; state: string; created_at: string }>(
        `SELECT id, rating, state, created_at FROM zur_reviews WHERE id IN (${part.map(() => "?").join(", ")})`,
        ...part,
      )) {
        out.set(review.id, review);
      }
    }
    return out;
  }

  list(): ReviewRequestsPage {
    const row = this.row();
    const blocked = this.blocked();
    const counts = Object.fromEntries(REVIEW_REQUEST_GROUPS.map((group) => [group, 0])) as Record<ReviewRequestGroup, number>;
    // Off (the reviews or the contacts): nothing to show, and no contact's name is read.
    const rows = blocked === "reviews" || blocked === "contacts" ? [] : this.listed();
    const reviews = this.reviewsOf(rows);
    const today = this.today();
    const items = rows.map((listed) => this.item(listed, listed.review_id ? (reviews.get(listed.review_id) ?? null) : null, row.request_reminder === 1, today));
    for (const item of items) counts[REVIEW_REQUEST_GROUP[item.state]]++;
    return {
      blocked,
      builtAt: row.requests_built_at ? new Date(row.requests_built_at).toISOString() : null,
      items,
      counts,
      matches: blocked === "reviews" ? { read: 0, linked: 0, pending: 0, none: 0 } : this.deps.matches.counts(),
    };
  }

  /**
   * "Enviar link de avaliação" (and "Lembrar pelo WhatsApp"): checked again here, whatever the screen
   * showed. The attempt moves only if it is still the one read (two tabs, two taps: one wins); a tap
   * again within 10 minutes hands the same link back (WhatsApp didn't open).
   */
  async send(id: string): Promise<ReviewRequestSend> {
    const blocked = this.blocked();
    if (blocked) throw new AppError("CONFLICT", "error.reviewRequestsBlocked", { blocked });
    const row = this.listed("WHERE r.id = ?", id)[0];
    if (!row) throw new AppError("NOT_FOUND", "error.reviewRequestNotFound");
    const settings = this.row();
    const today = this.today();
    const review = row.review_id ? (this.reviewsOf([row]).get(row.review_id) ?? null) : null;
    const item = this.item(row, review, settings.request_reminder === 1, today);
    const phone = this.mobile(row.contact_id);
    const now = this.now();
    const last = this.db.one<{ code: string; attempt: number; created_at: number }>(`SELECT code, attempt, created_at FROM zur_review_links WHERE request_id = ? ORDER BY attempt DESC LIMIT 1`, id);
    const again = last && last.attempt === row.attempts && now - last.created_at <= REVIEW_REQUEST_LIMITS.reopenMs && (item.state === "waiting" || item.state === "reminded");
    if (!phone || (!again && item.state !== "today" && item.state !== "reminder")) throw new AppError("CONFLICT", "error.reviewRequestDone", { state: item.state });
    let code = last?.code ?? "";
    if (!again) {
      code = this.db.transaction(() => {
        const moved = this.db.run(
          `UPDATE zur_review_requests SET attempts = attempts + 1, sent_at = COALESCE(sent_at, ?), reminded_at = CASE WHEN attempts = 1 THEN ? ELSE reminded_at END, updated_at = ?
           WHERE id = ? AND attempts = ?`,
          now,
          now,
          now,
          id,
          row.attempts,
        ).rowsWritten;
        if (!moved) throw new AppError("CONFLICT", "error.reviewRequestDone", { state: "waiting" });
        for (let tries = 0; tries < 5; tries++) {
          const drawn = drawCode();
          const added = this.db.run(
            `INSERT INTO zur_review_links (code, request_id, attempt, created_at, expires_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (code) DO NOTHING`,
            drawn,
            id,
            row.attempts + 1,
            now,
            now + REVIEW_REQUEST_LIMITS.linkValidDays * DAY_MS,
          ).rowsWritten;
          if (added) return drawn;
        }
        throw new AppError("INTERNAL_ERROR");
      });
    }
    const reach = this.deps.contacts().reach(row.contact_id);
    const message = settings.request_message ?? t(this.deps.locale(), "reviews.request.message");
    const link = `${this.deps.publicUrl().origin}/a/${code}`;
    const text = fillMessage(message, firstNameFor(reach?.given ?? "", reach?.name ?? ""), link);
    const fresh = this.listed("WHERE r.id = ?", id)[0] ?? row;
    return { phone: phone.replace(/\D/g, ""), text, item: this.item(fresh, review, settings.request_reminder === 1, today) };
  }

  // ---------- /a/<code> ----------

  /** This minute's openings, by network and in all; a new minute starts them again. Lost on a restart, which only lets a few more through. */
  private hits = { minute: -1, all: 0, networks: new Map<string, number>() };

  /** One more opening this minute: false past a network's limit or everyone's. */
  private count(network: string, minute: number): boolean {
    if (this.hits.minute !== minute) this.hits = { minute, all: 0, networks: new Map() };
    if (this.hits.all >= REVIEW_REQUEST_LIMITS.hitsAllPerMinute) return false;
    const n = this.hits.networks.get(network) ?? 0;
    if (n >= REVIEW_REQUEST_LIMITS.hitsPerMinute) return false;
    this.hits.all += 1;
    this.hits.networks.set(network, n + 1);
    return true;
  }

  /**
   * Somebody opened a short address. The destination is only ever the review page kept in the
   * database, never anything in the address asked. A preview robot or a HEAD notes nothing; a code
   * past its 30 days goes to Google without a note; an unknown one is a 404 like any other.
   */
  async open(code: string, network: string, preview: boolean): Promise<LinkAnswer> {
    // Counted in memory, never in the database: a stranger's openings write nothing (S20-1).
    const now = this.now();
    const minute = Math.floor(now / MINUTE);
    const key = network ? await hmacSha256Hex(this.deps.secret(), `zuri:review-link-network:v1:${network}`) : "none";
    if (!this.count(key, minute)) return { kind: "limited" };
    if (!CODE_PATTERN.test(code)) return { kind: "missing" };
    const row = this.db.one<{ request_id: string; expires_at: number; opened_at: number | null }>(`SELECT request_id, expires_at, opened_at FROM zur_review_links WHERE code = ?`, code);
    const location = row ? this.link() : null;
    if (!row || !location) return { kind: "missing" };
    // A preview robot goes on too (a person in an app's own browser can look like one): only nothing is noted.
    if (!preview && row.expires_at > now && row.opened_at === null) {
      this.db.transaction(() => {
        this.db.run(`UPDATE zur_review_links SET opened_at = ? WHERE code = ? AND opened_at IS NULL`, now, code);
        this.db.run(`UPDATE zur_review_requests SET opened_at = ?, updated_at = ? WHERE id = ? AND opened_at IS NULL`, now, now, row.request_id);
      });
    }
    return { kind: "go", location };
  }
}
