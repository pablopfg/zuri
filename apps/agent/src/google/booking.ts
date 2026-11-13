import { type AgendaPrefs, type AppointmentProblemCode, appointmentProblem, type BookedSlot, bindsBooking, GOOGLE_LIMITS, type MessageKey, zonedParts } from "@zuri/shared";
import { AppError } from "../http/errors.ts";
import { type CalendarEvent, cleanBlock, localInstant, localToday, nextDay } from "./events.ts";
import type { GoogleCalendar, GoogleMeter } from "./service.ts";

/**
 * The server's copy of the booking rule (13/11/2026, 00:44 UTC): what the
 * Agenda checked on the screen is checked again here, before Google is asked,
 * so a stale tab, a second device or a hand-made request never books an
 * appointment at lunch, on a holiday or over another one. Only appointments
 * (an event with a type in its description) are bound; a meeting is free.
 */

const MESSAGE: Record<AppointmentProblemCode, MessageKey> = {
  step: "error.agendaRule.step",
  short: "error.agendaRule.short",
  long: "error.agendaRule.long",
  past: "error.agendaRule.past",
  far: "error.agendaRule.far",
  weekday: "error.agendaRule.weekday",
  holiday: "error.agendaRule.holiday",
  closed: "error.agendaRule.closed",
  hours: "error.agendaRule.hours",
  lunch: "error.agendaRule.lunch",
  clash: "error.agendaRule.clash",
};

/** An event as the rule needs it: timed or not, its type line and its color. */
export interface BookingShape {
  allDay: boolean;
  start: string;
  end: string;
  description: string;
  colorId: string;
}

/**
 * Whether the rule binds an event: timed, with a type, not cancelled. The same
 * test the Agenda makes (`bindsBooking` in packages/shared), on the description
 * as the Agenda receives it (cleaned and cut like every event Google sends).
 */
export function bound(event: Pick<BookingShape, "allDay" | "description" | "colorId">): boolean {
  return bindsBooking({ allDay: event.allDay, colorId: event.colorId, description: cleanBlock(event.description, GOOGLE_LIMITS.descriptionMax) });
}

/** An event as it will be at Google once `body` (a create, or a PATCH over `current`) is applied. */
export function shapeOf(body: Record<string, unknown>, current: BookingShape): BookingShape {
  const time = (value: unknown): { at?: string; allDay?: boolean } => {
    if (!value || typeof value !== "object") return {};
    const { date, dateTime } = value as { date?: unknown; dateTime?: unknown };
    if (typeof dateTime === "string") return { at: dateTime, allDay: false };
    if (typeof date === "string") return { at: date, allDay: true };
    return {};
  };
  const start = time(body.start);
  const end = time(body.end);
  return {
    allDay: start.allDay ?? current.allDay,
    start: start.at ?? current.start,
    end: end.at ?? current.end,
    description: typeof body.description === "string" ? body.description : current.description,
    colorId: body.colorId === null ? "" : typeof body.colorId === "string" ? body.colorId : current.colorId,
  };
}

const DAY_MS = 86_400_000;

/**
 * The minute of `day` an instant falls on, by the owner's wall clock (as the
 * Agenda counts it, so a day of 23 or 25 hours agrees with the screen); a later
 * day goes on counting by 1440 a day, an earlier one goes below 0.
 */
export function minuteOf(at: Date, day: string, timeZone: string): number {
  const p = zonedParts(at, timeZone);
  const local = `${String(p.year).padStart(4, "0")}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
  const days = Math.round((Date.parse(`${local}T12:00:00Z`) - Date.parse(`${day}T12:00:00Z`)) / DAY_MS);
  return days * 1_440 + p.hour * 60 + p.minute;
}

const refuse = (code: AppointmentProblemCode) => new AppError("VALIDATION_FAILED", MESSAGE[code], { problem: code });

/** Where an appointment falls on the owner's wall clock, as the rule reads it. */
function placeOf(after: BookingShape, hours: AgendaPrefs, timeZone: string, now: Date) {
  const start = new Date(after.start);
  const end = new Date(after.end);
  // Fail closed: an appointment whose time can't be read is never written.
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw new AppError("VALIDATION_FAILED", "error.googleEventDate");
  const day = localToday(timeZone, start);
  const clock = zonedParts(now, timeZone);
  return { day, start: minuteOf(start, day, timeZone), end: minuteOf(end, day, timeZone), today: localToday(timeZone, now), nowMinute: clock.hour * 60 + clock.minute, hours };
}

/**
 * The rule's refusal of a new appointment that needs no call to Google
 * (everything but a clash), or null: a flow checks all its items with it
 * before making the first event.
 */
export function fixedProblem(after: BookingShape, hours: AgendaPrefs, timeZone: string, now: Date): AppointmentProblemCode | null {
  if (!bound(after)) return null;
  return appointmentProblem(placeOf(after, hours, timeZone, now))?.code ?? null;
}

/**
 * Throws the rule's refusal when `after` may not be booked. `before` is the
 * event as Google has it, for a change: one that keeps its day and hours is
 * never refused (an old appointment outside today's
 * hours is still editable). Reads the day's other events from the calendars
 * the Agenda shows, with its own meter.
 */
export async function checkBooking(input: {
  after: BookingShape;
  before?: (BookingShape & Pick<CalendarEvent, "id" | "calendarId">) | undefined;
  google: GoogleCalendar;
  hours: AgendaPrefs;
  timeZone: string;
  meter: GoogleMeter;
  now?: Date;
}): Promise<void> {
  const { after, before, timeZone } = input;
  if (!bound(after)) return;
  if (before && bound(before) && Date.parse(before.start) === Date.parse(after.start) && Date.parse(before.end) === Date.parse(after.end)) return;
  const base = placeOf(after, input.hours, timeZone, input.now ?? new Date());
  const { day } = base;
  // Everything but a clash first: no call to Google for a lunch hour.
  const fixed = appointmentProblem(base);
  if (fixed) throw refuse(fixed.code);
  const from = localInstant(day, timeZone);
  const to = localInstant(nextDay(day), timeZone);
  if (!from || !to) throw new AppError("VALIDATION_FAILED", "error.googleEventDate");
  const { events, more, skipped } = await input.google.events(input.google.readable(), from, to, input.meter, { timeZone, perCalendar: 100, max: 200 });
  // A day read in part could hide the other appointment: no write until the whole day is read.
  if (more || skipped.length > 0) throw new AppError("SERVICE_UNAVAILABLE", "error.agendaRule.unread");
  const booked: BookedSlot[] = events
    .filter((other) => bound(other) && !(before && other.id === before.id && other.calendarId === before.calendarId))
    .map((other) => ({ start: minuteOf(new Date(other.start), day, timeZone), end: minuteOf(new Date(other.end), day, timeZone), title: "" }));
  const clash = appointmentProblem({ ...base, booked });
  if (clash) throw refuse(clash.code);
}
