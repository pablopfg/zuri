import type { AgendaEvent } from "@zuri/shared";
import { describe, expect, it } from "vitest";
import { applyChanges, type Hours, type Slot, canUndo, clashes, moveSlot, reschedules, resizeSlot, reverseChanges, STEP_MIN, slotChanges, slotOf, slotTimes, snap, UNDO_MS } from "../src/lib/agenda-edit.ts";

// Changing an event on the Agenda itself (docs/planos/sons-menu-e-agenda-editavel.md, delivery 3):
// CA7 (steps of 15 minutes, the limits of the day and of the shortest event), CA13 (the change that
// undoes another) and "mover marca Reagendado".

const SP = "America/Sao_Paulo";
const NY = "America/New_York";
const HOURS = { from: 8, to: 18 };

// 10:00 to 11:00 in São Paulo, Tuesday 03/11/2026.
const event = (over: Partial<AgendaEvent> = {}): AgendaEvent => ({
  id: "e",
  calendarId: "c",
  title: "Helena Duarte Prado",
  start: "2026-11-03T13:00:00.000Z",
  end: "2026-11-03T14:00:00.000Z",
  allDay: false,
  location: "",
  description: "Consulta | Consultório",
  etag: '"1"',
  recurring: false,
  guests: 0,
  colorId: "",
  ...over,
});
const slot = (start: number, end: number, day = "2026-11-03") => ({ day, start, end });
/** The slot dragged until its start is at `start`. */
const moveTo = (from: Slot, day: string, start: number, hours: Hours) => moveSlot(from, day, start - from.start, hours);

describe("the slot of an event", () => {
  it("is its day and its minutes in the owner's zone, whatever the device's", () => {
    expect(slotOf(event(), SP)).toEqual(slot(600, 660));
    expect(slotOf(event(), NY)).toEqual(slot(480, 540));
  });

  it("ends at 24:00 of its own day when the event ends at midnight", () => {
    expect(slotOf(event({ start: "2026-11-04T02:00:00.000Z", end: "2026-11-04T03:00:00.000Z" }), SP)).toEqual(slot(23 * 60, 24 * 60));
  });

  it("is null for what does not drag: all day, more than one day, no length", () => {
    expect(slotOf(event({ allDay: true, start: "2026-11-03", end: "2026-11-04" }), SP)).toBeNull();
    expect(slotOf(event({ end: "2026-11-04T14:00:00.000Z" }), SP)).toBeNull();
    expect(slotOf(event({ end: "2026-11-04T03:01:00.000Z" }), SP)).toBeNull();
    expect(slotOf(event({ end: "2026-11-03T13:00:00.000Z" }), SP)).toBeNull();
  });
});

describe("moving in steps of a quarter of an hour (CA7)", () => {
  it("rounds to the nearest step", () => {
    expect(STEP_MIN).toBe(15);
    expect(snap(607)).toBe(600);
    expect(snap(607.5)).toBe(615);
    expect(snap(608)).toBe(615);
    expect(snap(-7)).toBe(-0);
  });

  it("keeps the length and changes the day", () => {
    expect(moveTo(slot(600, 660), "2026-11-05", 14 * 60 + 20, HOURS)).toEqual(slot(14 * 60 + 15, 15 * 60 + 15, "2026-11-05"));
  });

  it("QA-E3-03: a move of the day alone keeps the hour as it was, off the quarter or past the hours on screen", () => {
    // 17:30 to 19:00 with the screen ending at 18:00, 7:30 to 8:30 with it starting at 8:00, and 10:05 to 10:55.
    expect(moveSlot(slot(17 * 60 + 30, 19 * 60), "2026-11-04", 0, HOURS)).toEqual(slot(17 * 60 + 30, 19 * 60, "2026-11-04"));
    expect(moveSlot(slot(7 * 60 + 30, 8 * 60 + 30), "2026-11-04", 0, HOURS)).toEqual(slot(7 * 60 + 30, 8 * 60 + 30, "2026-11-04"));
    expect(moveSlot(slot(605, 655), "2026-11-04", 0, HOURS)).toEqual(slot(605, 655, "2026-11-04"));
    // A slip of the hand under half a step is still no change of hour: n−1, n.
    expect(moveSlot(slot(605, 655), "2026-11-04", 7, HOURS)).toEqual(slot(605, 655, "2026-11-04"));
    expect(moveSlot(slot(605, 655), "2026-11-04", -7, HOURS)).toEqual(slot(605, 655, "2026-11-04"));
    // From half a step on the hour changes, and lands on the quarter.
    expect(moveSlot(slot(605, 655), "2026-11-04", 8, HOURS)).toEqual(slot(615, 665, "2026-11-04"));
  });

  it("stops at the first hour on screen: n−1, n, n+1", () => {
    expect(moveTo(slot(600, 660), "2026-11-03", 8 * 60 - 15, HOURS).start).toBe(8 * 60);
    expect(moveTo(slot(600, 660), "2026-11-03", 8 * 60, HOURS).start).toBe(8 * 60);
    expect(moveTo(slot(600, 660), "2026-11-03", 8 * 60 + 15, HOURS).start).toBe(8 * 60 + 15);
    expect(moveTo(slot(600, 660), "2026-11-03", -500, HOURS).start).toBe(8 * 60);
  });

  it("stops where the event still ends with the last hour on screen: n−1, n, n+1", () => {
    expect(moveTo(slot(600, 660), "2026-11-03", 17 * 60 - 15, HOURS)).toEqual(slot(17 * 60 - 15, 18 * 60 - 15));
    expect(moveTo(slot(600, 660), "2026-11-03", 17 * 60, HOURS)).toEqual(slot(17 * 60, 18 * 60));
    expect(moveTo(slot(600, 660), "2026-11-03", 17 * 60 + 15, HOURS)).toEqual(slot(17 * 60, 18 * 60));
    expect(moveTo(slot(600, 660), "2026-11-03", 99_999, HOURS)).toEqual(slot(17 * 60, 18 * 60));
  });

  it("never leaves the day, with the hours on screen up to midnight", () => {
    expect(moveTo(slot(600, 660), "2026-11-03", 23 * 60 + 30, { from: 0, to: 24 })).toEqual(slot(23 * 60, 24 * 60));
  });

  it("an event longer than the hours on screen starts with them, or earlier when it would pass midnight", () => {
    expect(moveTo(slot(8 * 60, 20 * 60), "2026-11-03", 12 * 60, HOURS)).toEqual(slot(8 * 60, 20 * 60));
    expect(moveTo(slot(0, 20 * 60), "2026-11-03", 12 * 60, HOURS)).toEqual(slot(4 * 60, 24 * 60));
  });
});

describe("changing the length by the end (CA7)", () => {
  it("rounds the end to the step", () => {
    expect(resizeSlot(slot(600, 660), 11 * 60 + 40, HOURS)).toEqual(slot(600, 11 * 60 + 45));
  });

  it("is never shorter than one step: n−1, n, n+1", () => {
    expect(resizeSlot(slot(600, 660), 600, HOURS).end).toBe(615);
    expect(resizeSlot(slot(600, 660), 615, HOURS).end).toBe(615);
    expect(resizeSlot(slot(600, 660), 630, HOURS).end).toBe(630);
    expect(resizeSlot(slot(600, 660), 0, HOURS).end).toBe(615);
  });

  it("stops at the last hour on screen, and never cuts an event that already went past it", () => {
    expect(resizeSlot(slot(600, 660), 18 * 60 - 15, HOURS).end).toBe(18 * 60 - 15);
    expect(resizeSlot(slot(600, 660), 18 * 60, HOURS).end).toBe(18 * 60);
    expect(resizeSlot(slot(600, 660), 18 * 60 + 15, HOURS).end).toBe(18 * 60);
    expect(resizeSlot(slot(600, 19 * 60), 19 * 60 + 30, HOURS).end).toBe(19 * 60);
    expect(resizeSlot(slot(600, 660), 99_999, { from: 0, to: 24 }).end).toBe(24 * 60);
  });
});

describe("what a move sends to Google", () => {
  it("writes the slot as local times, 24:00 as the next day's 0:00", () => {
    expect(slotTimes(slot(9 * 60 + 5, 24 * 60))).toEqual({ start: "2026-11-03T09:05", end: "2026-11-04T00:00" });
    expect(slotTimes(slot(0, 15, "2026-12-31"))).toEqual({ start: "2026-12-31T00:00", end: "2026-12-31T00:15" });
  });

  it("nothing when the event lands where it was, or does not drag", () => {
    expect(slotChanges(event(), slot(600, 660), "scheduled", SP)).toBeNull();
    expect(slotChanges(event({ allDay: true, start: "2026-11-03", end: "2026-11-04" }), slot(600, 660), "scheduled", SP)).toBeNull();
  });

  it("a new day or hour marks an appointment that was Agendado or Confirmado as Reagendado", () => {
    expect(slotChanges(event(), slot(660, 720), "scheduled", SP)).toEqual({
      changes: { start: "2026-11-03T11:00", end: "2026-11-03T12:00", colorId: "5" },
      moved: true,
      rescheduled: true,
    });
    expect(slotChanges(event({ colorId: "10" }), slot(600, 660, "2026-11-04"), "confirmed", SP)).toMatchObject({ moved: true, rescheduled: true, changes: { colorId: "5" } });
  });

  it("a new length alone never changes the status", () => {
    expect(slotChanges(event(), slot(600, 690), "scheduled", SP)).toEqual({ changes: { start: "2026-11-03T10:00", end: "2026-11-03T11:30" }, moved: false, rescheduled: false });
  });

  it("leaves the status of what is already Reagendado or Cancelado, of a color outside the four and of a read-only calendar", () => {
    for (const status of ["rescheduled", "cancelled", null] as const) {
      expect(slotChanges(event(), slot(660, 720), status, SP)).toEqual({ changes: { start: "2026-11-03T11:00", end: "2026-11-03T12:00" }, moved: true, rescheduled: false });
    }
  });

  it("only an appointment is rescheduled: an event without a type keeps its status", () => {
    expect(reschedules({ description: "" }, "scheduled")).toBe(false);
    expect(reschedules({ description: "Levar o projetor" }, "confirmed")).toBe(false);
    expect(reschedules({ description: "Retorno | Consultório" }, "confirmed")).toBe(true);
    expect(slotChanges(event({ description: "" }), slot(660, 720), "scheduled", SP)?.rescheduled).toBe(false);
  });
});

describe("the event on screen while Google answers", () => {
  it("moves to the owner's hours, not the device's", () => {
    const moved = applyChanges(event(), { start: "2026-11-04T15:30", end: "2026-11-04T16:30", colorId: "5" }, SP);
    expect(moved).toMatchObject({ start: "2026-11-04T18:30:00.000Z", end: "2026-11-04T19:30:00.000Z", colorId: "5", allDay: false, etag: '"1"' });
    expect(applyChanges(event(), { start: "2026-11-04T15:30", end: "2026-11-04T16:30" }, NY).start).toBe("2026-11-04T20:30:00.000Z");
  });

  it("changes the text and the color and leaves the rest", () => {
    const before = event();
    expect(applyChanges(before, { title: "Outro", location: "Sala 2", description: "", colorId: "" }, SP)).toEqual({ ...before, title: "Outro", location: "Sala 2", description: "", colorId: "" });
    expect(applyChanges(before, {}, SP)).toEqual(before);
    // The original is never touched.
    expect(before.title).toBe("Helena Duarte Prado");
  });

  it("an all-day change keeps the end exclusive, as Google does", () => {
    expect(applyChanges(event(), { allDay: true, start: "2026-11-03", end: "2026-11-04" }, SP)).toMatchObject({ allDay: true, start: "2026-11-03", end: "2026-11-05" });
    const whole = event({ allDay: true, start: "2026-11-03", end: "2026-11-04" });
    expect(applyChanges(whole, { allDay: false, start: "2026-11-03T09:00", end: "2026-11-03T10:00" }, SP)).toMatchObject({ allDay: false, start: "2026-11-03T12:00:00.000Z" });
  });

  it("keeps the hours it had when the new ones are not real", () => {
    expect(applyChanges(event(), { start: "2026-02-30T10:00", end: "2026-02-30T11:00" }, SP)).toMatchObject({ start: "2026-11-03T13:00:00.000Z" });
    expect(applyChanges(event(), { start: "amanhã", end: "depois" }, SP)).toMatchObject({ start: "2026-11-03T13:00:00.000Z" });
  });
});

describe("QA-E3-06: a day of 23 hours and one of 25 (a zone with daylight saving time)", () => {
  // New York: 08/03/2026 has no 2:00 to 3:00, and 01/11/2026 has 1:00 to 2:00 twice.
  it("a move to an ordinary hour of those days is that hour on the owner's clock", () => {
    const short = applyChanges(event(), { start: "2026-03-08T10:00", end: "2026-03-08T11:00" }, NY);
    expect([short.start, short.end]).toEqual(["2026-03-08T14:00:00.000Z", "2026-03-08T15:00:00.000Z"]);
    expect(slotOf(short, NY)).toEqual(slot(600, 660, "2026-03-08"));
    const long = applyChanges(event(), { start: "2026-11-01T10:00", end: "2026-11-01T11:00" }, NY);
    expect([long.start, long.end]).toEqual(["2026-11-01T15:00:00.000Z", "2026-11-01T16:00:00.000Z"]);
    expect(slotOf(long, NY)).toEqual(slot(600, 660, "2026-11-01"));
  });

  it("undoing a move across the change of hour puts the event back at its hour on the clock", () => {
    const before = event({ start: "2026-03-07T15:00:00.000Z", end: "2026-03-07T16:00:00.000Z" });
    const changes = { start: "2026-03-08T10:00", end: "2026-03-08T11:00" };
    const back = reverseChanges(before, changes, NY);
    expect(back).toEqual({ allDay: false, start: "2026-03-07T10:00", end: "2026-03-07T11:00" });
    expect(applyChanges(applyChanges(before, changes, NY), back, NY)).toEqual(before);
  });

  it("an hour that the clock skips is drawn an hour later, as the server places it", () => {
    // 2:30 does not exist on 08/03: it is 3:30, the same instant the server's localInstant gives.
    expect(applyChanges(event(), { start: "2026-03-08T02:30", end: "2026-03-08T04:00" }, NY).start).toBe("2026-03-08T07:30:00.000Z");
  });
});

describe("the change that undoes another (CA13)", () => {
  it("puts back the day, the hours and the status a move changed", () => {
    const before = event({ colorId: "10" });
    const changes = { start: "2026-11-04T15:30", end: "2026-11-04T16:30", colorId: "5" };
    const back = reverseChanges(before, changes, SP);
    expect(back).toEqual({ allDay: false, start: "2026-11-03T10:00", end: "2026-11-03T11:00", colorId: "10" });
    // Applied over the changed event, it is the first one again.
    expect(applyChanges(applyChanges(before, changes, SP), back, SP)).toEqual(before);
  });

  it("takes the color off again when the event had none", () => {
    expect(reverseChanges(event(), { colorId: "5" }, SP)).toEqual({ colorId: "" });
  });

  it("puts back only the fields that were sent", () => {
    expect(reverseChanges(event({ location: "Sala 1" }), { title: "Outro" }, SP)).toEqual({ title: "Helena Duarte Prado" });
    expect(reverseChanges(event(), {}, SP)).toEqual({});
  });

  it("an event that was all day goes back to all day, the end inclusive", () => {
    const whole = event({ allDay: true, start: "2026-11-03", end: "2026-11-05" });
    const changes = { allDay: false, start: "2026-11-03T09:00", end: "2026-11-03T10:00" };
    const back = reverseChanges(whole, changes, SP);
    expect(back).toEqual({ allDay: true, start: "2026-11-03", end: "2026-11-04" });
    expect(applyChanges(applyChanges(whole, changes, SP), back, SP)).toEqual(whole);
  });

  it("is not offered when a status went over a color outside the four, which Zuri never writes back", () => {
    expect(canUndo(event({ colorId: "3" }), { colorId: "10" })).toBe(false);
    expect(canUndo(event({ colorId: "3" }), { title: "Outro" })).toBe(true);
    expect(canUndo(event({ colorId: "" }), { colorId: "10" })).toBe(true);
    expect(canUndo(event({ colorId: "11" }), { colorId: "5", start: "2026-11-04T15:30", end: "2026-11-04T16:30" })).toBe(true);
  });

  it("is on offer for eight seconds", () => {
    expect(UNDO_MS).toBe(8_000);
  });
});

describe("another event at the same hour", () => {
  const other = (over: Partial<AgendaEvent>) => event({ id: "o", ...over });

  it("clashes when the two share any minute, not when one ends as the other starts", () => {
    expect(clashes(event(), [other({ start: "2026-11-03T13:59:00.000Z", end: "2026-11-03T15:00:00.000Z" })])).toBe(true);
    expect(clashes(event(), [other({ start: "2026-11-03T14:00:00.000Z", end: "2026-11-03T15:00:00.000Z" })])).toBe(false);
    expect(clashes(event(), [other({ start: "2026-11-03T12:00:00.000Z", end: "2026-11-03T13:00:00.000Z" })])).toBe(false);
    expect(clashes(event(), [other({ start: "2026-11-03T12:00:00.000Z", end: "2026-11-03T13:01:00.000Z" })])).toBe(true);
  });

  it("never with itself, a cancelled event or an all-day one", () => {
    expect(clashes(event(), [event()])).toBe(false);
    expect(clashes(event(), [other({ colorId: "11" })])).toBe(false);
    expect(clashes(event({ colorId: "11" }), [other({})])).toBe(false);
    expect(clashes(event(), [other({ allDay: true, start: "2026-11-03", end: "2026-11-04" })])).toBe(false);
    expect(clashes(event(), [])).toBe(false);
  });

  it("an event of the same id in another calendar is another event", () => {
    expect(clashes(event(), [event({ calendarId: "outra" })])).toBe(true);
  });
});
