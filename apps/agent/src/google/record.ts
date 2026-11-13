import { type AgendaChange, dayPlus } from "@zuri/shared";
import type { Database } from "../db/database.ts";
import type { InternalState } from "../db/internal-state.ts";
import { log } from "../log.ts";
import { eventDay } from "./booking.ts";
import { type CalendarEvent, localInstant, localToday } from "./events.ts";
import { type GoogleCalendar, GoogleMeter } from "./service.ts";

/**
 * The record of the day (13/11/2026, 10:37 UTC, plan agenda-registro-do-dia.md):
 * at 0:00 of the owner's clock the Zuri reads at Google the day that ended, in
 * the calendars it may change, and keeps a copy. From then on nothing of that
 * day changes through the Zuri (booking.ts refuses it), and the Agenda shows
 * the copy: an event changed, deleted or added at Google afterwards keeps the
 * record as it was, with a mark and one notice. The copy is never deleted.
 */

/** How far back a missed day is still copied: one per wake, oldest first. */
export const RECORD_CATCH_UP_DAYS = 7;
/** One listing of the writable calendars (ten at most, one page each), a token renewal and a retry. */
const RECORD_BUDGET = 12;
/** A failed or partial reading waits this long before the next try, so a broken Google never wakes the object every minute. */
const RETRY_MS = 15 * 60_000;
const PER_CALENDAR = 100;
const MAX_EVENTS = 200;

/** An event of a closed day as the Agenda shows it: the copy, with what changed at Google after the closing. */
export type RecordedEvent = CalendarEvent & { changedAtGoogle?: AgendaChange };

export interface AgendaRecordDeps {
  db: Database;
  state: InternalState;
  google: GoogleCalendar;
  timeZone: () => string;
  /**
   * One notice per closed day and set of changes at Google after it closed (the day, never a title):
   * `versions` is a fingerprint of what changed (calendars, events and versions), so the same changes never notify twice.
   */
  notify: (notice: { day: string; versions: string }) => void;
}

interface RecordRow {
  day: string;
  calendar_id: string;
  event_id: string;
  etag: string;
  data: string;
}

export class AgendaRecord {
  constructor(private readonly deps: AgendaRecordDeps) {}

  private today(): string {
    return localToday(this.deps.timeZone(), this.deps.google.now());
  }

  /** The day to close next, or null when every day before today is closed (or too old to copy). */
  private pending(today: string, from: string): string | null {
    // Only days before today count: a day of today or later (a forged backup, a time zone moved back) never stops the record.
    const last = this.deps.db.one<{ day: string | null }>(`SELECT MAX(day) AS day FROM zur_agenda_closed_days WHERE day < ?`, today)?.day ?? null;
    let next = last && last >= from ? dayPlus(last, 1) : from;
    const oldest = dayPlus(today, -RECORD_CATCH_UP_DAYS);
    if (next < oldest) next = oldest;
    return next < today ? next : null;
  }

  /** How many days the record will never copy (more than a week behind), or 0. */
  private skipped(today: string, from: string): number {
    const last = this.deps.db.one<{ day: string | null }>(`SELECT MAX(day) AS day FROM zur_agenda_closed_days WHERE day < ?`, today)?.day ?? null;
    const next = last && last >= from ? dayPlus(last, 1) : from;
    const oldest = dayPlus(today, -RECORD_CATCH_UP_DAYS);
    return next < oldest ? Math.round((Date.parse(oldest) - Date.parse(next)) / 86_400_000) : 0;
  }

  /** When the alarm must wake for the record: now with a day to close, else the owner's next 0:00; null without Google. */
  nextDue(): number | null {
    if (!this.deps.google.usable()) return null;
    const now = this.deps.google.now().getTime();
    const retry = this.deps.state.get<number>("agenda_record_retry_at") ?? 0;
    const today = this.today();
    const from = this.deps.state.get<string>("agenda_record_from");
    if (!from || this.pending(today, from)) return Math.max(now, retry);
    return localInstant(dayPlus(today, 1), this.deps.timeZone())?.getTime() ?? now + 3_600_000;
  }

  /**
   * Closes at most one day. The first run only marks today as the first day of
   * the record: nothing from before this delivery is copied. A reading in part
   * (a page more, a calendar skipped) or a failure closes nothing and tries
   * again in 15 minutes. True when something was written, so the alarm is set again.
   */
  async tick(): Promise<boolean> {
    const { db, state, google } = this.deps;
    if (!google.usable()) return false;
    const today = this.today();
    const from = state.get<string>("agenda_record_from");
    if (!from) {
      state.set("agenda_record_from", today);
      return true;
    }
    if ((state.get<number>("agenda_record_retry_at") ?? 0) > google.now().getTime()) return false;
    const day = this.pending(today, from);
    if (!day) return false;
    // Said once, when the oldest day kept is the one closing: the days before it are past copying.
    const behind = this.skipped(today, from);
    if (behind > 0) log("warn", "agenda_record_skipped", { count: behind });
    const zone = this.deps.timeZone();
    const calendars = google.writable();
    let events: CalendarEvent[] = [];
    if (calendars.length > 0) {
      const from = localInstant(day, zone);
      const to = localInstant(dayPlus(day, 1), zone);
      if (!from || !to) return false;
      try {
        const read = await google.events(calendars, from, to, new GoogleMeter(RECORD_BUDGET), { timeZone: zone, perCalendar: PER_CALENDAR, max: MAX_EVENTS });
        if (read.more || read.skipped.length > 0) throw new Error("partial");
        events = read.events.filter((event) => sameDay(event, day, zone));
      } catch (error) {
        state.set("agenda_record_retry_at", google.now().getTime() + RETRY_MS);
        log("warn", "agenda_record_unread", { error });
        return true;
      }
    }
    const at = google.now().toISOString();
    db.transaction(() => {
      for (const event of events) {
        db.run(`INSERT OR IGNORE INTO zur_agenda_record (day, calendar_id, event_id, etag, data) VALUES (?, ?, ?, ?, ?)`, day, event.calendarId, event.id, event.etag, JSON.stringify(event));
      }
      db.run(`INSERT OR IGNORE INTO zur_agenda_closed_days (day, closed_at, events) VALUES (?, ?, ?)`, day, at, events.length);
    });
    state.delete("agenda_record_retry_at");
    return true;
  }

  /** The last day closed, when and with how many events: Configurações › Agenda shows it. */
  last(): { day: string; closedAt: string; events: number } | null {
    const row = this.deps.db.one<{ day: string; closed_at: string; events: number }>(`SELECT day, closed_at, events FROM zur_agenda_closed_days WHERE day < ? ORDER BY day DESC LIMIT 1`, this.today());
    return row ? { day: row.day, closedAt: row.closed_at, events: row.events } : null;
  }

  /**
   * The events Google gave for [fromDay, toDay], with every closed day replaced
   * by its copy, for the calendars in `calendarIds` only. `complete` is false
   * when Google's reading was partial: then an event missing at Google is not
   * called deleted. `window`, when Google was read for part of a day only
   * (a listing of some hours): a copy outside it is neither shown nor called
   * deleted. Only days before today count as closed. The differences of a day
   * raise one notice, once per set of versions.
   */
  apply(events: CalendarEvent[], fromDay: string, toDay: string, calendarIds: readonly string[], complete: boolean, window?: { from: Date; to: Date }): RecordedEvent[] {
    const { db } = this.deps;
    const today = this.today();
    const closed = new Set(
      db
        .all<{ day: string }>(`SELECT day FROM zur_agenda_closed_days WHERE day BETWEEN ? AND ?`, fromDay, toDay)
        .map((row) => row.day)
        .filter((day) => day < today),
    );
    if (closed.size === 0) return events;
    const zone = this.deps.timeZone();
    const open = new Set(calendarIds);
    const writable = new Set(this.deps.google.writable().map((calendar) => calendar.id));
    const rows = db.all<RecordRow>(`SELECT day, calendar_id, event_id, etag, data FROM zur_agenda_record WHERE day BETWEEN ? AND ?`, fromDay, toDay).filter((row) => open.has(row.calendar_id));
    // The day is part of the key: an event moved at Google from one closed day to another has a copy in each.
    const key = (day: string, calendarId: string, id: string) => `${day}\n${calendarId}\n${id}`;
    const recorded = new Map(rows.map((row) => [key(row.day, row.calendar_id, row.event_id), row]));
    const out: RecordedEvent[] = [];
    const seen = new Set<string>();
    const changes = new Map<string, string[]>();
    const changed = (day: string, calendarId: string, eventId: string, version: string) => changes.set(day, [...(changes.get(day) ?? []), `${calendarId}\n${eventId}\n${version}`]);
    for (const event of events) {
      const day = dayOf(event, zone);
      if (!day || !closed.has(day)) {
        out.push(event);
        continue;
      }
      const row = recorded.get(key(day, event.calendarId, event.id));
      if (row) {
        seen.add(key(row.day, row.calendar_id, row.event_id));
        const copy = parse(row);
        if (!copy) continue;
        if (event.etag !== row.etag) {
          out.push({ ...copy, changedAtGoogle: "changed" });
          changed(day, event.calendarId, event.id, event.etag);
        } else out.push(copy);
        continue;
      }
      if (writable.has(event.calendarId)) {
        out.push({ ...event, changedAtGoogle: "added" });
        changed(day, event.calendarId, event.id, event.etag);
      } else out.push(event);
    }
    // Copied and gone at Google (or moved to another day there): the copy stays where it was.
    for (const row of rows) {
      if (!closed.has(row.day) || seen.has(key(row.day, row.calendar_id, row.event_id))) continue;
      const copy = parse(row);
      if (!copy || (window && !overlaps(copy, window))) continue;
      if (complete) {
        out.push({ ...copy, changedAtGoogle: "deleted" });
        changed(row.day, row.calendar_id, row.event_id, "deleted");
      } else out.push(copy);
    }
    for (const [day, list] of changes) this.deps.notify({ day, versions: fingerprint(list.sort().join("\n")) });
    return out.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  }
}

function dayOf(event: CalendarEvent, zone: string): string | null {
  try {
    return eventDay(event, zone);
  } catch {
    return null;
  }
}

/** A short fingerprint of the day's changes, for the notice's key (FNV-1a twice, with two seeds: 16 hex digits). */
function fingerprint(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x01000193 ^ 0x2f) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

/** Whether the copy's time meets the window Google was read for (an all-day event spans its days in UTC, near enough). */
function overlaps(event: CalendarEvent, window: { from: Date; to: Date }): boolean {
  const start = Date.parse(event.allDay ? `${event.start}T00:00:00Z` : event.start);
  const end = Date.parse(event.allDay ? `${event.end}T00:00:00Z` : event.end);
  return start < window.to.getTime() && end > window.from.getTime();
}

function sameDay(event: CalendarEvent, day: string, zone: string): boolean {
  return dayOf(event, zone) === day;
}

function parse(row: RecordRow): CalendarEvent | null {
  try {
    return JSON.parse(row.data) as CalendarEvent;
  } catch {
    return null;
  }
}
