import { describe, expect, it } from "vitest";
import { clock, messageDay, rowWhen, shortDate } from "../src/pages/chat/when.ts";

const SP = "America/Sao_Paulo";
/** An instant written as São Paulo's wall clock (UTC−3, no daylight saving since 2019). */
const sp = (local: string) => new Date(`${local}-03:00`);
const iso = (local: string) => sp(local).toISOString();
// A Monday.
const now = sp("2026-11-09T10:00:00");

describe("clock", () => {
  it("writes the hour in the owner's zone, whatever the device's", () => {
    expect(clock("2026-11-09T11:12:00Z", "pt-BR", SP)).toBe("08:12");
    expect(clock("2026-11-09T11:12:00Z", "pt-BR", "Asia/Tokyo")).toBe("20:12");
  });

  it("is empty for a message that has no time yet", () => {
    expect(clock("", "pt-BR", SP)).toBe("");
    expect(clock("not a date", "pt-BR", SP)).toBe("");
  });
});

describe("rowWhen", () => {
  it("shows only the hour for today and yesterday: the group above already names the day", () => {
    expect(rowWhen(iso("2026-11-09T08:12:00"), now, "pt-BR", SP)).toBe("08:12");
    expect(rowWhen(iso("2026-11-08T21:40:00"), now, "pt-BR", SP)).toBe("21:40");
  });

  it("adds the weekday from two to six days ago", () => {
    expect(rowWhen(iso("2026-11-07T10:31:00"), now, "pt-BR", SP)).toBe("Sáb, 10:31");
    expect(rowWhen(iso("2026-11-03T00:00:00"), now, "pt-BR", SP)).toBe("Ter, 00:00");
    expect(rowWhen(iso("2026-11-07T10:31:00"), now, "en", SP)).toBe("Sat, 10:31 AM");
  });

  it("shows the date from the seventh day on, with the year when it is another one", () => {
    expect(rowWhen(iso("2026-11-02T23:59:00"), now, "pt-BR", SP)).toBe("02/11");
    expect(rowWhen(iso("2025-12-31T12:00:00"), now, "pt-BR", SP)).toBe("31/12/2025");
  });

  it("goes by the owner's day at midnight, not by 24 hours", () => {
    // 23:59 of the day before is yesterday even two minutes later.
    const justAfter = sp("2026-11-09T00:01:00");
    expect(rowWhen(iso("2026-11-08T23:59:00"), justAfter, "pt-BR", SP)).toBe("23:59");
    expect(rowWhen(iso("2026-11-06T23:59:00"), justAfter, "pt-BR", SP)).toBe("Sex, 23:59");
  });

  it("treats a clock a little ahead on the server as today", () => {
    expect(rowWhen(iso("2026-11-10T00:00:30"), sp("2026-11-09T23:59:50"), "pt-BR", SP)).toBe("00:00");
  });
});

describe("a date that is not one", () => {
  it("shows nothing instead of failing the whole screen", () => {
    expect(rowWhen("", now, "pt-BR", SP)).toBe("");
    expect(rowWhen("nope", now, "pt-BR", SP)).toBe("");
    expect(shortDate("nope", now, "pt-BR", SP)).toBe("");
  });
});

describe("days of 23 and 25 hours (New York)", () => {
  const NY = "America/New_York";
  it("counts calendar days across the change of the clocks, both ways", () => {
    // 1 Nov 2026 has 25 hours there: 00:10 of that day, seen at 23:50 of the same day, is still today.
    expect(messageDay("2026-11-01T04:10:00Z", new Date("2026-11-02T04:50:00Z"), "en", NY).offset).toBe(0);
    expect(messageDay("2026-11-01T03:50:00Z", new Date("2026-11-02T04:50:00Z"), "en", NY).offset).toBe(-1);
    // 8 Mar 2026 has 23 hours: 23:50 of the 7th, seen at 23:50 of the 8th, is yesterday.
    expect(messageDay("2026-03-08T04:50:00Z", new Date("2026-03-09T03:50:00Z"), "en", NY).offset).toBe(-1);
    expect(rowWhen("2026-03-08T05:10:00Z", new Date("2026-03-09T03:50:00Z"), "en", NY)).toBe("12:10 AM");
  });
});

describe("messageDay", () => {
  it("names today and yesterday, and writes the other days in full", () => {
    expect(messageDay(iso("2026-11-09T08:12:00"), now, "pt-BR", SP)).toEqual({ offset: 0, date: "segunda-feira, 9 de novembro" });
    expect(messageDay(iso("2026-11-08T12:05:00"), now, "pt-BR", SP)).toEqual({ offset: -1, date: "domingo, 8 de novembro" });
    expect(messageDay(iso("2026-11-02T12:05:00"), now, "pt-BR", SP).date).toBe("segunda-feira, 2 de novembro");
    expect(messageDay(iso("2025-11-02T12:05:00"), now, "pt-BR", SP).date).toBe("domingo, 2 de novembro de 2025");
  });

  it("puts a message still being written on today", () => {
    expect(messageDay("", now, "pt-BR", SP).offset).toBe(0);
  });
});
