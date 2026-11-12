import { describe, expect, it } from "vitest";
import { EVENT_STATUS_COLOR, EVENT_STATUSES, eventStatus, NATIONAL_HOLIDAYS, nationalHoliday } from "../src/index.ts";

describe("nationalHoliday", () => {
  // Good Friday of each year, from the published calendars.
  it.each([
    "2024-03-29",
    "2025-04-18",
    "2026-04-03",
    "2027-03-26",
    "2028-04-14",
    "2029-03-30",
    "2030-04-19",
    "2031-04-11",
    "2032-03-26",
    "2033-04-15",
    "2034-04-07",
    "2035-03-23",
  ])("%s is Good Friday, and the days beside it are not holidays", (day) => {
    expect(nationalHoliday(day)).toBe("goodFriday");
    const at = Date.parse(`${day}T12:00:00Z`);
    for (const offset of [-1, 1]) expect(nationalHoliday(new Date(at + offset * 86_400_000).toISOString().slice(0, 10))).toBeNull();
  });

  it.each([
    ["01-01", "newYear"],
    ["04-21", "tiradentes"],
    ["05-01", "labourDay"],
    ["09-07", "independence"],
    ["10-12", "aparecida"],
    ["11-02", "allSouls"],
    ["11-15", "republic"],
    ["11-20", "blackAwareness"],
    ["12-25", "christmas"],
  ])("%s is %s in every year from 2024 to 2035", (monthDay, holiday) => {
    for (let year = 2024; year <= 2035; year++) expect(nationalHoliday(`${year}-${monthDay}`)).toBe(holiday);
  });

  it("has ten holidays in each year, all of them known", () => {
    for (let year = 2024; year <= 2035; year++) {
      const found: string[] = [];
      for (let at = Date.UTC(year, 0, 1, 12); new Date(at).getUTCFullYear() === year; at += 86_400_000) {
        const holiday = nationalHoliday(new Date(at).toISOString().slice(0, 10));
        if (holiday) found.push(holiday);
      }
      expect(found.sort()).toEqual([...NATIONAL_HOLIDAYS].sort());
    }
  });

  it("leaves out the days beside a fixed holiday, Carnival and Corpus Christi", () => {
    for (const day of ["2026-12-24", "2026-12-26", "2026-12-31", "2027-01-02", "2026-02-16", "2026-02-17", "2026-06-04", "2026-11-12"]) expect(nationalHoliday(day)).toBeNull();
  });

  it("counts 20/11 only since it became a national holiday, in 2024", () => {
    expect(nationalHoliday("2023-11-20")).toBeNull();
    expect(nationalHoliday("2024-11-20")).toBe("blackAwareness");
  });

  it("keeps one name when Good Friday falls on 21/4 and follows Easter at its limits", () => {
    expect(nationalHoliday("2000-04-21")).toBe("goodFriday");
    // The earliest and the latest Easter of these centuries: 22/3/2285 and 25/4/2038.
    expect(nationalHoliday("2285-03-20")).toBe("goodFriday");
    expect(nationalHoliday("2038-04-23")).toBe("goodFriday");
  });

  it("answers null for what is not a real date", () => {
    for (const value of ["", "2026-02-30", "2026-13-01", "2026-1-1", "20260101", "2026-12-25T10:00", "abc"]) expect(nationalHoliday(value)).toBeNull();
  });
});

describe("eventStatus", () => {
  it("reads the four colors as the four statuses, and back", () => {
    expect(EVENT_STATUS_COLOR).toEqual({ scheduled: "7", confirmed: "10", rescheduled: "5", cancelled: "11" });
    for (const status of EVENT_STATUSES) expect(eventStatus(EVENT_STATUS_COLOR[status])).toBe(status);
  });

  it("counts an event without a color as scheduled", () => {
    expect(eventStatus("")).toBe("scheduled");
  });

  it("gives no status to any other color", () => {
    for (const color of ["1", "2", "3", "4", "6", "8", "9", "12", "0", "07", " 7", "x"]) expect(eventStatus(color)).toBeNull();
  });
});
