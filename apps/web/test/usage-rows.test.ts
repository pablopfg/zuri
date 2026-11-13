import { describe, expect, it } from "vitest";
import { hourRows, monthRows } from "../src/pages/settings/UsageCharts.tsx";

const totals = { requests: 4, errors: 0, aborted: 0, fallbacks: 0, neurons: 12.5, paidUsd: 0, audioSeconds: 0 };

describe("usage panel columns (PR S16)", () => {
  it("fills today's 24 UTC hours and labels each in the owner's time zone", () => {
    const rows = hourRows({ day: "2026-11-12", hours: [{ hour: 0, ...totals }, { hour: 23, ...totals, requests: 9 }] }, "pt-BR", "America/Sao_Paulo");
    expect(rows).toHaveLength(24);
    // UTC−3: the day the counters keep runs from 21:00 of the day before to 20:59.
    expect(rows[0]).toMatchObject({ key: "0", label: "21:00", short: "21", requests: 4 });
    expect(rows[3]).toMatchObject({ label: "00:00", requests: 0, neurons: 0 });
    expect(rows[23]).toMatchObject({ label: "20:00", requests: 9 });
  });

  it("follows the owner's zone, not the device's, half hours and summer time included", () => {
    expect(hourRows({ day: "2026-11-12", hours: [] }, "pt-BR", "UTC")[0]?.label).toBe("00:00");
    expect(hourRows({ day: "2026-11-12", hours: [] }, "pt-BR", "Asia/Kolkata")[0]?.label).toBe("05:30");
    // Day of the change to summer time in New York (8 March 2026): 02:00 never happens, and the
    // first and last columns both read 19:00 (of two different evenings); the keys stay apart.
    const rows = hourRows({ day: "2026-03-08", hours: [] }, "pt-BR", "America/New_York");
    expect(rows.slice(6, 9).map((r) => r.label)).toEqual(["01:00", "03:00", "04:00"]);
    expect([rows[0]?.label, rows[23]?.label]).toEqual(["19:00", "19:00"]);
    expect(new Set(rows.map((r) => r.key)).size).toBe(24);
  });

  it("fills the 12 months from `from`, across a year's turn, the quiet ones as zeros", () => {
    const rows = monthRows({ from: "2025-12", to: "2026-11", months: [{ month: "2026-01", days: 3, ...totals }] }, "pt-BR");
    expect(rows.map((r) => r.key)).toEqual([
      "2025-12",
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10",
      "2026-11",
    ]);
    expect(rows[1]).toMatchObject({ label: "janeiro de 2026", short: "jan", requests: 4 });
    expect(rows[0]).toMatchObject({ short: "dez", requests: 0 });
  });
});
