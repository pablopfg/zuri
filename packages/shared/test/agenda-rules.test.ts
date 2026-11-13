import { describe, expect, it } from "vitest";
import { AGENDA_RULES, appointmentProblem, DEFAULT_AGENDA_PREFS, dayClosure, dayPlus, nextFreeSlot, outsideHours, weekdayOf } from "../src/index.ts";

// Friday 13/11/2026, 10:00 on the owner's clock; the office as a new installation has it.
const hours = { ...DEFAULT_AGENDA_PREFS };
const now = { today: "2026-11-13", nowMinute: 600 };
const at = (day: string, start: number, end = start + 60, more: Partial<typeof hours> = {}, booked: { start: number; end: number; title: string }[] = []) =>
  appointmentProblem({ day, start, end, ...now, hours: { ...hours, ...more }, booked })?.code ?? null;

describe("appointmentProblem", () => {
  it("takes an hour inside the office hours of a working day", () => {
    expect(at("2026-11-16", 9 * 60)).toBeNull();
    expect(at("2026-11-13", 14 * 60)).toBeNull();
    // From the first minute to the last, and right after lunch.
    expect(at("2026-11-16", 8 * 60)).toBeNull();
    expect(at("2026-11-16", 17 * 60)).toBeNull();
    expect(at("2026-11-16", 14 * 60)).toBeNull();
  });

  it("refuses in the order the owner fixes it, with the field to fix", () => {
    expect(appointmentProblem({ day: "2026-11-16", start: 543, end: 600, ...now, hours })).toEqual({ code: "step", field: "start" });
    expect(appointmentProblem({ day: "2026-11-16", start: 540, end: 550, ...now, hours })).toEqual({ code: "short", field: "end" });
    expect(appointmentProblem({ day: "2026-11-16", start: 540, end: 540 + 245, ...now, hours })).toEqual({ code: "long", field: "end" });
    // The step wins over a past day: both are wrong, the minutes first.
    expect(at("2026-11-12", 543)).toBe("step");
  });

  it("refuses what has passed, today included, and a date more than a year away", () => {
    expect(at("2026-11-12", 9 * 60)).toBe("past");
    expect(at("2026-11-13", 9 * 60)).toBe("past");
    expect(at("2026-11-13", 10 * 60)).toBeNull();
    expect(at(dayPlus("2026-11-13", AGENDA_RULES.aheadDays), 9 * 60, undefined, { workDays: [0, 1, 2, 3, 4, 5, 6] })).toBeNull();
    expect(appointmentProblem({ day: "2027-11-15", start: 540, end: 600, ...now, hours })?.field).toBe("date");
  });

  it("closes the days without office hours, the holidays not opened and the days off", () => {
    expect(at("2026-11-14", 9 * 60)).toBe("weekday");
    expect(at("2026-11-20", 9 * 60)).toBe("holiday");
    expect(appointmentProblem({ day: "2026-11-20", start: 540, end: 600, ...now, hours })).toMatchObject({ code: "holiday", holiday: "blackAwareness", field: "date" });
    expect(at("2026-11-20", 9 * 60, undefined, { openHolidays: ["2026-11-20"] })).toBeNull();
    expect(appointmentProblem({ day: "2026-12-24", start: 540, end: 600, ...now, hours: { ...hours, closed: [{ date: "2026-12-24", reason: "Recesso" }] } })).toMatchObject({ code: "closed", reason: "Recesso" });
    // Saturday opened as a working day.
    expect(at("2026-11-14", 9 * 60, undefined, { workDays: [1, 2, 3, 4, 5, 6] })).toBeNull();
  });

  it("refuses outside the hours and over lunch, by a single minute too", () => {
    expect(at("2026-11-16", 7 * 60 + 55)).toBe("hours");
    expect(at("2026-11-16", 17 * 60 + 5)).toBe("hours");
    expect(at("2026-11-16", 11 * 60 + 5)).toBe("lunch");
    expect(at("2026-11-16", 13 * 60 + 55, 14 * 60 + 30)).toBe("lunch");
    expect(at("2026-11-16", 12 * 60, 13 * 60, { lunch: null })).toBeNull();
  });

  it("holds the limits exactly: 15 and 240 minutes go, 10 and 245 do not; a year ahead goes, a day more does not", () => {
    const every = { workDays: [0, 1, 2, 3, 4, 5, 6], from: 0, to: 24, lunch: null };
    expect(at("2026-11-16", 9 * 60, 9 * 60 + 15)).toBeNull();
    expect(at("2026-11-16", 9 * 60, 9 * 60 + 10)).toBe("short");
    expect(at("2026-11-16", 8 * 60, 12 * 60, { lunch: null })).toBeNull();
    expect(at("2026-11-16", 8 * 60, 12 * 60 + 5, { lunch: null })).toBe("long");
    expect(at(dayPlus("2026-11-13", AGENDA_RULES.aheadDays), 9 * 60, undefined, every)).toBeNull();
    expect(at(dayPlus("2026-11-13", AGENDA_RULES.aheadDays + 1), 9 * 60, undefined, every)).toBe("far");
    // An end off the 5-minute step is the step too.
    expect(appointmentProblem({ day: "2026-11-16", start: 540, end: 603, ...now, hours })).toEqual({ code: "step", field: "start" });
  });

  it("puts the year before the day of the week, and the day off before the hours", () => {
    // Saturday more than a year away: the year is what to fix first.
    expect(at("2027-11-20", 9 * 60)).toBe("far");
    // A day off at 7:00: the day comes before the hour.
    expect(at("2026-12-24", 7 * 60, undefined, { closed: [{ date: "2026-12-24", reason: "Recesso" }] })).toBe("closed");
  });

  it("fixes an appointment once it began: pulling its end is the past too (Pablo, 13/11/2026)", () => {
    // 10:00 now: the 9:00 appointment can't run to 10:30.
    expect(appointmentProblem({ day: "2026-11-13", start: 540, end: 630, ...now, hours })?.code).toBe("past");
    expect(appointmentProblem({ day: "2026-11-13", start: 600, end: 660, ...now, hours })).toBeNull();
  });

  it("refuses over another appointment and names it, touching edges allowed", () => {
    const booked = [{ start: 9 * 60, end: 10 * 60, title: "Ana Souza" }];
    expect(appointmentProblem({ day: "2026-11-16", start: 9 * 60 + 30, end: 10 * 60 + 30, ...now, hours, booked })).toEqual({ code: "clash", field: "start", title: "Ana Souza", start: 540, end: 600 });
    expect(at("2026-11-16", 10 * 60, 11 * 60, {}, booked)).toBeNull();
    expect(at("2026-11-16", 8 * 60, 9 * 60, {}, booked)).toBeNull();
  });
});

describe("dayClosure and outsideHours", () => {
  it("names why a day is closed, or null", () => {
    expect(dayClosure("2026-11-16", hours)).toBeNull();
    expect(dayClosure("2026-11-15", hours)).toEqual({ kind: "weekday" });
    expect(dayClosure("2026-12-25", hours)).toEqual({ kind: "holiday", holiday: "christmas" });
    expect(dayClosure("2026-12-31", { ...hours, closed: [{ date: "2026-12-31", reason: "" }] })).toEqual({ kind: "closed", reason: "" });
  });

  it("tells the hours from the lunch", () => {
    expect(outsideHours(9 * 60, 10 * 60, hours)).toBeNull();
    expect(outsideHours(7 * 60, 8 * 60 + 30, hours)).toBe("hours");
    expect(outsideHours(12 * 60 + 15, 12 * 60 + 45, hours)).toBe("lunch");
  });

  it("counts weekdays and days at noon UTC, across a month and a year", () => {
    expect(weekdayOf("2026-11-13")).toBe(5);
    expect(dayPlus("2026-12-31", 1)).toBe("2027-01-01");
    expect(dayPlus("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("nextFreeSlot", () => {
  const free = (day: string, minute: number, bookedOn = () => [], days?: number) => nextFreeSlot({ day, minute, ...now, hours, bookedOn, ...(days ? { days } : {}) });

  it("offers the next hour on the half hour, skipping lunch, closed days and what is taken", () => {
    expect(free("2026-11-16", 12 * 60 + 10)).toEqual({ day: "2026-11-16", start: 14 * 60 });
    expect(free("2026-11-14", 9 * 60)).toEqual({ day: "2026-11-16", start: 8 * 60 });
    expect(free("2026-11-13", 17 * 60 + 30)).toEqual({ day: "2026-11-16", start: 8 * 60 });
    const busy = (day: string) => (day === "2026-11-16" ? [{ start: 8 * 60, end: 9 * 60 + 30, title: "" }] : []);
    expect(nextFreeSlot({ day: "2026-11-16", minute: 0, ...now, hours, bookedOn: busy })).toEqual({ day: "2026-11-16", start: 9 * 60 + 30 });
  });

  it("starts from now when asked about the past, and gives up past its days", () => {
    expect(free("2026-11-10", 9 * 60)).toEqual({ day: "2026-11-13", start: 10 * 60 });
    expect(free("2026-11-14", 9 * 60, () => [], 2)).toBeNull();
  });
});
