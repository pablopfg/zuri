import type { AgendaEvent } from "@zuri/shared";
import { describe, expect, it } from "vitest";
import { addDays, addMonths, BLOCK_MIN, blankForm, changedFields, DURATIONS, dayEvents, daysOf, EVENT_COLORS, eventDays, eventLook, eventsOn, formBody, formOf, isDate, isTime, isWeekend, later, nowAt, OTHER_DURATION, outsideHours, planDay, shownDays, step, typeLine, typeName, viewRange, withoutType, withType } from "../src/lib/agenda.ts";

const SP = "America/Sao_Paulo";
const NY = "America/New_York";

const event = (over: Partial<AgendaEvent>): AgendaEvent => ({
  id: "e",
  calendarId: "c",
  title: "Evento",
  start: "2026-11-03T13:00:00.000Z",
  end: "2026-11-03T14:00:00.000Z",
  allDay: false,
  location: "",
  description: "",
  etag: '"1"',
  recurring: false,
  guests: 0,
  colorId: "",
  ...over,
});

describe("the Agenda's days", () => {
  it("adds days and months across the year and the end of a month", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2026-01-15", -1)).toBe("2025-12-15");
  });

  it("a day of daylight saving time is still one day", () => {
    // New York moves its clocks on 1 November 2026.
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-11-01", 1)).toBe("2026-11-02");
  });

  it("checks dates and hours", () => {
    expect(isDate("2026-02-29")).toBe(false);
    expect(isDate("2028-02-29")).toBe(true);
    expect(isDate("2026-13-01")).toBe(false);
    expect(isDate("26-11-03")).toBe(false);
    expect(isTime("23:59")).toBe(true);
    expect(isTime("24:00")).toBe(false);
    expect(isTime("9:00")).toBe(false);
  });

  it("weeks start on Monday; the month grid covers whole weeks, never more than the server's window", () => {
    expect(viewRange("day", "2026-11-03")).toEqual({ from: "2026-11-03", to: "2026-11-03" });
    expect(viewRange("week", "2026-11-03")).toEqual({ from: "2026-11-02", to: "2026-11-08" });
    expect(viewRange("week", "2026-11-08")).toEqual({ from: "2026-11-02", to: "2026-11-08" });
    expect(viewRange("month", "2026-11-17")).toEqual({ from: "2026-10-26", to: "2026-12-06" });
    // A month that spans six weeks: 42 days, inside the 43 the server takes.
    const { from, to } = viewRange("month", "2026-08-10");
    expect(daysOf(from, to)).toHaveLength(42);
    expect(step("month", "2026-01-31", 1)).toBe("2026-02-28");
    expect(step("week", "2026-11-03", -1)).toBe("2026-10-27");
    expect(step("day", "2026-11-03", 1)).toBe("2026-11-04");
  });

  it("never loops past the longest window on a bad range", () => {
    expect(daysOf("2026-01-01", "2026-12-31").length).toBeLessThanOrEqual(44);
    expect(daysOf("2026-02-01", "2026-01-01")).toEqual([]);
  });
});

describe("which days an event covers", () => {
  it("timed: the owner's days, an end at midnight belongs to the day before", () => {
    // 22:00 to 01:00 in São Paulo: two days.
    expect(eventDays(event({ start: "2026-11-04T01:00:00.000Z", end: "2026-11-04T04:00:00.000Z" }), SP)).toEqual({ first: "2026-11-03", last: "2026-11-04" });
    // 22:00 to midnight: one day.
    expect(eventDays(event({ start: "2026-11-04T01:00:00.000Z", end: "2026-11-04T03:00:00.000Z" }), SP)).toEqual({ first: "2026-11-03", last: "2026-11-03" });
    // No length at all: its own day.
    expect(eventDays(event({ start: "2026-11-04T01:00:00.000Z", end: "2026-11-04T01:00:00.000Z" }), SP)).toEqual({ first: "2026-11-03", last: "2026-11-03" });
    // The same instant is another day in New York.
    expect(eventDays(event({ start: "2026-11-04T03:30:00.000Z", end: "2026-11-04T04:00:00.000Z" }), NY)).toEqual({ first: "2026-11-03", last: "2026-11-03" });
  });

  it("all day: Google's end is the day after the last", () => {
    expect(eventDays(event({ allDay: true, start: "2026-11-03", end: "2026-11-04" }), SP)).toEqual({ first: "2026-11-03", last: "2026-11-03" });
    expect(eventDays(event({ allDay: true, start: "2026-11-03", end: "2026-11-06" }), SP)).toEqual({ first: "2026-11-03", last: "2026-11-05" });
    // A broken end (before the start) still shows on its first day.
    expect(eventDays(event({ allDay: true, start: "2026-11-03", end: "2026-11-01" }), SP)).toEqual({ first: "2026-11-03", last: "2026-11-03" });
  });

  it("a day lists all-day events first, then by start", () => {
    const late = event({ id: "late", start: "2026-11-03T20:00:00.000Z", end: "2026-11-03T21:00:00.000Z" });
    const early = event({ id: "early", start: "2026-11-03T11:00:00.000Z", end: "2026-11-03T12:00:00.000Z" });
    const whole = event({ id: "whole", allDay: true, start: "2026-11-02", end: "2026-11-05" });
    const other = event({ id: "other", start: "2026-11-05T11:00:00.000Z", end: "2026-11-05T12:00:00.000Z" });
    expect(eventsOn([late, other, early, whole], "2026-11-03", SP).map((e) => e.id)).toEqual(["whole", "early", "late"]);
  });
});

describe("the event form", () => {
  it("a new event: the next whole hour today, nine o'clock another day, never past midnight in the hour box", () => {
    const at = (iso: string) => Date.parse(iso);
    expect(blankForm("2026-11-03", "c", SP, at("2026-11-03T13:20:00Z"))).toMatchObject({ startDate: "2026-11-03", startTime: "11:00", endDate: "2026-11-03", endTime: "12:00" });
    expect(blankForm("2026-11-05", "c", SP, at("2026-11-03T13:20:00Z"))).toMatchObject({ startTime: "09:00", endTime: "10:00" });
    // 22:40 in São Paulo: 23:00 to midnight, the end on the next day.
    expect(blankForm("2026-11-03", "c", SP, at("2026-11-04T01:40:00Z"))).toMatchObject({ startDate: "2026-11-03", startTime: "23:00", endDate: "2026-11-04", endTime: "00:00" });
  });

  it("an event as the form shows it, and back: local times, an all-day end inclusive", () => {
    const timed = formOf(event({ title: "Dentista", location: "Rua A" }), SP);
    expect(timed).toMatchObject({ allDay: false, startDate: "2026-11-03", startTime: "10:00", endDate: "2026-11-03", endTime: "11:00", title: "Dentista", location: "Rua A" });
    expect(formBody(timed)).toEqual({ title: "Dentista", allDay: false, start: "2026-11-03T10:00", end: "2026-11-03T11:00", location: "Rua A", description: "" });
    const whole = formOf(event({ allDay: true, start: "2026-11-03", end: "2026-11-05" }), SP);
    expect(whole).toMatchObject({ allDay: true, startDate: "2026-11-03", endDate: "2026-11-04" });
    expect(formBody(whole)).toMatchObject({ allDay: true, start: "2026-11-03", end: "2026-11-04" });
  });

  it("refuses an empty title, a bad date and an end not after the start", () => {
    const base = blankForm("2026-11-05", "c", SP, Date.parse("2026-11-03T13:00:00Z"));
    expect(formBody({ ...base, title: "   " })).toBe("title");
    expect(formBody({ ...base, title: "x", startDate: "2026-02-30" })).toBe("date");
    expect(formBody({ ...base, title: "x", startTime: "25:00" })).toBe("date");
    // The end's own fields count only with "Outra" as the length.
    expect(formBody({ ...base, title: "x", endTime: "09:00" })).toMatchObject({ end: "2026-11-05T10:00" });
    expect(formBody({ ...base, title: "x", duration: "other", endTime: "09:00" })).toBe("end");
    expect(formBody({ ...base, title: "x", duration: "other", endTime: "9h" })).toBe("date");
    expect(formBody({ ...base, title: "x", duration: "0" })).toBe("date");
    expect(formBody({ ...base, title: "x", duration: "abc" })).toBe("date");
    expect(formBody({ ...base, title: "x", allDay: true, endDate: "2026-11-04" })).toBe("end");
    // All day on a single day is fine: the end is inclusive.
    expect(formBody({ ...base, title: "x", allDay: true })).toMatchObject({ start: "2026-11-05", end: "2026-11-05" });
  });

  it("a change sends only what changed, the three time fields together", () => {
    const before = formOf(event({ title: "Dentista" }), SP);
    const renamed = formBody({ ...before, title: "Dentista (remarcado)" });
    if (typeof renamed === "string") throw new Error(renamed);
    expect(changedFields(before, renamed)).toEqual({ title: "Dentista (remarcado)" });
    const moved = formBody({ ...before, startTime: "15:00" });
    if (typeof moved === "string") throw new Error(moved);
    expect(changedFields(before, moved)).toEqual({ allDay: false, start: "2026-11-03T15:00", end: "2026-11-03T16:00" });
    const same = formBody(before);
    if (typeof same === "string") throw new Error(same);
    expect(changedFields(before, same)).toEqual({});
  });
});

describe("the form's length, type and status (sons, menu e agenda, delivery 3)", () => {
  it("the length is one of the list or, for any other, the end's own fields", () => {
    expect(formOf(event({}), SP).duration).toBe("60");
    expect(formOf(event({ end: "2026-11-03T13:15:00.000Z" }), SP).duration).toBe("15");
    expect(formOf(event({ end: "2026-11-03T16:00:00.000Z" }), SP).duration).toBe("180");
    // 50 minutes and an event that crosses the night are not in the list.
    expect(formOf(event({ end: "2026-11-03T13:50:00.000Z" }), SP)).toMatchObject({ duration: OTHER_DURATION, endDate: "2026-11-03", endTime: "10:50" });
    expect(formOf(event({ end: "2026-11-04T13:00:00.000Z" }), SP)).toMatchObject({ duration: OTHER_DURATION, endDate: "2026-11-04" });
    expect([...DURATIONS]).toEqual([15, 30, 45, 60, 90, 120, 180]);
  });

  it("the end follows the start by the length, into the next day when it passes midnight", () => {
    const base = { ...blankForm("2026-11-05", "c", SP, Date.parse("2026-11-03T13:00:00Z")), title: "x" };
    expect(formBody({ ...base, startTime: "14:15", duration: "45" })).toMatchObject({ start: "2026-11-05T14:15", end: "2026-11-05T15:00" });
    expect(formBody({ ...base, startTime: "23:00", duration: "60" })).toMatchObject({ end: "2026-11-06T00:00" });
    expect(formBody({ ...base, startTime: "23:30", duration: "180" })).toMatchObject({ end: "2026-11-06T02:30" });
    expect(later("2026-12-31", "23:45", 15)).toEqual({ date: "2027-01-01", time: "00:00" });
    expect(later("2026-11-05", "09:00", 0)).toEqual({ date: "2026-11-05", time: "09:00" });
  });

  it("a new event starts at the hour clicked on the week", () => {
    expect(blankForm("2026-11-05", "c", SP, Date.parse("2026-11-03T13:00:00Z"), "14:30")).toMatchObject({ startTime: "14:30", endDate: "2026-11-05", endTime: "15:30", duration: "60", status: "scheduled", type: "" });
  });

  it("the type is the description's line shaped \"Type | Place\", or one that begins with Consulta or Retorno", () => {
    expect(typeLine("Consulta | Consultório")).toBe("Consulta | Consultório");
    expect(typeLine("CPF 000\n  Retorno | Consultório  \nobs")).toBe("Retorno | Consultório");
    expect(typeLine("Retorno em 30 dias")).toBe("Retorno em 30 dias");
    expect(typeLine("consulta")).toBe("consulta");
    expect(typeLine("Consultoria de vendas")).toBe("");
    expect(typeLine("Levar exames")).toBe("");
    // "Primeira consulta" and a type with an accent count; so does "Avaliação", only as "Type | Place".
    expect(typeLine("Primeira consulta")).toBe("Primeira consulta");
    expect(typeLine("Avaliação física | Consultório")).toBe("Avaliação física | Consultório");
    // QA-E3-05: an address, a tag or a line without letters before the "|" is no type.
    expect(typeLine("https://exemplo.com.br/a|b")).toBe("");
    expect(typeLine("<p>Consulta | Consultório</p>")).toBe("");
    expect(typeLine("123 | 456")).toBe("");
    expect(typeLine(`${"x".repeat(81)}| Sala`)).toBe("");
    expect(typeLine(`${"x".repeat(80)}| Sala`)).toBe(`${"x".repeat(80)}| Sala`);
    // A line that says "Consulta" or "Retorno" wins over another that happens to hold a "|".
    expect(typeLine("Obs: ligar | urgente\nRetorno | Consultório")).toBe("Retorno | Consultório");
    expect(typeLine("Obs: ligar | urgente\nRetorno")).toBe("Retorno");
    // Without one, the first shaped line is the type, as the server reads it.
    expect(typeLine("Sala 2 | 3º andar")).toBe("Sala 2 | 3º andar");
    expect(typeLine("| sem tipo")).toBe("");
    expect(typeLine("Tipo |")).toBe("");
    expect(typeLine("")).toBe("");
    expect(typeName("Avaliação física | Consultório")).toBe("Avaliação física");
    expect(typeName("Retorno em 30 dias")).toBe("Retorno em 30 dias");
    expect(typeName("")).toBe("");
  });

  it("the form splits the type from the rest of the description and joins them back", () => {
    const form = formOf(event({ description: "Consulta | Consultório\nLevar exames", colorId: "10" }), SP);
    expect(form).toMatchObject({ type: "Consulta | Consultório", description: "Levar exames", status: "confirmed" });
    expect(formBody(form)).toMatchObject({ description: "Consulta | Consultório\nLevar exames" });
    expect(formBody({ ...form, type: "" })).toMatchObject({ description: "Levar exames" });
    expect(formBody({ ...form, type: "Retorno | Consultório", description: "" })).toMatchObject({ description: "Retorno | Consultório" });
    expect(withoutType("Levar exames")).toBe("Levar exames");
    expect(withType("", "")).toBe("");
    // A type in the second line comes first on the way back; opening and saving without a change sends nothing.
    const second = formOf(event({ description: "Levar exames\nRetorno | Consultório" }), SP);
    const body = formBody(second);
    if (typeof body === "string") throw new Error(body);
    expect(changedFields(second, body)).toEqual({});
    // Changing only the type sends only the description.
    const typed = formBody({ ...form, type: "Retorno | Consultório" });
    if (typeof typed === "string") throw new Error(typed);
    expect(changedFields(form, typed)).toEqual({ description: "Retorno | Consultório\nLevar exames" });
  });

  it("the status is the color: none is Agendado, and a color outside the four has none", () => {
    expect(formOf(event({}), SP).status).toBe("scheduled");
    expect(formOf(event({ colorId: "5" }), SP).status).toBe("rescheduled");
    expect(formOf(event({ colorId: "3" }), SP).status).toBeNull();
  });
});

describe("the Agenda under the owner's preferences (Sinal S08)", () => {
  const HOURS = { from: 8, to: 18 };
  const DAY = "2026-11-09";
  // São Paulo is UTC−3: 11:00Z is 08:00 there.
  const at = (start: string, end: string, over: Partial<AgendaEvent> = {}) => event({ id: `${start}-${end}`, start: `${DAY}T${start}:00-03:00`, end: `${DAY}T${end}:00-03:00`, ...over });

  it("starts the week on Monday, or on Sunday when asked, in the week and the month", () => {
    expect(viewRange("week", "2026-11-11")).toEqual({ from: "2026-11-09", to: "2026-11-15" });
    expect(viewRange("week", "2026-11-11", 0)).toEqual({ from: "2026-11-08", to: "2026-11-14" });
    // The edges: a Sunday belongs to the week that ends on it, or to the one that starts on it.
    expect(viewRange("week", "2026-11-15", 1)).toEqual({ from: "2026-11-09", to: "2026-11-15" });
    expect(viewRange("week", "2026-11-15", 0)).toEqual({ from: "2026-11-15", to: "2026-11-21" });
    expect(viewRange("month", "2026-11-11", 0)).toEqual({ from: "2026-11-01", to: "2026-12-05" });
    expect(viewRange("month", "2026-11-11", 1)).toEqual({ from: "2026-10-26", to: "2026-12-06" });
  });

  it("shows the working days, and the days off only when asked", () => {
    const week = daysOf("2026-11-09", "2026-11-15");
    expect(shownDays(week, { workDays: [1, 2, 3, 4, 5], daysOff: true })).toEqual(week);
    expect(shownDays(week, { workDays: [1, 2, 3, 4, 5], daysOff: false })).toEqual(week.slice(0, 5));
    expect(shownDays(week, { workDays: [0, 3], daysOff: false })).toEqual(["2026-11-11", "2026-11-15"]);
  });

  it("tells what is outside the working hours at the exact edges", () => {
    const out = (start: string, end: string) => outsideHours(at(start, end), DAY, HOURS, SP);
    expect(out("07:00", "08:00")).toBe(true); // ends as the hours start
    expect(out("07:00", "08:01")).toBe(false);
    expect(out("17:59", "19:00")).toBe(false);
    expect(out("18:00", "19:00")).toBe(true); // starts as they end
    expect(out("08:00", "08:00")).toBe(false); // no length, on the first minute
    expect(out("18:00", "18:00")).toBe(true); // no length, as the hours end: after them
    expect(out("17:59", "17:59")).toBe(false);
    expect(out("07:59", "07:59")).toBe(true);
    expect(outsideHours(event({ allDay: true, start: DAY, end: "2026-11-10" }), DAY, HOURS, SP)).toBe(false);
    // The whole day as working hours leaves nothing outside.
    expect(outsideHours(at("00:00", "00:30"), DAY, { from: 0, to: 24 }, SP)).toBe(false);
    expect(outsideHours(at("23:30", "23:59"), DAY, { from: 0, to: 24 }, SP)).toBe(false);
  });

  it("an event that crosses midnight counts in each day by the part that falls in it", () => {
    const night = event({ start: "2026-11-09T22:00:00-03:00", end: "2026-11-10T09:00:00-03:00" });
    expect(outsideHours(night, "2026-11-09", HOURS, SP)).toBe(true);
    expect(outsideHours(night, "2026-11-10", HOURS, SP)).toBe(false);
    const plan = planDay([night], "2026-11-10", HOURS, SP);
    expect(plan.blocks).toEqual([{ event: night, top: 0, height: 0.1, lane: 0, lanes: 1 }]);
    expect(planDay([night], "2026-11-09", HOURS, SP).after).toEqual([night]);
  });

  it("lists a day with what the preferences hide counted, never lost, all-day events always in", () => {
    const allDay = event({ id: "a", allDay: true, start: DAY, end: "2026-11-10" });
    const events = [allDay, at("07:00", "07:30"), at("09:00", "10:00"), at("19:00", "20:00")];
    const all = dayEvents(events, DAY, { ...HOURS, outside: true }, SP);
    expect(all.outside).toBe(0);
    expect(all.events).toHaveLength(4);
    const some = dayEvents(events, DAY, { ...HOURS, outside: false }, SP);
    expect(some.outside).toBe(2);
    expect(some.events.map((e) => e.id)).toEqual(["a", "09:00-10:00"]);
    // Every event is either listed or counted.
    expect(some.events.length + some.outside).toBe(events.length);
  });

  it("places each block by its hours and cuts it to the working hours", () => {
    const plan = planDay([at("07:00", "07:30"), at("07:30", "09:00"), at("13:00", "14:00"), at("17:00", "19:30"), at("19:00", "20:00"), event({ id: "a", allDay: true, start: DAY, end: "2026-11-10" })], DAY, HOURS, SP);
    expect(plan.allDay.map((e) => e.id)).toEqual(["a"]);
    expect(plan.before.map((e) => e.id)).toEqual(["07:00-07:30"]);
    expect(plan.after.map((e) => e.id)).toEqual(["19:00-20:00"]);
    expect(plan.blocks.map((b) => [b.event.id, b.top, b.height])).toEqual([
      ["07:30-09:00", 0, 0.1],
      ["13:00-14:00", 0.5, 0.1],
      ["17:00-19:30", 0.9, 0.1],
    ]);
  });

  it("puts overlapping events side by side and gives the lane back when it is free", () => {
    const plan = planDay([at("09:00", "11:00"), at("09:30", "10:30"), at("10:00", "12:00"), at("11:00", "12:00"), at("14:00", "15:00")], DAY, HOURS, SP);
    expect(plan.blocks.map((b) => [b.event.id, b.lane, b.lanes])).toEqual([
      ["09:00-11:00", 0, 3],
      ["09:30-10:30", 1, 3],
      ["10:00-12:00", 2, 3],
      ["11:00-12:00", 0, 3],
      ["14:00-15:00", 0, 1],
    ]);
    // Back to back is not an overlap.
    expect(planDay([at("09:00", "10:00"), at("10:00", "11:00")], DAY, HOURS, SP).blocks.map((b) => b.lanes)).toEqual([1, 1]);
  });

  it("keeps a short event tall enough to hit, inside the hours, and beside what it would cover", () => {
    const min = BLOCK_MIN / 600;
    const [short] = planDay([at("09:00", "09:05")], DAY, HOURS, SP).blocks;
    expect(short?.height).toBeCloseTo(min);
    // At the very end of the hours the block moves up instead of leaving the grid.
    const [last] = planDay([at("17:55", "18:00")], DAY, HOURS, SP).blocks;
    expect((last?.top ?? 0) + (last?.height ?? 0)).toBeCloseTo(1);
    // Two short ones a few minutes apart would be drawn one over the other: they go side by side.
    expect(planDay([at("09:00", "09:05"), at("09:10", "09:15")], DAY, HOURS, SP).blocks.map((b) => b.lanes)).toEqual([2, 2]);
    // Working hours of a single hour still fit the block.
    const [only] = planDay([at("09:00", "09:05")], DAY, { from: 9, to: 10 }, SP).blocks;
    expect(only).toMatchObject({ top: 0, height: BLOCK_MIN / 60 });
    // Working hours shorter than the shortest block cannot exist (whole hours), and the block never passes the grid.
    const [end] = planDay([at("09:58", "10:00")], DAY, { from: 9, to: 10 }, SP).blocks;
    expect((end?.top ?? 0) + (end?.height ?? 0)).toBeCloseTo(1);
  });

  it("finds the line of now inside the working hours of today only", () => {
    const now = (time: string) => Date.parse(`${DAY}T${time}:00-03:00`);
    expect(nowAt(now("08:00"), DAY, HOURS, SP)).toBe(0);
    expect(nowAt(now("13:00"), DAY, HOURS, SP)).toBe(0.5);
    expect(nowAt(now("07:59"), DAY, HOURS, SP)).toBeNull();
    expect(nowAt(now("18:00"), DAY, HOURS, SP)).toBeNull();
    expect(nowAt(now("13:00"), "2026-11-10", HOURS, SP)).toBeNull();
    // 23:59 here is already tomorrow in a zone ahead.
    expect(nowAt(now("23:59"), DAY, { from: 0, to: 24 }, "Europe/Lisbon")).toBeNull();
  });

  it("a day of daylight saving time keeps each block at its wall-clock hour", () => {
    // New York leaves daylight saving on 1 November 2026: 09:00 there is 14:00Z after the change.
    const morning = event({ start: "2026-11-01T14:00:00Z", end: "2026-11-01T15:00:00Z" });
    expect(planDay([morning], "2026-11-01", HOURS, NY).blocks[0]).toMatchObject({ top: 0.1, height: 0.1 });
    // The 25-hour day, across the hour that repeats: 00:30 EDT to 03:00 EST is drawn by the clock on the wall.
    const DAY_HOURS = { from: 0, to: 24 };
    const back = event({ start: "2026-11-01T04:30:00Z", end: "2026-11-01T08:00:00Z" });
    const [long] = planDay([back], "2026-11-01", DAY_HOURS, NY).blocks;
    expect(long?.top).toBeCloseTo(30 / 1440);
    expect((long?.top ?? 0) + (long?.height ?? 0)).toBeCloseTo(180 / 1440);
    expect(outsideHours(back, "2026-11-01", HOURS, NY)).toBe(true);
    // The 23-hour day, across the hour that does not exist: 01:30 EST to 03:30 EDT.
    const forward = event({ start: "2026-03-08T06:30:00Z", end: "2026-03-08T07:30:00Z" });
    const [short] = planDay([forward], "2026-03-08", DAY_HOURS, NY).blocks;
    expect(short?.top).toBeCloseTo(90 / 1440);
    expect((short?.top ?? 0) + (short?.height ?? 0)).toBeCloseTo(210 / 1440);
    // Either day still ends at its own midnight: nothing of the next day is counted in it.
    expect(dayEvents([back, forward], "2026-11-02", { ...HOURS, outside: true }, NY).events).toEqual([]);
  });
});

describe("the status of an event is its color at Google", () => {
  const open = { mode: "write", writable: true, color: "#4f7cff" } as const;

  it("reads the four colors as the four statuses in a calendar open for editing", () => {
    expect(eventLook({ colorId: "7" }, open)).toEqual({ editable: true, status: "scheduled", color: "#039be5" });
    expect(eventLook({ colorId: "10" }, open)).toEqual({ editable: true, status: "confirmed", color: "var(--color-basil)" });
    expect(eventLook({ colorId: "5" }, open)).toEqual({ editable: true, status: "rescheduled", color: "#f6bf26" });
    expect(eventLook({ colorId: "11" }, open)).toEqual({ editable: true, status: "cancelled", color: "#d50000" });
  });

  it("counts an event without a color as scheduled, in Peacock", () => {
    expect(eventLook({ colorId: "" }, open)).toEqual({ editable: true, status: "scheduled", color: EVENT_COLORS["7"] });
    expect(eventLook({} as { colorId: string }, open).status).toBe("scheduled");
  });

  it("shows any other color as it is, without a status", () => {
    for (const colorId of ["1", "2", "3", "4", "6", "8", "9"]) expect(eventLook({ colorId }, open)).toEqual({ editable: true, status: null, color: EVENT_COLORS[colorId] });
    expect(Object.keys(EVENT_COLORS)).toHaveLength(11);
  });

  it("keeps the calendar's color and gives no status where the event cannot change", () => {
    const cases = [{ mode: "read", writable: true, color: "#f59e0b" }, { mode: "write", writable: false, color: "#f59e0b" }] as const;
    for (const calendar of cases) expect(eventLook({ colorId: "11" }, calendar)).toEqual({ editable: false, status: null, color: "#f59e0b" });
    expect(eventLook({ colorId: "11" }, undefined)).toEqual({ editable: false, status: null, color: undefined });
  });
});

describe("the weekend", () => {
  it("is Saturday and Sunday, and no other day", () => {
    // 9/11/2026 is a Monday.
    expect(["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"].map(isWeekend)).toEqual([false, false, false, false, false, true, true]);
  });
});
