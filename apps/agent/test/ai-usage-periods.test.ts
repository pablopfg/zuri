import { chatNeurons, PAID_MODEL_IDS, paidUsd, TRANSCRIPTION_MODEL, USAGE_MONTHS, usageHoursSchema, usageMonthsSchema } from "@zuri/shared";
import { describe, expect, it } from "vitest";
import type { StepUsage } from "../src/ai/provider.ts";
import { type AiLimits, audioNeurons, UsageMeter } from "../src/ai/usage.ts";
import type { Database } from "../src/db/database.ts";
import { NOON, withAiWorld } from "./ai-fakes.ts";

const GLM = "@cf/zai-org/glm-4.7-flash";
const LIMITS: AiLimits = { requestsPerDay: 50, neuronsPerDay: 9_000, maxOutputTokens: 1_024 };
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const chat = (model: string = GLM) => ({ model, billable: true, inputTokens: 1_000, maxOutputTokens: 100 });
const used = (input: number, output: number, model: string = GLM): StepUsage => ({
  model,
  billable: true,
  input: { reported: input, estimated: 0 },
  output: { reported: output, estimated: 0 },
});

/** One settled chat call of 1,000 tokens in and 100 out. */
function call(meter: UsageMeter): void {
  meter.settle(meter.reserveChat(chat(), LIMITS), used(1_000, 100));
}

const ONE = chatNeurons(GLM, 1_000, 100);

function seedDay(db: Database, day: string, n = 1): void {
  db.run(
    `INSERT INTO zur_usage_daily (day, ai_requests, ai_errors, ai_aborted, ai_fallbacks, audio_seconds, neurons, paid_usd) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    day,
    10 * n,
    n,
    2 * n,
    3 * n,
    60 * n,
    100 * n,
    0.5 * n,
  );
}

const monthly = (db: Database) => db.all<{ month: string; last_day: string; days: number; requests: number }>(`SELECT month, last_day, days, requests FROM zur_usage_monthly ORDER BY month`);

describe("today by the hour", () => {
  it("is empty before any call, and matches the schema", async () => {
    await withAiWorld(({ meter }) => {
      const hours = meter.hours();
      expect(usageHoursSchema.parse(hours)).toEqual({ day: "2026-10-31", hours: [] });
    });
  });

  it("puts each settled call in the UTC hour it was counted in, with what it really used", async () => {
    await withAiWorld(({ meter, clock }) => {
      call(meter);
      call(meter);
      clock.now = NOON + 59 * 60_000 + 59_999; // 12:59:59.999 is still 12
      call(meter);
      clock.now = NOON + HOUR; // 13:00:00.000 is 13
      call(meter);
      const { day, hours } = usageHoursSchema.parse(meter.hours());
      expect(day).toBe("2026-10-31");
      expect(hours.map((h) => [h.hour, h.requests])).toEqual([
        [12, 3],
        [13, 1],
      ]);
      expect(hours[0]?.neurons).toBeCloseTo(3 * ONE, 6);
      expect(hours[1]?.neurons).toBeCloseTo(ONE, 6);
    });
  });

  it("keeps a call in the hour it started, also when it ended in the next one", async () => {
    await withAiWorld(({ meter, clock }) => {
      clock.now = NOON + 59 * 60_000;
      const reservation = meter.reserveChat(chat(), LIMITS);
      clock.now = NOON + 61 * 60_000;
      meter.settle(reservation, used(1_000, 100));
      expect(meter.hours().hours.map((h) => [h.hour, h.requests])).toEqual([[12, 1]]);
    });
  });

  it("counts nothing for a reservation given back, and counts a settled call once", async () => {
    await withAiWorld(({ meter }) => {
      meter.release(meter.reserveChat(chat(), LIMITS));
      expect(meter.hours().hours).toEqual([]);
      const reservation = meter.reserveChat(chat(), LIMITS);
      meter.settle(reservation, used(1_000, 100));
      meter.settle(reservation, used(9_000, 900));
      meter.release(reservation);
      expect(meter.hours().hours.map((h) => h.requests)).toEqual([1]);
    });
  });

  it("counts audio seconds, embeddings, failures, stops, fallbacks and paid US$ in their columns", async () => {
    await withAiWorld(({ meter }) => {
      meter.settleAudio(meter.reserveAudio({ model: TRANSCRIPTION_MODEL, seconds: 90 }, LIMITS), 61);
      meter.settleEmbedding(meter.reserveEmbedding({ model: "@cf/baai/bge-m3", billable: true, tokens: 2_000 }, LIMITS), 1_000);
      meter.failed(meter.today(), false);
      meter.failed(meter.today(), true);
      meter.failed(meter.today(), true);
      meter.settle(meter.reserveChat({ ...chat(), fallback: true }, LIMITS), used(1_000, 100));
      const paid = PAID_MODEL_IDS[0];
      meter.settle(meter.reserveChat(chat(paid), LIMITS), used(1_000, 100, paid));
      const [hour] = meter.hours().hours;
      expect(hour).toMatchObject({ hour: 12, requests: 2, errors: 1, aborted: 2, fallbacks: 1, audioSeconds: 61 });
      expect(hour?.neurons).toBeCloseTo(audioNeurons(61) + 1.075 + ONE, 6);
      expect(hour?.paidUsd).toBeCloseTo(paidUsd(paid, 1_000, 100), 9);
    });
  });

  it("adds up to the day's own row once every call is settled", async () => {
    await withAiWorld(({ db, meter, clock }) => {
      for (let h = 0; h < 24; h++) {
        clock.now = Date.parse("2026-10-31T00:00:00Z") + h * HOUR + 7;
        call(meter);
        if (h % 5 === 0) meter.failed(meter.today(), h % 2 === 0);
      }
      const { hours } = meter.hours();
      expect(hours.map((h) => h.hour)).toEqual(Array.from({ length: 24 }, (_, i) => i));
      const sum = (key: "requests" | "errors" | "aborted" | "neurons") => hours.reduce((total, h) => total + h[key], 0);
      const row = db.one<{ ai_requests: number; ai_errors: number; ai_aborted: number; neurons: number }>(`SELECT * FROM zur_usage_daily WHERE day = '2026-10-31'`);
      expect(sum("requests")).toBe(row?.ai_requests);
      expect(sum("errors")).toBe(row?.ai_errors);
      expect(sum("aborted")).toBe(row?.ai_aborted);
      expect(sum("neurons")).toBeCloseTo(row?.neurons ?? -1, 6);
    });
  });

  it("starts over at 00:00 UTC without clearing anything: the 24 rows are reused", async () => {
    await withAiWorld(({ db, meter, clock }) => {
      call(meter); // 12:00 on the 31st
      clock.now = Date.parse("2026-10-31T23:59:59.999Z");
      call(meter);
      expect(meter.hours().hours.map((h) => h.hour)).toEqual([12, 23]);
      clock.now = Date.parse("2026-11-01T00:00:00Z");
      // Yesterday's hours are not today's, before any write of the new day.
      expect(meter.hours()).toEqual({ day: "2026-11-01", hours: [] });
      clock.now = Date.parse("2026-11-01T12:10:00Z");
      call(meter);
      // The row of hour 12 now holds only today's call, not yesterday's on top.
      expect(meter.hours().hours.map((h) => [h.hour, h.requests])).toEqual([[12, 1]]);
      expect(db.one<{ n: number }>(`SELECT count(*) AS n FROM zur_usage_hourly`)?.n).toBe(2);
      for (let d = 2; d < 40; d++) {
        clock.now = Date.parse("2026-11-01T00:30:00Z") + d * DAY + (d % 24) * HOUR;
        call(meter);
      }
      expect(db.one<{ n: number }>(`SELECT count(*) AS n FROM zur_usage_hourly`)?.n).toBeLessThanOrEqual(24);
    });
  });

  it("leaves a call that ended after midnight out of the new day's hours (it stays on the day it was counted)", async () => {
    await withAiWorld(({ db, meter, clock }) => {
      clock.now = Date.parse("2026-10-31T23:59:00Z");
      const reservation = meter.reserveChat(chat(), LIMITS);
      clock.now = Date.parse("2026-11-01T00:01:00Z");
      call(meter); // hour 0 of the 1st
      meter.settle(reservation, used(1_000, 100));
      meter.failed("2026-10-31", false);
      expect(meter.hours().hours.map((h) => [h.hour, h.requests, h.errors])).toEqual([[0, 1, 0]]);
      expect(db.one<{ n: number }>(`SELECT ai_requests AS n FROM zur_usage_daily WHERE day = '2026-10-31'`)?.n).toBe(1);
    });
  });

  it("costs one more written row a call and reads the 24 rows at most", async () => {
    await withAiWorld(({ db, meter, clock }) => {
      call(meter);
      clock.now += 1_000;
      db.usage.rowsWritten = 0;
      call(meter);
      // Reserve, the day's adjustment, the model's line and the hour.
      expect(db.usage.rowsWritten).toBe(4);
      for (let h = 0; h < 24; h++) db.run(`INSERT INTO zur_usage_hourly (hour, day) VALUES (?, '2026-10-31') ON CONFLICT (hour) DO NOTHING`, h);
      db.usage.rowsRead = 0;
      db.usage.rowsWritten = 0;
      meter.hours();
      expect(db.usage.rowsRead).toBeLessThanOrEqual(24);
      expect(db.usage.rowsWritten).toBe(0);
    });
  });

  it("refuses rows the table does not allow", async () => {
    await withAiWorld(({ db }) => {
      expect(() => db.run(`INSERT INTO zur_usage_hourly (hour, day) VALUES (24, '2026-10-31')`)).toThrow();
      expect(() => db.run(`INSERT INTO zur_usage_hourly (hour, day) VALUES (-1, '2026-10-31')`)).toThrow();
      expect(() => db.run(`INSERT INTO zur_usage_monthly (month, last_day) VALUES ('2026-1', '2026-01-01')`)).toThrow();
    });
  });
});

describe("the year by the month", () => {
  it("is empty before any use, and always spans 12 months ending in the current one", async () => {
    await withAiWorld(({ meter }) => {
      expect(usageMonthsSchema.parse(meter.months())).toEqual({ from: "2025-11", to: "2026-10", months: [] });
      expect(USAGE_MONTHS).toBe(12);
    });
  });

  it("shows today and yesterday at once, before they are summed into the month", async () => {
    await withAiWorld(({ db, meter }) => {
      seedDay(db, "2026-10-30");
      call(meter);
      expect(monthly(db)).toEqual([]);
      const { months } = usageMonthsSchema.parse(meter.months());
      expect(months).toHaveLength(1);
      expect(months[0]).toMatchObject({ month: "2026-10", days: 2, requests: 11, errors: 1, aborted: 2, fallbacks: 3, audioSeconds: 60, paidUsd: 0.5 });
      expect(months[0]?.neurons).toBeCloseTo(100 + ONE, 6);
    });
  });

  it("sums the closed days into their months at the first call of a day, once, and reads the same total after", async () => {
    await withAiWorld(({ db, meter, clock }) => {
      // 89 days of history, as an instance of before this table has.
      for (let i = 1; i < 90; i++) seedDay(db, UsageMeter.day(NOON - i * DAY));
      const before = meter.months();
      call(meter); // the first call of 31/10 sums up to 29/10; 30/10 may still get a late call
      expect(monthly(db)).toEqual([
        { month: "2026-08", last_day: "2026-08-31", days: 29, requests: 290 },
        { month: "2026-09", last_day: "2026-09-30", days: 30, requests: 300 },
        { month: "2026-10", last_day: "2026-10-29", days: 29, requests: 290 },
      ]);
      const after = meter.months();
      expect(after.months.map((m) => [m.month, m.days, m.requests])).toEqual([
        ["2026-08", 29, 290],
        ["2026-09", 30, 300],
        ["2026-10", 31, 301],
      ]);
      // Same numbers as before the sum, plus the call.
      expect(after.months.map((m) => m.requests)).toEqual(before.months.map((m, i) => m.requests + (i === 2 ? 1 : 0)));
      // Not again on the same day, and the next day adds only the day that closed.
      clock.now += 1_000;
      call(meter);
      expect(monthly(db).map((m) => m.requests)).toEqual([290, 300, 290]);
      clock.now = NOON + DAY;
      call(meter);
      expect(monthly(db)).toEqual([
        { month: "2026-08", last_day: "2026-08-31", days: 29, requests: 290 },
        { month: "2026-09", last_day: "2026-09-30", days: 30, requests: 300 },
        { month: "2026-10", last_day: "2026-10-30", days: 30, requests: 300 },
      ]);
      expect(meter.months().months.map((m) => [m.month, m.days, m.requests])).toEqual([
        ["2026-08", 29, 290],
        ["2026-09", 30, 300],
        ["2026-10", 31, 302],
        ["2026-11", 1, 1],
      ]);
    });
  });

  it("pays for the sum once: the first call after the update reads the 90 days, the first of any other day reads the day that closed", async () => {
    await withAiWorld(({ db, meter, clock }) => {
      for (let i = 1; i < 90; i++) seedDay(db, UsageMeter.day(NOON - i * DAY));
      db.usage.rowsRead = 0;
      db.usage.rowsWritten = 0;
      meter.reserveChat(chat(), LIMITS);
      const first = { ...db.usage };
      // 88 closed days read once (each counts twice: the read and the grouping by month), three months written, and the day's own row.
      expect(first.rowsRead).toBeLessThanOrEqual(190);
      expect(first.rowsWritten).toBeLessThanOrEqual(5);
      clock.now = NOON + DAY;
      db.usage.rowsRead = 0;
      db.usage.rowsWritten = 0;
      meter.reserveChat(chat(), LIMITS);
      // The newest month, the day that closed and its month, the day past the 90 removed with its model's line, and today's row.
      expect(db.usage.rowsRead).toBeLessThanOrEqual(8);
      expect(db.usage.rowsWritten).toBeLessThanOrEqual(4);
    });
  });

  it("sums the months on a day already in use too (an update in the middle of the day), and the year stops reading every day", async () => {
    await withAiWorld(({ db, clock }) => {
      for (let i = 0; i < 90; i++) seedDay(db, UsageMeter.day(NOON - i * DAY));
      // A meter that wakes with today's row already there, as after an update.
      const meter = new UsageMeter(db, () => clock.now);
      db.usage.rowsRead = 0;
      const before = meter.months();
      // Not summed yet: the year reads the days kept, each twice (the read and the grouping). Never more than the 90.
      expect(db.usage.rowsRead).toBeLessThanOrEqual(190);
      call(meter);
      expect(monthly(db).map((m) => m.last_day)).toEqual(["2026-08-31", "2026-09-30", "2026-10-29"]);
      db.usage.rowsRead = 0;
      const after = meter.months();
      expect(db.usage.rowsRead).toBeLessThanOrEqual(8);
      expect(after.months.map((m) => [m.month, m.days, m.requests])).toEqual(before.months.map((m, i) => [m.month, m.days, m.requests + (i === 2 ? 1 : 0)]));
      // The same wake does not look again; another wake looks once and writes nothing.
      db.usage.rowsRead = 0;
      db.usage.rowsWritten = 0;
      meter.reserveChat(chat(), LIMITS);
      expect([db.usage.rowsRead, db.usage.rowsWritten]).toEqual([1, 1]);
      db.usage.rowsRead = 0;
      db.usage.rowsWritten = 0;
      new UsageMeter(db, () => clock.now).reserveChat(chat(), LIMITS);
      expect(db.usage.rowsRead).toBeLessThanOrEqual(2);
      expect(db.usage.rowsWritten).toBe(1);
    });
  });

  it("does not take a day whose only reservation was given back for a day, or a month, with use", async () => {
    await withAiWorld(({ db, meter, clock }) => {
      meter.release(meter.reserveChat(chat(), LIMITS));
      expect(db.one<{ n: number }>(`SELECT ai_requests AS n FROM zur_usage_daily`)?.n).toBe(0);
      expect(meter.months().months).toEqual([]);
      clock.now = NOON + DAY;
      call(meter);
      clock.now = NOON + 3 * DAY;
      call(meter);
      // October's day closed with nothing in it; November has two days with use.
      expect(meter.months().months.map((m) => [m.month, m.days, m.requests])).toEqual([["2026-11", 2, 2]]);
    });
  });

  it("counts a call that ended after midnight in the month's total, though its day had already closed", async () => {
    await withAiWorld(({ db, meter, clock }) => {
      clock.now = Date.parse("2026-10-31T23:59:00Z");
      const late = meter.reserveChat(chat(), LIMITS);
      clock.now = Date.parse("2026-11-01T00:01:00Z");
      call(meter);
      meter.settle(late, used(100_000, 10_000));
      meter.failed("2026-10-31", true);
      clock.now = Date.parse("2026-11-02T09:00:00Z");
      call(meter);
      const october = meter.months().months.find((m) => m.month === "2026-10");
      expect(october).toMatchObject({ days: 1, requests: 1, aborted: 1 });
      expect(october?.neurons).toBeCloseTo(chatNeurons(GLM, 100_000, 10_000), 6);
      expect(monthly(db).map((m) => [m.month, m.last_day])).toEqual([["2026-10", "2026-10-31"]]);
    });
  });

  it("keeps the months when the days are removed after 90, and loses nothing after a long time without use", async () => {
    await withAiWorld(({ db, meter, clock }) => {
      seedDay(db, "2026-10-30", 2);
      call(meter); // 31/10
      // 120 days later: the days of October are past the 90, and were never summed.
      clock.now = NOON + 120 * DAY; // 2027-02-28
      expect(meter.months().months.map((m) => [m.month, m.requests])).toEqual([["2026-10", 21]]);
      call(meter);
      expect(db.all(`SELECT day FROM zur_usage_daily ORDER BY day`)).toEqual([{ day: "2027-02-28" }]);
      expect(meter.months()).toMatchObject({ from: "2026-03", to: "2027-02" });
      expect(meter.months().months.map((m) => [m.month, m.days, m.requests])).toEqual([
        ["2026-10", 2, 21],
        ["2027-02", 1, 1],
      ]);
    });
  });

  it("shows 12 months and removes the 13th (n−1, n, n+1)", async () => {
    await withAiWorld(({ db, meter, clock }) => {
      for (const month of ["2025-10", "2025-11", "2025-12"]) db.run(`INSERT INTO zur_usage_monthly (month, last_day, days, requests) VALUES (?, ?, 1, 5)`, month, `${month}-15`);
      // In October 2026 the year starts in November 2025: October 2025 is out of the answer.
      expect(meter.months().months.map((m) => m.month)).toEqual(["2025-11", "2025-12"]);
      call(meter);
      expect(monthly(db).map((m) => m.month)).toEqual(["2025-11", "2025-12"]);
      clock.now = Date.parse("2026-11-01T00:00:00Z");
      expect(meter.months()).toMatchObject({ from: "2025-12", to: "2026-11" });
      expect(meter.months().months.map((m) => m.month)).toEqual(["2025-12", "2026-10"]);
      call(meter);
      expect(monthly(db).map((m) => m.month)).toEqual(["2025-12"]);
    });
  });

  it("never counts a day twice when every month kept is older than a year", async () => {
    await withAiWorld(({ db, meter, clock }) => {
      seedDay(db, "2026-10-29");
      seedDay(db, "2026-10-30");
      call(meter); // sums 29/10; 30 and 31 stay as days
      clock.now = NOON + 400 * DAY; // 2027-12-05: October 2026 is out of the year
      expect(meter.months().months).toEqual([]);
      call(meter);
      expect(monthly(db)).toEqual([]);
      expect(meter.months().months.map((m) => [m.month, m.requests])).toEqual([["2027-12", 1]]);
      clock.now += 3 * DAY;
      call(meter);
      expect(monthly(db)).toEqual([{ month: "2027-12", last_day: "2027-12-05", days: 1, requests: 1 }]);
      expect(meter.months().months.map((m) => [m.month, m.days, m.requests])).toEqual([["2027-12", 2, 2]]);
    });
  });

  it("crosses the year: January reads from February of the year before", async () => {
    await withAiWorld(({ meter, clock }) => {
      clock.now = Date.parse("2027-01-01T00:00:00Z");
      expect(meter.months()).toMatchObject({ from: "2026-02", to: "2027-01" });
      clock.now = Date.parse("2028-02-29T23:59:59Z");
      expect(meter.months()).toMatchObject({ from: "2027-03", to: "2028-02" });
    });
  });

  it("reads about a page and writes nothing, with a year of months and 90 days of history", async () => {
    await withAiWorld(({ db, meter }) => {
      for (let i = 1; i < 90; i++) seedDay(db, UsageMeter.day(NOON - i * DAY));
      call(meter);
      for (let m = 1; m <= 7; m++) db.run(`INSERT INTO zur_usage_monthly (month, last_day, days, requests) VALUES (?, ?, 3, 9)`, `2026-0${m}`, `2026-0${m}-20`);
      db.usage.rowsRead = 0;
      db.usage.rowsWritten = 0;
      expect(meter.months().months).toHaveLength(10);
      // 10 months and the two days not yet summed.
      expect(db.usage.rowsRead).toBeLessThanOrEqual(14);
      expect(db.usage.rowsWritten).toBe(0);
    });
  });
});
