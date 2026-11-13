import { type AgendaPrefs, bindsBooking, DEFAULT_AGENDA_PREFS } from "@zuri/shared";
import { describe, expect, it } from "vitest";
import { type BookingShape, bound, checkBooking, minuteOf } from "../src/google/booking.ts";
import type { CalendarEvent } from "../src/google/events.ts";
import { type GoogleCalendar, GoogleMeter } from "../src/google/service.ts";

/**
 * The server's booking check on its own (apps/agent/src/google/booking.ts):
 * the wall clock on a day of 23 or 25 hours, a day read only in part, a time
 * that can't be read, an appointment running late and the type read as the
 * Agenda reads it. The routes are covered in google-routes.test.ts.
 */

const SP = "America/Sao_Paulo";
const NY = "America/New_York";
const EVERY_DAY: AgendaPrefs = { ...DEFAULT_AGENDA_PREFS, workDays: [0, 1, 2, 3, 4, 5, 6], from: 9, to: 18 };

type Read = { events: CalendarEvent[]; more: boolean; skipped: string[] };

/** A Google that only lists the day, and counts how often it was asked. */
function fakeGoogle(read: Partial<Read> = {}) {
  const calls: { from: Date; to: Date }[] = [];
  const google = {
    readable: () => [{ id: "trabalho@exemplo.com.br" }],
    events: async (_calendars: unknown, from: Date, to: Date): Promise<Read> => {
      calls.push({ from, to });
      return { events: read.events ?? [], more: read.more ?? false, skipped: read.skipped ?? [] };
    },
  } as unknown as GoogleCalendar;
  return { google, calls };
}

const shape = (start: string, end: string, more: Partial<BookingShape> = {}): BookingShape => ({ allDay: false, start, end, description: "Consulta | Consultório", colorId: "", ...more });

const other = (start: string, end: string, more: Partial<CalendarEvent> = {}): CalendarEvent =>
  ({ id: "outra", calendarId: "consultorio@exemplo.com.br", title: "", start, end, allDay: false, location: "", description: "Retorno | Sala 2", etag: '"1"', colorId: "", ...more }) as CalendarEvent;

async function refusal(run: Promise<void>): Promise<{ code: string; problem?: string } | null> {
  try {
    await run;
    return null;
  } catch (error) {
    const e = error as { code: string; details?: { problem?: string } };
    return { code: e.code, ...(e.details?.problem ? { problem: e.details.problem } : {}) };
  }
}

describe("minuteOf: the owner's wall clock", () => {
  it("counts by the clock on the day the clocks spring forward and fall back", () => {
    // 14/03/2027, New York: 2:00 becomes 3:00 (a day of 23 hours). 14:00 is 840 on the clock.
    expect(minuteOf(new Date("2027-03-14T18:00:00Z"), "2027-03-14", NY)).toBe(14 * 60);
    expect(minuteOf(new Date("2027-03-14T13:00:00Z"), "2027-03-14", NY)).toBe(9 * 60);
    // 07/11/2027: 2:00 goes back to 1:00 (25 hours). 07:30 is 450.
    expect(minuteOf(new Date("2027-11-07T12:30:00Z"), "2027-11-07", NY)).toBe(7 * 60 + 30);
    // The next day goes on counting, the day before goes below zero.
    expect(minuteOf(new Date("2026-11-17T03:30:00Z"), "2026-11-16", SP)).toBe(1_440 + 30);
    expect(minuteOf(new Date("2026-11-16T02:00:00Z"), "2026-11-16", SP)).toBe(-60);
  });
});

describe("checkBooking", () => {
  const meter = () => new GoogleMeter(12);
  const now = new Date("2026-11-16T13:00:00Z"); // Monday 16/11/2026, 10:00 in São Paulo

  it("agrees with the screen on a day of 23 hours: 09:00 and 14:00 by the clock go, 08:00 and lunch do not", async () => {
    const at = { hours: EVERY_DAY, timeZone: NY, meter: meter(), now: new Date("2027-03-10T12:00:00Z") };
    expect(await refusal(checkBooking({ ...at, google: fakeGoogle().google, after: shape("2027-03-14T13:00:00Z", "2027-03-14T14:00:00Z") }))).toBeNull();
    expect(await refusal(checkBooking({ ...at, google: fakeGoogle().google, after: shape("2027-03-14T18:00:00Z", "2027-03-14T19:00:00Z") }))).toBeNull();
    expect(await refusal(checkBooking({ ...at, google: fakeGoogle().google, after: shape("2027-03-14T12:00:00Z", "2027-03-14T13:00:00Z") }))).toEqual({ code: "VALIDATION_FAILED", problem: "hours" });
    expect(await refusal(checkBooking({ ...at, google: fakeGoogle().google, after: shape("2027-03-14T16:00:00Z", "2027-03-14T17:00:00Z") }))).toEqual({ code: "VALIDATION_FAILED", problem: "lunch" });
  });

  it("agrees on a day of 25 hours: 17:30 to 18:30 by the clock is past the hours", async () => {
    const at = { hours: EVERY_DAY, timeZone: NY, meter: meter(), now: new Date("2027-11-01T12:00:00Z") };
    expect(await refusal(checkBooking({ ...at, google: fakeGoogle().google, after: shape("2027-11-07T22:30:00Z", "2027-11-07T23:30:00Z") }))).toEqual({ code: "VALIDATION_FAILED", problem: "hours" });
    expect(await refusal(checkBooking({ ...at, google: fakeGoogle().google, after: shape("2027-11-07T22:00:00Z", "2027-11-07T23:00:00Z") }))).toBeNull();
  });

  it("refuses without reading the day when a fixed rule fails, and reads it once when they pass", async () => {
    const lunch = fakeGoogle();
    expect(await refusal(checkBooking({ google: lunch.google, hours: DEFAULT_AGENDA_PREFS, timeZone: SP, meter: meter(), now, after: shape("2026-11-17T15:00:00Z", "2026-11-17T16:00:00Z") }))).toMatchObject({ problem: "lunch" });
    expect(lunch.calls).toHaveLength(0);
    const free = fakeGoogle();
    await checkBooking({ google: free.google, hours: DEFAULT_AGENDA_PREFS, timeZone: SP, meter: meter(), now, after: shape("2026-11-17T12:00:00Z", "2026-11-17T13:00:00Z") });
    expect(free.calls).toHaveLength(1);
    // The owner's day, from 0:00 to 0:00 in São Paulo.
    expect(free.calls[0]?.from.toISOString()).toBe("2026-11-17T03:00:00.000Z");
    expect(free.calls[0]?.to.toISOString()).toBe("2026-11-18T03:00:00.000Z");
  });

  it("fails closed when the day was read only in part: another appointment may hide in what was left", async () => {
    const after = shape("2026-11-17T12:00:00Z", "2026-11-17T13:00:00Z");
    const base = { hours: DEFAULT_AGENDA_PREFS, timeZone: SP, meter: meter(), now, after };
    expect(await refusal(checkBooking({ ...base, google: fakeGoogle({ skipped: ["consultorio@exemplo.com.br"] }).google }))).toEqual({ code: "SERVICE_UNAVAILABLE" });
    expect(await refusal(checkBooking({ ...base, google: fakeGoogle({ more: true }).google }))).toEqual({ code: "SERVICE_UNAVAILABLE" });
    expect(await refusal(checkBooking({ ...base, google: fakeGoogle().google }))).toBeNull();
  });

  it("refuses a time it can't read instead of letting it through", async () => {
    const run = checkBooking({ google: fakeGoogle().google, hours: DEFAULT_AGENDA_PREFS, timeZone: SP, meter: meter(), now, after: shape("amanhã", "2026-11-17T13:00:00Z") });
    expect(await refusal(run)).toEqual({ code: "VALIDATION_FAILED" });
  });

  it("finds a clash in another calendar, frees the appointment's own place, and ignores a cancelled one", async () => {
    const base = { hours: DEFAULT_AGENDA_PREFS, timeZone: SP, meter: meter(), now };
    const there = other("2026-11-17T13:00:00Z", "2026-11-17T14:00:00Z");
    expect(await refusal(checkBooking({ ...base, google: fakeGoogle({ events: [there] }).google, after: shape("2026-11-17T13:30:00Z", "2026-11-17T14:30:00Z") }))).toMatchObject({ problem: "clash" });
    // Moving itself half an hour on: its own old place does not count.
    const before = { ...shape("2026-11-17T13:00:00Z", "2026-11-17T14:00:00Z"), id: there.id, calendarId: there.calendarId };
    expect(await refusal(checkBooking({ ...base, before, google: fakeGoogle({ events: [there] }).google, after: shape("2026-11-17T13:30:00Z", "2026-11-17T14:30:00Z") }))).toBeNull();
    expect(await refusal(checkBooking({ ...base, google: fakeGoogle({ events: [{ ...there, colorId: "11" }] }).google, after: shape("2026-11-17T13:30:00Z", "2026-11-17T14:30:00Z") }))).toBeNull();
  });

  it("fixes the day and the hours of an appointment once it began, and still lets the rest change (Pablo, 13/11/2026)", async () => {
    // Today 10:00 to 11:00; at 10:40 the end can't go to 11:30.
    const late = new Date("2026-11-16T13:40:00Z");
    const base = { hours: DEFAULT_AGENDA_PREFS, timeZone: SP, meter: meter(), now: late };
    const before = { ...shape("2026-11-16T13:00:00Z", "2026-11-16T14:00:00Z"), id: "esta", calendarId: "trabalho@exemplo.com.br" };
    expect(await refusal(checkBooking({ ...base, before, google: fakeGoogle().google, after: shape("2026-11-16T13:00:00Z", "2026-11-16T14:30:00Z") }))).toMatchObject({ problem: "past" });
    // Same day and hours (a new title, a new status): it goes.
    expect(await refusal(checkBooking({ ...base, before, google: fakeGoogle().google, after: shape("2026-11-16T13:00:00Z", "2026-11-16T14:00:00Z", { colorId: "10" }) }))).toBeNull();
    // A cancelled one from this morning is not booked again.
    expect(await refusal(checkBooking({ ...base, before: { ...before, colorId: "11" }, google: fakeGoogle().google, after: shape("2026-11-16T13:00:00Z", "2026-11-16T14:00:00Z") }))).toMatchObject({ problem: "past" });
    expect(await refusal(checkBooking({ ...base, google: fakeGoogle().google, after: shape("2026-11-16T13:00:00Z", "2026-11-16T14:00:00Z") }))).toMatchObject({ problem: "past" });
  });
});

describe("bound: the same test as the Agenda's", () => {
  it.each([
    ["Consulta | Consultório", true],
    ["Retorno | Sala 2", true],
    ["Consulta", true],
    ["Reunião com o contador", false],
    ["Reunião |", false],
    ["<b>Consulta</b> | Sala", false],
    ["Consulta | https://x.exemplo.com.br", false],
    ["", false],
  ])("%j is an appointment: %s", (description, expected) => {
    const event = { allDay: false, description, colorId: "" };
    expect(bound(event)).toBe(expected);
    expect(bindsBooking(event)).toBe(expected);
  });

  it("reads the description cut as the Agenda gets it, so a type past the cut binds nowhere", () => {
    const event = { allDay: false, description: `${"a".repeat(9_000)}\nConsulta | Sala`, colorId: "" };
    expect(bound(event)).toBe(false);
  });

  it("leaves out an all-day or cancelled event", () => {
    expect(bound({ allDay: true, description: "Consulta | Sala", colorId: "" })).toBe(false);
    expect(bound({ allDay: false, description: "Consulta | Sala", colorId: "11" })).toBe(false);
  });
});
