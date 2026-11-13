import { type AgendaEvent, type AgendaPrefs, type AppointmentProblem, appointmentProblem, type BookedSlot, type DayClosure, dayClosure, EVENT_STATUS_COLOR, nextFreeSlot, zonedParts } from "@zuri/shared";
import { eventDays, isAppointment, localDate } from "./agenda.ts";

export { hhmm, isAppointment } from "./agenda.ts";

/**
 * The Agenda's side of the booking rule (packages/shared/src/agenda-rules.ts):
 * the day's appointments as minutes, and the check the form, dragging and a
 * click on an hour make before anything goes to Google. The server checks the
 * same again.
 */

const key = (event: Pick<AgendaEvent, "calendarId" | "id">) => `${event.calendarId}|${event.id}`;

/** The minutes of `day` an event covers (0 to 1440). */
function minutesOf(event: AgendaEvent, day: string, timeZone: string): { start: number; end: number } {
  const at = (iso: string) => {
    const date = localDate(iso, timeZone);
    if (date !== day) return date < day ? 0 : 1_440;
    const p = zonedParts(new Date(iso), timeZone);
    return p.hour * 60 + p.minute;
  };
  return { start: at(event.start), end: at(event.end) };
}

/**
 * The slots of `day` taken by other events: only appointments by default, or
 * every event that is not cancelled with `all` (a meeting also takes the hour
 * the Agenda offers as the next free one). `except` is the event being changed.
 */
export function bookedOn(events: readonly AgendaEvent[], day: string, timeZone: string, options: { except?: Pick<AgendaEvent, "calendarId" | "id"> | null; all?: boolean } = {}): BookedSlot[] {
  const skip = options.except ? key(options.except) : null;
  const out: BookedSlot[] = [];
  for (const event of events) {
    if (event.allDay || key(event) === skip) continue;
    if (options.all ? (event.colorId ?? "") === EVENT_STATUS_COLOR.cancelled : !isAppointment(event)) continue;
    const { first, last } = eventDays(event, timeZone);
    if (day < first || day > last) continue;
    out.push({ ...minutesOf(event, day, timeZone), title: event.title });
  }
  return out;
}

/** The owner's clock now: the day and the minute. */
export function clock(now: number, timeZone: string): { today: string; nowMinute: number } {
  const p = zonedParts(new Date(now), timeZone);
  return { today: localDate(now, timeZone), nowMinute: p.hour * 60 + p.minute };
}

/** What stops an appointment from `start` to `end` of `day`, or null. */
export function slotProblem(input: {
  prefs: AgendaPrefs;
  events: readonly AgendaEvent[];
  except?: Pick<AgendaEvent, "calendarId" | "id"> | null;
  day: string;
  start: number;
  end: number;
  now: number;
  timeZone: string;
}): AppointmentProblem | null {
  return appointmentProblem({
    day: input.day,
    start: input.start,
    end: input.end,
    ...clock(input.now, input.timeZone),
    hours: input.prefs,
    booked: bookedOn(input.events, input.day, input.timeZone, { except: input.except ?? null }),
  });
}

/**
 * The next free hour from a closed one, among the events read: only up to `until`, the last day the screen knows.
 * For a move, `length` is the appointment's and `except` the appointment itself, which frees its own place.
 */
export function nextFree(input: {
  prefs: AgendaPrefs;
  events: readonly AgendaEvent[];
  day: string;
  minute: number;
  until: string;
  now: number;
  timeZone: string;
  length?: number;
  except?: Pick<AgendaEvent, "calendarId" | "id"> | null;
}): { day: string; start: number } | null {
  const days = Math.round((Date.parse(`${input.until}T12:00:00Z`) - Date.parse(`${input.day}T12:00:00Z`)) / 86_400_000) + 1;
  if (days < 1) return null;
  return nextFreeSlot({
    days,
    day: input.day,
    minute: input.minute,
    ...clock(input.now, input.timeZone),
    hours: input.prefs,
    bookedOn: (day) => bookedOn(input.events, day, input.timeZone, { all: true, except: input.except ?? null }),
    ...(input.length ? { length: input.length } : {}),
  });
}

/**
 * The free starts of `day`, on the half hour, for an appointment of `length` minutes: what the form's
 * calendar offers as buttons (protótipo v52, 13/11/2026). The same check as the next free hour: lunch,
 * the closed days, the hour gone and any event not cancelled at that time. `except` frees the own place
 * of the appointment being changed.
 */
export function freeStarts(input: {
  prefs: AgendaPrefs;
  events: readonly AgendaEvent[];
  day: string;
  length: number;
  now: number;
  timeZone: string;
  except?: Pick<AgendaEvent, "calendarId" | "id"> | null;
}): number[] {
  const { today, nowMinute } = clock(input.now, input.timeZone);
  const booked = bookedOn(input.events, input.day, input.timeZone, { all: true, except: input.except ?? null });
  const out: number[] = [];
  for (let start = input.prefs.from * 60; start + input.length <= input.prefs.to * 60; start += 30) {
    if (!appointmentProblem({ day: input.day, start, end: start + input.length, today, nowMinute, hours: input.prefs, booked })) out.push(start);
  }
  return out;
}

/** Why a day of the form's calendar takes no appointment, or null: the day gone, the day closed, or no free start left. */
export type DayRefusal = { kind: "past" } | { kind: "full" } | { kind: "closed"; closure: DayClosure };

export function dayRefusal(input: Parameters<typeof freeStarts>[0]): DayRefusal | null {
  if (input.day < clock(input.now, input.timeZone).today) return { kind: "past" };
  const closure = dayClosure(input.day, input.prefs);
  if (closure) return { kind: "closed", closure };
  return freeStarts(input).length === 0 ? { kind: "full" } : null;
}
