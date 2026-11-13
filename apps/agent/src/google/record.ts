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
  /** One notice per event and version changed at Google after its day closed (the day, never the title). */
  notify: (notice: { day: string; calendarId: string; eventId: string; etag: string }) => void;
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
  private pending(today: string): string | null {
    const from = this.deps.state.get<string>("agenda_record_from");
    if (!from) return null;
    const last = this.deps.db.one<{ day: string | null }>(`SELECT MAX(day) AS day FROM zur_agenda_closed_days`)?.day ?? null;
    let next = last && last >= from ? dayPlus(last, 1) : from;
    const oldest = dayPlus(today, -RECORD_CATCH_UP_DAYS);
    if (next < oldest) {
      log("warn", "agenda_record_skipped", { count: Math.round((Date.parse(oldest) - Date.parse(next)) / 86_400_000) });
      next = oldest;
    }
    return next < today ? next : null;
  }

  /** When the alarm must wake for the record: now with a day to close, else the owner's next 0:00; null without Google. */
  nextDue(): number | null {
    if (!this.deps.google.usable()) return null;
    const now = this.deps.google.now().getTime();
    const retry = this.deps.state.get<number>("agenda_record_retry_at") ?? 0;
    const today = this.today();
    if (!this.deps.state.get<string>("agenda_record_from") || this.pending(today)) return Math.max(now, retry);
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
    if (!state.get<string>("agenda_record_from")) {
      state.set("agenda_record_from", today);
      return true;
    }
    if ((state.get<number>("agenda_record_retry_at") ?? 0) > google.now().getTime()) return false;
    const day = this.pending(today);
    if (!day) return false;
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
    const row = this.deps.db.one<{ day: string; closed_at: string; events: number }>(`SELECT day, closed_at, events FROM zur_agenda_closed_days ORDER BY day DESC LIMIT 1`);
    return row ? { day: row.day, closedAt: row.closed_at, events: row.events } : null;
  }

  /**
   * The events Google gave for [fromDay, toDay], with every closed day replaced
   * by its copy, for the calendars in `calendarIds` only. `complete` is false
   * when Google's reading was partial: then an event missing at Google is not
   * called deleted. A difference raises its notice once per version.
   */
  apply(events: CalendarEvent[], fromDay: string, toDay: string, calendarIds: readonly string[], complete: boolean): RecordedEvent[] {
    const { db } = this.deps;
    const closed = new Set(db.all<{ day: string }>(`SELECT day FROM zur_agenda_closed_days WHERE day BETWEEN ? AND ?`, fromDay, toDay).map((row) => row.day));
    if (closed.size === 0) return events;
    const zone = this.deps.timeZone();
    const open = new Set(calendarIds);
    const writable = new Set(this.deps.google.writable().map((calendar) => calendar.id));
    const rows = db.all<RecordRow>(`SELECT day, calendar_id, event_id, etag, data FROM zur_agenda_record WHERE day BETWEEN ? AND ?`, fromDay, toDay).filter((row) => open.has(row.calendar_id));
    const key = (calendarId: string, id: string) => `${calendarId}\n${id}`;
    const recorded = new Map(rows.map((row) => [key(row.calendar_id, row.event_id), row]));
    const out: RecordedEvent[] = [];
    const seen = new Set<string>();
    for (const event of events) {
      const day = dayOf(event, zone);
      if (!day || !closed.has(day)) {
        out.push(event);
        continue;
      }
      const row = recorded.get(key(event.calendarId, event.id));
      if (row && row.day === day) {
        seen.add(key(row.calendar_id, row.event_id));
        const copy = parse(row);
        if (!copy) continue;
        if (event.etag !== row.etag) {
          out.push({ ...copy, changedAtGoogle: "changed" });
          this.deps.notify({ day, calendarId: event.calendarId, eventId: event.id, etag: event.etag });
        } else out.push(copy);
        continue;
      }
      if (writable.has(event.calendarId)) {
        out.push({ ...event, changedAtGoogle: "added" });
        this.deps.notify({ day, calendarId: event.calendarId, eventId: event.id, etag: event.etag });
      } else out.push(event);
    }
    // Copied and gone at Google (or moved to another day there): the copy stays where it was.
    for (const row of rows) {
      if (seen.has(key(row.calendar_id, row.event_id))) continue;
      const copy = parse(row);
      if (!copy) continue;
      if (complete) {
        out.push({ ...copy, changedAtGoogle: "deleted" });
        this.deps.notify({ day: row.day, calendarId: row.calendar_id, eventId: row.event_id, etag: "deleted" });
      } else out.push(copy);
    }
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
