import { type AgendaEvent, EVENT_STATUS_COLOR, type EventStatus, eventStatus, zonedTimeToUtc } from "@zuri/shared";
import { addDays, eventDays, localDate, localTime, typeLine } from "./agenda.ts";

/**
 * Changing an event on the Agenda itself (sons, menu e agenda, delivery 3):
 * dragging it to another day or hour, pulling its end, and what a change sends
 * to Google and how it is taken back. Pure functions: the screen draws them.
 *
 * Days and hours are the owner's zone's. A slot is one day and its minutes
 * (0 to 1440), moved in steps of a quarter of an hour.
 */

/** The step of a drag and of Alt + arrows, and the shortest an event gets. */
export const STEP_MIN = 15;
const DAY_MIN = 24 * 60;
/** How long "Desfazer" stays on offer. */
export const UNDO_MS = 8_000;

export interface Slot {
  day: string;
  /** Minutes of `day` (0 to 1440); the end is exclusive and at most 24:00. */
  start: number;
  end: number;
}

/** Working hours as the week draws them (whole hours). */
export interface Hours {
  from: number;
  to: number;
}

const pad = (n: number) => String(n).padStart(2, "0");
const minuteOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

/** The slot of an event that has hours and stays within one day; null for any other (it does not drag). */
export function slotOf(event: AgendaEvent, timeZone: string): Slot | null {
  if (event.allDay) return null;
  const { first, last } = eventDays(event, timeZone);
  if (first !== last) return null;
  const start = minuteOf(localTime(event.start, timeZone));
  // Ending at midnight is 24:00 of its own day, not 0:00 of the next.
  const end = localDate(event.end, timeZone) === first ? minuteOf(localTime(event.end, timeZone)) : DAY_MIN;
  return end > start ? { day: first, start, end } : null;
}

export function snap(minutes: number): number {
  return Math.round(minutes / STEP_MIN) * STEP_MIN;
}

/**
 * The slot moved to `day` and `by` minutes later (or earlier), keeping its
 * length. A move of the day alone keeps the hour exactly as it was, even one
 * off the quarter or past the hours on screen: only what the owner moved
 * changes. A new hour lands on the quarter, inside the hours on screen and
 * within its day; an event longer than those hours starts with them.
 */
export function moveSlot(slot: Slot, day: string, by: number, hours: Hours): Slot {
  const length = slot.end - slot.start;
  if (snap(by) === 0) return { ...slot, day };
  const start = slot.start + snap(by);
  const first = hours.from * 60;
  const latest = Math.max(first, Math.min(hours.to * 60, DAY_MIN) - length);
  const at = Math.min(Math.max(snap(start), first), Math.min(latest, DAY_MIN - length));
  return { day, start: at, end: at + length };
}

/** The slot ending at `end`: at least one step long, and not past the hours on screen (or where it already ended, if later). */
export function resizeSlot(slot: Slot, end: number, hours: Hours): Slot {
  const last = Math.min(Math.max(hours.to * 60, slot.end), DAY_MIN);
  return { ...slot, end: Math.min(Math.max(snap(end), slot.start + STEP_MIN), last) };
}

const local = (day: string, minutes: number) => (minutes >= DAY_MIN ? `${addDays(day, 1)}T00:00` : `${day}T${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`);

/** A slot as the server takes it: local date-times, 24:00 written as the next day's 0:00. */
export function slotTimes(slot: Slot): { start: string; end: string } {
  return { start: local(slot.day, slot.start), end: local(slot.day, slot.end) };
}

/** What a PATCH may carry: the fields of the form and the color (the status). */
export interface EventChanges {
  title?: string;
  allDay?: boolean;
  start?: string;
  end?: string;
  location?: string;
  description?: string;
  colorId?: string;
}

/**
 * What moving an event to `slot` sends. A new day or hour marks an appointment
 * (an event with a type) that was "Agendado" or "Confirmado" as "Reagendado"
 * (owner's choice, 12/11/2026); a new length alone never does.
 */
export function slotChanges(event: AgendaEvent, slot: Slot, status: EventStatus | null, timeZone: string): { changes: EventChanges; moved: boolean; rescheduled: boolean } | null {
  const before = slotOf(event, timeZone);
  if (!before || (before.day === slot.day && before.start === slot.start && before.end === slot.end)) return null;
  const moved = before.day !== slot.day || before.start !== slot.start;
  const rescheduled = moved && reschedules(event, status);
  const changes: EventChanges = slotTimes(slot);
  if (rescheduled) changes.colorId = EVENT_STATUS_COLOR.rescheduled;
  return { changes, moved, rescheduled };
}

/** Whether a new day or hour turns this event into "Reagendado". */
export function reschedules(event: Pick<AgendaEvent, "description">, status: EventStatus | null): boolean {
  return (status === "scheduled" || status === "confirmed") && typeLine(event.description) !== "";
}

const instant = (value: string, timeZone: string): string | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  return zonedTimeToUtc({ year: Number(m[1]), month: Number(m[2]), day: Number(m[3]), hour: Number(m[4]), minute: Number(m[5]) }, timeZone)?.toISOString() ?? null;
};

/** The event as it will be once Google takes `changes`: what the screen shows while the answer is on its way. */
export function applyChanges(event: AgendaEvent, changes: EventChanges, timeZone: string): AgendaEvent {
  const next: AgendaEvent = { ...event };
  if (changes.title !== undefined) next.title = changes.title;
  if (changes.location !== undefined) next.location = changes.location;
  if (changes.description !== undefined) next.description = changes.description;
  if (changes.colorId !== undefined) next.colorId = changes.colorId;
  if (changes.start === undefined || changes.end === undefined) return next;
  if (changes.allDay ?? event.allDay) return { ...next, allDay: true, start: changes.start.slice(0, 10), end: addDays(changes.end.slice(0, 10), 1) };
  const [start, end] = [instant(changes.start, timeZone), instant(changes.end, timeZone)];
  return start && end ? { ...next, allDay: false, start, end } : next;
}

/** The change that undoes `changes`: the same fields, as they were in `before`. */
export function reverseChanges(before: AgendaEvent, changes: EventChanges, timeZone: string): EventChanges {
  const back: EventChanges = {};
  for (const key of ["title", "location", "description", "colorId"] as const) if (changes[key] !== undefined) back[key] = before[key];
  if (changes.start !== undefined || changes.end !== undefined || changes.allDay !== undefined) {
    back.allDay = before.allDay;
    if (before.allDay) {
      const { first, last } = eventDays(before, timeZone);
      back.start = first;
      back.end = last;
    } else {
      back.start = `${localDate(before.start, timeZone)}T${localTime(before.start, timeZone)}`;
      back.end = `${localDate(before.end, timeZone)}T${localTime(before.end, timeZone)}`;
    }
  }
  return back;
}

/**
 * Whether a change can be taken back. One that put a status over a color outside the four cannot: Zuri
 * only ever writes the four status colors, so the color the event had would not come back.
 */
export function canUndo(before: Pick<AgendaEvent, "colorId">, changes: EventChanges): boolean {
  return changes.colorId === undefined || eventStatus(before.colorId) !== null;
}

/** Whether another event with hours, not cancelled, takes part of this one's time. All-day events never clash. */
export function clashes(event: AgendaEvent, others: readonly AgendaEvent[]): boolean {
  if (event.allDay || eventStatus(event.colorId) === "cancelled") return false;
  const [start, end] = [Date.parse(event.start), Date.parse(event.end)];
  return others.some(
    (other) =>
      !(other.id === event.id && other.calendarId === event.calendarId) &&
      !other.allDay &&
      eventStatus(other.colorId) !== "cancelled" &&
      Date.parse(other.start) < end &&
      Date.parse(other.end) > start,
  );
}
