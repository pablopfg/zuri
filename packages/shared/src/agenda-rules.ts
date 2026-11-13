import type { AgendaPrefs } from "./agenda-prefs.ts";
import { EVENT_STATUS_COLOR } from "./google.ts";
import { type NationalHoliday, nationalHoliday } from "./holidays.ts";

/**
 * When an appointment may be booked (13/11/2026, 00:44 UTC). One rule for the
 * whole system: the Agenda's form, dragging, Alt + arrows, the contact's
 * "Agendar" and, later, the patient's link all ask it, and the server asks it
 * again before writing to Google. Only appointments (events with a type, such
 * as "Consulta | Consultório") are bound by it: a meeting or an errand may sit
 * at any hour. No Zod here: the Agenda imports this file (rule P11).
 *
 * Days are "YYYY-MM-DD" and times are minutes from the day's 0:00, both on the
 * owner's wall clock.
 */
const plain = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const KNOWN_TYPE = /^(?:primeira consulta|consulta|retorno|avaliacao|atendimento)(?:\s|$)/;

/**
 * The line of a description that is the appointment's type: a line shaped
 * "Type | Place" whose type has a letter, is at most 80 characters and is no
 * address or tag. One that says "Consulta" or "Retorno" wins over any other
 * line that happens to hold a "|"; without a shaped line, the first that
 * begins with "Consulta" or "Retorno". "" when the event has no type. The
 * Agenda and the server's booking check both read the type with it, so the
 * screen and the server never disagree on what is an appointment.
 */
export function typeLine(description: string): string {
  const lines = description.split("\n").map((line) => line.trim());
  const shaped = lines.filter((line) => {
    const type = /^([^|<>]{1,80})\|\s*[^|<>\s][^|<>]{0,119}$/.exec(line)?.[1] ?? "";
    return /\p{L}/u.test(type) && !line.includes("://");
  });
  return shaped.find((line) => KNOWN_TYPE.test(plain(line))) ?? lines.find((line) => /^(?:primeira consulta|consulta|retorno)(?:\s|$)/.test(plain(line)) && !/[|<>]/.test(line)) ?? shaped[0] ?? "";
}

/** Whether the booking rule binds an event: timed, with a type, not cancelled. */
export function bindsBooking(event: { allDay: boolean; description: string; colorId?: string | undefined }): boolean {
  return !event.allDay && (event.colorId ?? "") !== EVENT_STATUS_COLOR.cancelled && typeLine(event.description) !== "";
}

export const AGENDA_RULES = /* @__PURE__ */ Object.freeze({
  /** Start and end fall on a multiple of 5 minutes. */
  step: 5,
  /** The shortest and the longest appointment, in minutes. */
  minMinutes: 15,
  maxMinutes: 240,
  /** How far ahead an appointment may be: past it is a typo in the year. */
  aheadDays: 365,
  /** The lunch break: whole half hours, up to 3 h, with at least half an hour of work before and after. */
  lunchStep: 30,
  lunchMax: 180,
  lunchMargin: 30,
  /** How many days off and open holidays the settings keep. */
  closedMax: 100,
  openHolidaysMax: 40,
  closedReasonMax: 40,
});

/** Why a day takes no appointment: not a working day, a national holiday the owner did not open, or a day off. */
export type DayClosure = { kind: "weekday" } | { kind: "holiday"; holiday: NationalHoliday } | { kind: "closed"; reason: string };

/** What stops an appointment, in the order the owner fixes it. */
export type AppointmentProblem =
  | { code: "step"; field: "start" }
  | { code: "short"; field: "end" }
  | { code: "long"; field: "end" }
  | { code: "past"; field: "start" }
  | { code: "far"; field: "date" }
  | { code: "weekday"; field: "date" }
  | { code: "holiday"; field: "date"; holiday: NationalHoliday }
  | { code: "closed"; field: "date"; reason: string }
  | { code: "hours"; field: "start" }
  | { code: "lunch"; field: "start" }
  | { code: "clash"; field: "start"; title: string; start: number; end: number };

export type AppointmentProblemCode = AppointmentProblem["code"];

/** The part of the Agenda's settings the rule reads. */
export type OpeningHours = Pick<AgendaPrefs, "from" | "to" | "workDays" | "lunch" | "openHolidays" | "closed">;

/** Another appointment of the same day, in minutes: only these clash (a meeting only warns, on the screen). */
export interface BookedSlot {
  start: number;
  end: number;
  title: string;
}

const DAY_MS = 86_400_000;
const noon = (day: string) => {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d, 12);
};

/** 0 (Sunday) to 6 (Saturday). */
export function weekdayOf(day: string): number {
  return new Date(noon(day)).getUTCDay();
}

/** A day plus some days, as "YYYY-MM-DD". */
export function dayPlus(day: string, days: number): string {
  return new Date(noon(day) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Why a day is closed, or null when it takes appointments. */
export function dayClosure(day: string, hours: Pick<OpeningHours, "workDays" | "openHolidays" | "closed">): DayClosure | null {
  if (!hours.workDays.includes(weekdayOf(day))) return { kind: "weekday" };
  const holiday = nationalHoliday(day);
  if (holiday && !hours.openHolidays.includes(day)) return { kind: "holiday", holiday };
  const off = hours.closed.find((each) => each.date === day);
  return off ? { kind: "closed", reason: off.reason } : null;
}

/** Whether [start, end) leaves the opening hours or touches the lunch break, on an open day. */
export function outsideHours(start: number, end: number, hours: Pick<OpeningHours, "from" | "to" | "lunch">): "hours" | "lunch" | null {
  if (start < hours.from * 60 || end > hours.to * 60) return "hours";
  if (hours.lunch && start < hours.lunch.to && end > hours.lunch.from) return "lunch";
  return null;
}

/**
 * Everything that stops an appointment on `day` from `start` to `end`, or null
 * when it may be booked. `today` and `nowMinute` are the owner's clock; `booked`
 * are the day's other appointments, cancelled ones already left out.
 */
/**
 * `keepsStart`: a change that keeps the start the event already has in Google
 * (only its end moves, or a cancelled one comes back). It may then have begun:
 * an appointment running late, or one whose real length is set afterwards, is
 * not "in the past". Every other rule still holds.
 */
export function appointmentProblem(input: { day: string; start: number; end: number; today: string; nowMinute: number; hours: OpeningHours; booked?: readonly BookedSlot[]; keepsStart?: boolean }): AppointmentProblem | null {
  const { day, start, end, today, hours } = input;
  if (start % AGENDA_RULES.step !== 0 || end % AGENDA_RULES.step !== 0) return { code: "step", field: "start" };
  if (end - start < AGENDA_RULES.minMinutes) return { code: "short", field: "end" };
  if (end - start > AGENDA_RULES.maxMinutes) return { code: "long", field: "end" };
  if (!input.keepsStart && (day < today || (day === today && start < input.nowMinute))) return { code: "past", field: "start" };
  if (day > dayPlus(today, AGENDA_RULES.aheadDays)) return { code: "far", field: "date" };
  const closure = dayClosure(day, hours);
  if (closure?.kind === "weekday") return { code: "weekday", field: "date" };
  if (closure?.kind === "holiday") return { code: "holiday", field: "date", holiday: closure.holiday };
  if (closure?.kind === "closed") return { code: "closed", field: "date", reason: closure.reason };
  const outside = outsideHours(start, end, hours);
  if (outside) return { code: outside, field: "start" };
  const clash = input.booked?.find((other) => other.start < end && other.end > start);
  if (clash) return { code: "clash", field: "start", title: clash.title, start: clash.start, end: clash.end };
  return null;
}

/**
 * The first free hour-long slot from `day` and `minute` on, on the half hour,
 * within the next `days` days: what the Agenda offers when a closed hour is
 * clicked. `bookedOn` gives each day's appointments and meetings (both take
 * the hour: the owner is busy either way).
 */
export function nextFreeSlot(input: {
  day: string;
  minute: number;
  today: string;
  nowMinute: number;
  hours: OpeningHours;
  bookedOn: (day: string) => readonly BookedSlot[];
  length?: number;
  days?: number;
}): { day: string; start: number } | null {
  const length = input.length ?? 60;
  const first = input.day < input.today ? input.today : input.day;
  for (let offset = 0; offset < (input.days ?? 60); offset++) {
    const day = dayPlus(first, offset);
    const from = offset === 0 ? Math.max(input.hours.from * 60, Math.ceil(input.minute / 30) * 30) : input.hours.from * 60;
    const booked = input.bookedOn(day);
    for (let start = from; start + length <= input.hours.to * 60; start += 30) {
      if (!appointmentProblem({ day, start, end: start + length, today: input.today, nowMinute: input.nowMinute, hours: input.hours, booked })) return { day, start };
    }
  }
  return null;
}
