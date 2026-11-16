import {
  type Clinic,
  CONFIRM_LINK_LIMITS as L,
  CONFIRM_TOKEN,
  type ConfirmAction,
  type ConfirmAnswer,
  type ConfirmLinkMade,
  type ConfirmLinkStatus,
  type ConfirmView,
  clinicLocation,
  EVENT_STATUS_COLOR,
  eventStatus,
  hmacSha256Hex,
  randomToken,
  sha256Hex,
  typeLine,
} from "@zuri/shared";
import type { Database } from "../db/database.ts";
import { AppError } from "../http/errors.ts";
import { McpCredentials } from "../mcp/credentials.ts";
import { type CalendarEvent, localInstant, localToday } from "./events.ts";
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
}

export interface ConfirmNotice {
  kind: "confirmed" | "cancelled";
  name: string;
  when: string;
}

export interface ConfirmLinkDeps {
  db: Database;
  google: () => Pick<GoogleCalendar, "event" | "updateEvent" | "usable" | "connected" | "calendar">;
  timeZone: () => string;
  locale: () => string;
  clinic: () => Clinic;
  publicUrl: () => URL;
  credentialKey: string | undefined;
  /** The key of the networks' prints (HMAC), never kept. */
  secret: () => string;
  notify: (notice: ConfirmNotice) => void;
  /** Nothing changes during a lockdown (/bloquear). */
  lockdown: () => boolean;
  clock?: () => number;
}

/** Google's reads and writes for one request: the event, a change, and once more after a 412. */
const BUDGET = 4;
/** Distinct networks kept in memory; past it every new one waits, so a flood can't grow the object. */
const NETWORKS_MAX = 5_000;

type Resolved = { kind: "invalid" } | { kind: "expired"; event?: CalendarEvent; row: LinkRow } | { kind: "live"; event: CalendarEvent; row: LinkRow };

/** The first word of the title, without "Dr." or "Dra.": the page never shows the full name. */
export function firstName(title: string): string {
  const word = title.replace(/^\s*dra?\.?\s+/i, "").trim().split(/\s+/)[0] ?? "";
  return [...word].slice(0, 40).join("");
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
    if (!this.#vault.available) throw new AppError("NOT_CONFIGURED");
    // The patient's tap changes the event: a calendar the Zuri only reads has no link to give.
    if (!this.canWrite(calendarId)) throw new AppError("CONFLICT", "error.confirmLinkReadOnly");
    const event = await this.deps.google().event(calendarId, eventId, new GoogleMeter(BUDGET));
    if (!isAppointment(event)) throw new AppError("VALIDATION_FAILED", "error.confirmLinkNotAppointment");
    let row = this.row(`calendar_id = ? AND event_id = ?`, calendarId, eventId);
    if (row?.revoked_at || event.colorId === EVENT_STATUS_COLOR.cancelled || this.expiresAt(event) <= this.now()) {
      throw new AppError("CONFLICT", "error.confirmLinkGone");
    }
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
    return { ...this.statusOf(row), url: `${this.deps.publicUrl().origin}/c/${token}` };
  }

  private statusOf(row: LinkRow | null): ConfirmLinkStatus {
    const answer: ConfirmAnswer = row?.answer === "confirmed" || row?.answer === "cancelled" ? row.answer : "none";
    return {
      made: row !== null,
      answer,
      answeredAt: row?.answered_at ? new Date(row.answered_at).toISOString() : "",
      answerStart: row?.answer_start ?? "",
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
    this.deps.notify({ kind: action === "confirm" ? "confirmed" : "cancelled", name: [...event.title].slice(0, 60).join(""), when: this.when(event.start) });
    const view = this.page({ kind: "live", event, row: { ...row, answer: action === "confirm" ? "confirmed" : "cancelled", answer_start: event.start } });
    return action === "cancel" ? { ...view, state: "cancelled", canCancel: false } : view;
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
      team: clinic.whatsapp,
    };
  }

  /**
   * Confirmed when the event is, unless the patient's own "yes" was for another time: moved at Google
   * with its color kept, the appointment asks again.
   */
  private shown(event: CalendarEvent, row: LinkRow): "confirmed" | "open" {
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
      `SELECT id, calendar_id, event_id, token_sealed, answer, answer_start, answered_at, revoked_at, answer_day, answer_count FROM zur_appointment_links WHERE ${where}`,
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

const EMPTY: Omit<ConfirmView, "state" | "clinic" | "zone" | "team"> = { first: "", start: "", end: "", type: "", online: false, place: "", cancelUntil: "", canCancel: false };

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
