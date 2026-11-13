import { type AgendaEvent, DEFAULT_AGENDA_PREFS } from "@zuri/shared";
import { describe, expect, it } from "vitest";
import { bookedOn, clock, hhmm, isAppointment, nextFree, slotProblem } from "../src/lib/agenda-rules.ts";
import { fitLunch, nextHolidays, parseBrDate } from "../src/pages/settings/AgendaTab.tsx";

// The Agenda's side of the booking rule (13/11/2026, 00:44 and 01:04): what the form, a drop and a click on an hour ask.

const SP = "America/Sao_Paulo";
const prefs = { ...DEFAULT_AGENDA_PREFS };
// Friday 13/11/2026, 10:00 in São Paulo.
const NOW = Date.parse("2026-11-13T13:00:00.000Z");

const event = (over: Partial<AgendaEvent> = {}): AgendaEvent => ({
  id: "e",
  calendarId: "c",
  title: "Helena Duarte Prado",
  // Monday 16/11/2026, 09:00 to 10:00 in São Paulo.
  start: "2026-11-16T12:00:00.000Z",
  end: "2026-11-16T13:00:00.000Z",
  allDay: false,
  location: "",
  description: "Consulta | Consultório",
  etag: '"1"',
  recurring: false,
  guests: 0,
  colorId: "",
  ...over,
});

describe("isAppointment and bookedOn", () => {
  it("binds only timed events with a type that are not cancelled", () => {
    expect(isAppointment(event())).toBe(true);
    expect(isAppointment(event({ description: "Reunião" }))).toBe(false);
    expect(isAppointment(event({ colorId: "11" }))).toBe(false);
    expect(isAppointment(event({ allDay: true, start: "2026-11-16", end: "2026-11-17" }))).toBe(false);
  });

  it("gives a day's appointments as minutes, without the one being changed; with `all`, meetings too", () => {
    const meeting = event({ id: "m", description: "", start: "2026-11-16T17:00:00.000Z", end: "2026-11-16T18:00:00.000Z" });
    const other = event({ id: "o", start: "2026-11-16T14:00:00.000Z", end: "2026-11-16T15:30:00.000Z" });
    const events = [event(), meeting, other, event({ id: "x", colorId: "11" })];
    expect(bookedOn(events, "2026-11-16", SP)).toEqual([
      { start: 540, end: 600, title: "Helena Duarte Prado" },
      { start: 660, end: 750, title: "Helena Duarte Prado" },
    ]);
    expect(bookedOn(events, "2026-11-16", SP, { except: event() })).toHaveLength(1);
    expect(bookedOn(events, "2026-11-16", SP, { all: true })).toHaveLength(3);
    expect(bookedOn(events, "2026-11-17", SP)).toEqual([]);
  });

  it("reads the owner's clock, not the device's", () => {
    expect(clock(NOW, SP)).toEqual({ today: "2026-11-13", nowMinute: 600 });
    expect(clock(NOW, "Asia/Tokyo")).toEqual({ today: "2026-11-13", nowMinute: 22 * 60 });
    expect(hhmm(845)).toBe("14:05");
  });
});

describe("slotProblem and nextFree", () => {
  const events = [event()];
  const check = (day: string, start: number, end = start + 60, except: AgendaEvent | null = null) => slotProblem({ prefs, events, except, day, start, end, now: NOW, timeZone: SP })?.code ?? null;

  it("refuses over another appointment, but not over itself", () => {
    expect(check("2026-11-16", 570)).toBe("clash");
    expect(check("2026-11-16", 570, 630, event())).toBeNull();
    expect(check("2026-11-16", 600)).toBeNull();
  });

  it("refuses lunch, the past and a day off of the settings", () => {
    expect(check("2026-11-16", 12 * 60)).toBe("lunch");
    expect(check("2026-11-13", 9 * 60)).toBe("past");
    expect(slotProblem({ prefs: { ...prefs, closed: [{ date: "2026-11-17", reason: "" }] }, events, day: "2026-11-17", start: 540, end: 600, now: NOW, timeZone: SP })?.code).toBe("closed");
  });

  it("offers the next free hour among the events read, never past the last day read", () => {
    expect(nextFree({ prefs, events, day: "2026-11-16", minute: 540, until: "2026-11-20", now: NOW, timeZone: SP })).toEqual({ day: "2026-11-16", start: 600 });
    expect(nextFree({ prefs, events, day: "2026-11-14", minute: 540, until: "2026-11-20", now: NOW, timeZone: SP })).toEqual({ day: "2026-11-16", start: 480 });
    expect(nextFree({ prefs, events, day: "2026-11-14", minute: 540, until: "2026-11-15", now: NOW, timeZone: SP })).toBeNull();
    expect(nextFree({ prefs, events, day: "2026-11-20", minute: 540, until: "2026-11-19", now: NOW, timeZone: SP })).toBeNull();
  });

  it("for a move, frees the appointment's own place and fits its length", () => {
    // 08:00 to 10:00 would cross Helena's 09:00; moved herself, her hour is free.
    expect(nextFree({ prefs, events, day: "2026-11-16", minute: 480, until: "2026-11-20", now: NOW, timeZone: SP, length: 120 })).toEqual({ day: "2026-11-16", start: 600 });
    expect(nextFree({ prefs, events, day: "2026-11-16", minute: 480, until: "2026-11-20", now: NOW, timeZone: SP, length: 120, except: event() })).toEqual({ day: "2026-11-16", start: 480 });
  });
});

describe("Configurações › Agenda", () => {
  it("keeps the lunch inside new hours, in half hours, or drops it when no lunch fits", () => {
    expect(fitLunch({ from: 720, to: 780 }, 8, 18)).toEqual({ from: 720, to: 780 });
    expect(fitLunch({ from: 720, to: 780 }, 13, 19)).toEqual({ from: 810, to: 810 + 30 });
    expect(fitLunch({ from: 720, to: 900 }, 8, 14)).toEqual({ from: 720, to: 810 });
    expect(fitLunch({ from: 720, to: 780 }, 8, 9)).toBeNull();
    expect(fitLunch(null, 8, 18)).toBeNull();
  });

  it("reads dd/mm/aaaa, and only real dates", () => {
    expect(parseBrDate("24/12/2026")).toBe("2026-12-24");
    expect(parseBrDate(" 1/2/2027 ")).toBe("2027-02-01");
    for (const bad of ["30/02/2026", "2026-12-24", "24/12/26", "", "24/13/2026", "aa/bb/cccc"]) expect(parseBrDate(bad), bad).toBeNull();
  });

  it("lists the next 12 national holidays that fall on an office day", () => {
    const days = nextHolidays("2026-11-13", [1, 2, 3, 4, 5]);
    expect(days[0]).toBe("2026-11-20");
    expect(days.length).toBeLessThanOrEqual(12);
    // 15/11/2026 is a Sunday: left out; on a seven-day week it is there.
    expect(days).not.toContain("2026-11-15");
    expect(nextHolidays("2026-11-13", [0, 1, 2, 3, 4, 5, 6])).toContain("2026-11-15");
  });
});
