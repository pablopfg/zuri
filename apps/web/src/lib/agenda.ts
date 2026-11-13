import { type AgendaEvent, AGENDA_LIMITS, bindsBooking, typeLine, type AgendaPrefs, type AgendaView, type EventStatus, eventStatus, frozenDay, type GoogleCalendarInfo, zonedParts } from "@zuri/shared";

export { typeLine };

/**
 * The Agenda screen's dates (step 19). Days are "YYYY-MM-DD" in the owner's
 * time zone; the arithmetic runs on those strings at noon UTC, so a change of
 * daylight saving time never moves a day.
 */

/** Under "calendar": the area's number refreshes it (lib/versions.ts) on this screen and in Integrations. */
export const GOOGLE_STATUS_KEY = ["calendar", "status"] as const;

export type { AgendaView };
export const AGENDA_VIEWS: readonly AgendaView[] = ["day", "week", "month"];

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;
const DAY_MS = 86_400_000;
const pad = (n: number) => String(n).padStart(2, "0");

export function isDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export function isTime(value: string): boolean {
  if (!TIME.test(value)) return false;
  const [h, m] = value.split(":").map(Number) as [number, number];
  return h < 24 && m < 60;
}

function noon(date: string): Date {
  return new Date(`${date}T12:00:00Z`);
}

export function addDays(date: string, days: number): string {
  return new Date(noon(date).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekday(date: string): number {
  return noon(date).getUTCDay();
}

export function addMonths(date: string, months: number): string {
  const d = noon(date);
  const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1, 12));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0, 12)).getUTCDate();
  first.setUTCDate(Math.min(d.getUTCDate(), last));
  return first.toISOString().slice(0, 10);
}

/** The owner's calendar date of an instant. */
export function localDate(at: Date | string | number, timeZone: string): string {
  const p = zonedParts(new Date(at), timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** "HH:MM" of an instant in the owner's zone. */
export function localTime(at: Date | string | number, timeZone: string): string {
  const p = zonedParts(new Date(at), timeZone);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** The first and last day (both inclusive) a view shows around `anchor`. Weeks start on Monday, or on Sunday when the owner says so. */
export function viewRange(view: AgendaView, anchor: string, weekStart: 0 | 1 = 1): { from: string; to: string } {
  if (view === "day") return { from: anchor, to: anchor };
  const monday = (date: string) => addDays(date, -((weekday(date) + 7 - weekStart) % 7));
  if (view === "week") {
    const from = monday(anchor);
    return { from, to: addDays(from, 6) };
  }
  const first = `${anchor.slice(0, 8)}01`;
  const last = addDays(addMonths(first, 1), -1);
  const from = monday(first);
  const to = addDays(monday(last), 6);
  return { from, to };
}

/** Every day from `from` to `to`, inclusive. */
export function daysOf(from: string, to: string): string[] {
  const days: string[] = [];
  // At most the screen's longest window: never a runaway loop on a bad range.
  for (let day = from; day <= to && days.length <= AGENDA_LIMITS.windowDays; day = addDays(day, 1)) days.push(day);
  return days;
}

/** Where the arrows go: a day, a week or a month at a time. */
export function step(view: AgendaView, anchor: string, direction: 1 | -1): string {
  if (view === "day") return addDays(anchor, direction);
  if (view === "week") return addDays(anchor, 7 * direction);
  return addMonths(anchor, direction);
}

/** The owner's days an event covers (an all-day event's end is the day after its last). */
export function eventDays(event: AgendaEvent, timeZone: string): { first: string; last: string } {
  if (event.allDay) {
    const last = addDays(event.end, -1);
    return { first: event.start, last: last < event.start ? event.start : last };
  }
  const first = localDate(event.start, timeZone);
  const endMs = Date.parse(event.end);
  // An event that ends at midnight belongs to the day before; one with no length to its own day.
  const last = endMs > Date.parse(event.start) ? localDate(endMs - 1, timeZone) : first;
  return { first, last: last < first ? first : last };
}

/** The events of one day: all-day ones first, then by start. */
export function eventsOn(events: readonly AgendaEvent[], day: string, timeZone: string): AgendaEvent[] {
  return events
    .filter((event) => {
      const { first, last } = eventDays(event, timeZone);
      return first <= day && day <= last;
    })
    .sort((a, b) => (a.allDay === b.allDay ? (a.start < b.start ? -1 : a.start > b.start ? 1 : 0) : a.allDay ? -1 : 1));
}

/** "Consulta" of "Consulta | Consultório". */
export function typeName(line: string): string {
  return (line.split("|")[0] ?? "").trim();
}

/** A description without its type line, and one with `type` as its first line. */
export function withoutType(description: string): string {
  const type = typeLine(description);
  if (!type) return description;
  const lines = description.split("\n");
  lines.splice(
    lines.findIndex((line) => line.trim() === type),
    1,
  );
  return lines.join("\n").trim();
}
export function withType(rest: string, type: string): string {
  return [type.trim(), rest].filter(Boolean).join("\n");
}

/** The lengths the form offers, in minutes; any other is "Outra" and shows the end's own fields. */
export const DURATIONS = [15, 30, 45, 60, 90, 120, 180] as const;
export const OTHER_DURATION = "other";

/** A date and an hour, `minutes` later. */
export function later(date: string, time: string, minutes: number): { date: string; time: string } {
  const total = (Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))) + minutes;
  return { date: addDays(date, Math.floor(total / 1440)), time: `${pad(Math.floor((total % 1440) / 60))}:${pad(total % 60)}` };
}

export interface EventForm {
  calendarId: string;
  title: string;
  allDay: boolean;
  startDate: string;
  startTime: string;
  /** How long an event with hours lasts: one of DURATIONS (as text) or "other", and then the end's own fields count. */
  duration: string;
  endDate: string;
  endTime: string;
  /** The appointment's type, the first line of the description at Google ("Consulta | Consultório"); "" for none. */
  type: string;
  /** The status, which is the color at Google; null for an event whose color is none of the four. */
  status: EventStatus | null;
  location: string;
  /** The description without its type line. */
  description: string;
}

/**
 * A new event: one hour long, at `time` when the owner clicked an hour of the
 * week, else at the next whole hour of the day chosen (today: from now).
 */
export function blankForm(day: string, calendarId: string, timeZone: string, now = Date.now(), time?: string, minutes = 60): EventForm {
  const today = localDate(now, timeZone);
  const hour = day === today ? Math.min(zonedParts(new Date(now), timeZone).hour + 1, 23) : 9;
  const startTime = time ?? `${pad(hour)}:00`;
  const end = later(day, startTime, minutes);
  return {
    calendarId,
    title: "",
    allDay: false,
    startDate: day,
    startTime,
    duration: String(minutes),
    endDate: end.date,
    endTime: end.time,
    type: "",
    status: "scheduled",
    location: "",
    description: "",
  };
}

/** An event as the form shows it: the owner's dates and hours, an all-day end inclusive. */
export function formOf(event: AgendaEvent, timeZone: string): EventForm {
  const base = {
    calendarId: event.calendarId,
    title: event.title,
    location: event.location,
    type: typeLine(event.description),
    description: withoutType(event.description),
    status: eventStatus(event.colorId ?? ""),
  };
  if (event.allDay) {
    const { first, last } = eventDays(event, timeZone);
    return { ...base, allDay: true, startDate: first, startTime: "09:00", duration: "60", endDate: last, endTime: "10:00" };
  }
  const minutes = (Date.parse(event.end) - Date.parse(event.start)) / 60_000;
  return {
    ...base,
    allDay: false,
    startDate: localDate(event.start, timeZone),
    startTime: localTime(event.start, timeZone),
    duration: (DURATIONS as readonly number[]).includes(minutes) ? String(minutes) : OTHER_DURATION,
    endDate: localDate(event.end, timeZone),
    endTime: localTime(event.end, timeZone),
  };
}

export type FormProblem = "title" | "date" | "end";

/** What the server gets: local dates or date-times (the server places them in the owner's zone). */
export function formBody(form: EventForm): { title: string; allDay: boolean; start: string; end: string; location: string; description: string } | FormProblem {
  const title = form.title.trim();
  if (!title) return "title";
  const text = { location: form.location.trim(), description: withType(form.description, form.type) };
  if (!isDate(form.startDate)) return "date";
  if (form.allDay) {
    if (!isDate(form.endDate)) return "date";
    if (form.endDate < form.startDate) return "end";
    return { title, allDay: true, start: form.startDate, end: form.endDate, ...text };
  }
  if (!isTime(form.startTime)) return "date";
  const start = `${form.startDate}T${form.startTime}`;
  if (form.duration !== OTHER_DURATION) {
    const minutes = Number(form.duration);
    if (!(minutes > 0)) return "date";
    const end = later(form.startDate, form.startTime, minutes);
    return { title, allDay: false, start, end: `${end.date}T${end.time}`, ...text };
  }
  if (!isDate(form.endDate) || !isTime(form.endTime)) return "date";
  const end = `${form.endDate}T${form.endTime}`;
  if (end <= start) return "end";
  return { title, allDay: false, start, end, ...text };
}

/** Only what changed, for a PATCH: the server keeps the rest as it is at Google. */
export function changedFields(before: EventForm, after: ReturnType<typeof formBody> & object): Record<string, string | boolean> {
  const original = formBody(before);
  const out: Record<string, string | boolean> = {};
  if (typeof original === "string") return { ...after };
  for (const key of ["title", "location", "description"] as const) if (after[key] !== original[key]) out[key] = after[key];
  if (after.allDay !== original.allDay || after.start !== original.start || after.end !== original.end) {
    out.allDay = after.allDay;
    out.start = after.start;
    out.end = after.end;
  }
  return out;
}

/** The slice of the preferences that decides what a day shows. */
export type DayPrefs = Pick<AgendaPrefs, "from" | "to" | "outside">;

/**
 * The shortest block the week draws, in minutes of its scale: a 5-minute event is still a button
 * the owner can hit (44.8 px at the week's 56 px an hour).
 */
export const BLOCK_MIN = 48;

export interface DayBlock {
  event: AgendaEvent;
  /** Where the block sits in the working hours, as fractions of them (0 = the first hour's line). */
  top: number;
  height: number;
  /** Side by side with what overlaps it: its column and how many columns its group has. */
  lane: number;
  lanes: number;
}

export interface DayPlan {
  allDay: AgendaEvent[];
  /** Over before the working hours start, and starting when they are over. */
  before: AgendaEvent[];
  after: AgendaEvent[];
  /** What touches the working hours, cut to them. */
  blocks: DayBlock[];
}

/** The minutes of `day` (0 to 1440) an event with hours covers; a zero-length one covers its own minute. */
function minutesOn(event: AgendaEvent, day: string, timeZone: string): { start: number; end: number } {
  const minute = (at: number) => {
    const date = localDate(at, timeZone);
    if (date !== day) return date < day ? 0 : 24 * 60;
    const p = zonedParts(new Date(at), timeZone);
    return p.hour * 60 + p.minute;
  };
  const start = minute(Date.parse(event.start));
  return { start, end: Math.max(minute(Date.parse(event.end)), start) };
}

/**
 * One day of the week view: the all-day events, what falls wholly outside the
 * working hours and, for the rest, where each block goes. Overlapping events
 * share the width; an event that crosses the edge of the hours is cut to them.
 */
export function planDay(events: readonly AgendaEvent[], day: string, hours: { from: number; to: number }, timeZone: string): DayPlan {
  const plan: DayPlan = { allDay: [], before: [], after: [], blocks: [] };
  const [from, to] = [hours.from * 60, hours.to * 60];
  const span = to - from;
  const min = Math.min(BLOCK_MIN, span);
  const placed: { event: AgendaEvent; start: number; end: number; lane: number; group: number }[] = [];
  for (const event of eventsOn(events, day, timeZone)) {
    if (event.allDay) {
      plan.allDay.push(event);
      continue;
    }
    const at = minutesOn(event, day, timeZone);
    // An event ending as the hours start is before them; one of no length at that very minute is inside.
    if (at.end <= from && at.start < from) plan.before.push(event);
    else if (at.start >= to) plan.after.push(event);
    else {
      // Room for the shortest block, never past the last line.
      const start = Math.min(Math.max(at.start, from), to - min);
      placed.push({ event, start, end: Math.max(Math.min(at.end, to), start + min), lane: 0, group: 0 });
    }
  }
  // eventsOn sorted by start; the cut above can only pull a start back, so sort again by where the block is drawn.
  placed.sort((a, b) => a.start - b.start || b.end - a.end);
  const free: number[] = [];
  let group = -1;
  let groupEnd = Number.NEGATIVE_INFINITY;
  const lanes: number[] = [];
  for (const block of placed) {
    if (block.start >= groupEnd) {
      group++;
      free.length = 0;
      groupEnd = block.end;
    }
    groupEnd = Math.max(groupEnd, block.end);
    let lane = free.findIndex((end) => end <= block.start);
    if (lane === -1) lane = free.length;
    free[lane] = block.end;
    block.lane = lane;
    block.group = group;
    lanes[group] = Math.max(lanes[group] ?? 0, lane + 1);
  }
  plan.blocks = placed.map(({ event, start, end, lane, group: g }) => ({ event, top: (start - from) / span, height: (end - start) / span, lane, lanes: lanes[g] ?? 1 }));
  return plan;
}

/** Whether an event with hours has no part inside the working hours of `day`. */
export function outsideHours(event: AgendaEvent, day: string, hours: { from: number; to: number }, timeZone: string): boolean {
  if (event.allDay) return false;
  const at = minutesOn(event, day, timeZone);
  return (at.end <= hours.from * 60 && at.start < hours.from * 60) || at.start >= hours.to * 60;
}

/**
 * What a day lists under the preferences, and how many events they left out.
 * Nothing leaves without a count: the screen shows it beside "Mostrar". All-day
 * events always show (the "Dia todo" choice left on 13/11/2026).
 */
export function dayEvents(events: readonly AgendaEvent[], day: string, prefs: DayPrefs, timeZone: string): { events: AgendaEvent[]; outside: number } {
  const out = { events: [] as AgendaEvent[], outside: 0 };
  for (const event of eventsOn(events, day, timeZone)) {
    if (!event.allDay && !prefs.outside && outsideHours(event, day, prefs, timeZone)) out.outside++;
    else out.events.push(event);
  }
  return out;
}

/** The days of a week the owner sees: the working ones, and the days off when asked. */
export function shownDays(days: readonly string[], prefs: Pick<AgendaPrefs, "workDays" | "daysOff">): string[] {
  return prefs.daysOff ? [...days] : days.filter((day) => prefs.workDays.includes(weekday(day)));
}

/** How far into the working hours an instant of `day` is (0 to 1), or null outside them. */
export function nowAt(now: number, day: string, hours: { from: number; to: number }, timeZone: string): number | null {
  if (localDate(now, timeZone) !== day) return null;
  const p = zonedParts(new Date(now), timeZone);
  const minute = p.hour * 60 + p.minute;
  if (minute < hours.from * 60 || minute >= hours.to * 60) return null;
  return (minute - hours.from * 60) / ((hours.to - hours.from) * 60);
}

/**
 * Google's colors for an event, by their number there (the names are in the
 * catalog). Basil is a token: it gets lighter in the dark theme.
 */
export const EVENT_COLORS: Readonly<Record<string, string>> = {
  "1": "#7986cb",
  "2": "#33b679",
  "3": "#8e24aa",
  "4": "#e67c73",
  "5": "#f6bf26",
  "6": "#f4511e",
  "7": "#039be5",
  "8": "#616161",
  "9": "#3f51b5",
  "10": "var(--color-basil)",
  "11": "#d50000",
};
/** An event without a color of its own counts as "Agendado", which is Peacock. */
const NO_COLOR = "7";

export interface EventLook {
  /** Whether the event is in a calendar open for editing: only there the color means a status and can change. */
  editable: boolean;
  status: EventStatus | null;
  /** What paints the event: its color at Google where it means a status, its calendar's elsewhere. */
  color: string | undefined;
}

/**
 * How an event shows. In a calendar open for editing, its color at Google is
 * the appointment's status (none counts as "Agendado"; a color outside the four
 * shows as it is, without a status). In any other calendar the event keeps its
 * calendar's color and has no status.
 */
export function eventLook(event: Pick<AgendaEvent, "colorId">, calendar: Pick<GoogleCalendarInfo, "mode" | "writable" | "color"> | undefined): EventLook {
  const editable = !!calendar && calendar.mode === "write" && calendar.writable;
  if (!editable) return { editable, status: null, color: calendar?.color };
  // An event read before the color existed in the answer has none.
  const colorId = event.colorId ?? "";
  return { editable, status: eventStatus(colorId), color: EVENT_COLORS[colorId || NO_COLOR] };
}

/**
 * Whether the event's day already closed (the record of the day, 13/11/2026): the
 * day it starts on, in the owner's clock, is before today. The server says the same.
 */
export function isFrozen(event: Pick<AgendaEvent, "start" | "allDay">, today: string, timeZone: string): boolean {
  return frozenDay(event.allDay ? event.start.slice(0, 10) : localDate(event.start, timeZone), today);
}

/** Saturday or Sunday, whatever the owner's working days are. */
export function isWeekend(day: string): boolean {
  const n = weekday(day);
  return n === 0 || n === 6;
}

/** Whether an event is bound by the rule: it has a type ("Consulta | Consultório") and is not cancelled. */
/** Whether the booking rule binds an event: the same test the server makes (packages/shared/src/agenda-rules.ts). */
export function isAppointment(event: Pick<AgendaEvent, "description" | "colorId" | "allDay">): boolean {
  return bindsBooking(event);
}

/** "14:05" of 845 minutes. */
export function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}
