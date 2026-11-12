import type { ReviewMetrics } from "@zuri/shared";
import { describe, expect, it } from "vitest";
import { barHeight, barLabel, countdown, mark, overview, percent, replyTime, reviewAddress } from "../src/pages/reviews/numbers.ts";

const metrics = (over: Partial<ReviewMetrics> = {}): ReviewMetrics => ({
  period: "30d",
  from: "2026-10-13T03:00:00.000Z",
  unit: "week",
  ratings: [5, 1, 0, 1, 0],
  buckets: [
    { key: "2026-10-12", promoters: 1, neutrals: 0, detractors: 1 },
    { key: "2026-10-19", promoters: 0, neutrals: 0, detractors: 0 },
    { key: "2026-10-26", promoters: 2, neutrals: 1, detractors: 0 },
    { key: "2026-11-02", promoters: 0, neutrals: 0, detractors: 0 },
    { key: "2026-11-09", promoters: 2, neutrals: 0, detractors: 0 },
  ],
  replied: 6,
  medianReplyMinutes: 240,
  requests: null,
  partial: false,
  ...over,
});

describe("the overview's numbers", () => {
  it("makes the index, the average and the replied share out of the counts", () => {
    const view = overview(metrics());
    expect(view.total).toBe(7);
    expect(view.index).toBe(57);
    expect(view.average).toBeCloseTo(31 / 7);
    expect(view.repliedPercent).toBe(86);
    expect([view.promoters, view.neutrals, view.detractors]).toEqual([5, 1, 1]);
  });

  it("compares the last week with reviews to the first one, skipping the empty ones", () => {
    const view = overview(metrics());
    expect(view.bars.map((bar) => bar.index)).toEqual([0, null, 67, null, 100]);
    expect(view.delta).toBe(100);
    // An empty last week is not a fall to zero.
    const quiet = metrics();
    quiet.buckets[4] = { key: "2026-11-09", promoters: 0, neutrals: 0, detractors: 0 };
    expect(overview(quiet).delta).toBe(67);
  });

  it("has no index, average, share nor change without reviews, and no change with a single week", () => {
    const empty = overview(metrics({ ratings: [0, 0, 0, 0, 0], buckets: [], replied: 0 }));
    expect([empty.index, empty.average, empty.repliedPercent, empty.delta]).toEqual([null, null, null, null]);
    const single = overview(metrics({ buckets: [{ key: "2026-11-09", promoters: 1, neutrals: 0, detractors: 0 }] }));
    expect(single.delta).toBeNull();
  });

  it("works with 5 or 6 weeks and with 12 months alike", () => {
    const six = metrics();
    six.buckets.push({ key: "2026-11-16", promoters: 0, neutrals: 0, detractors: 3 });
    expect(overview(six).bars).toHaveLength(6);
    expect(overview(six).delta).toBe(-100);
  });

  it("gives whole percents and never divides by zero", () => {
    expect(percent(5, 7)).toBe(71);
    expect(percent(0, 0)).toBe(0);
  });

  it("keeps every bar visible: the floor for -100, the top for 100", () => {
    expect(barHeight(-100)).toBe(4);
    expect(barHeight(0)).toBe(50);
    expect(barHeight(100)).toBe(100);
    expect(barHeight(500)).toBe(100);
  });

  it("says the reply time in minutes, hours or days", () => {
    expect(replyTime(0)).toEqual({ n: 0, unit: "minute" });
    expect(replyTime(59)).toEqual({ n: 59, unit: "minute" });
    expect(replyTime(60)).toEqual({ n: 1, unit: "hour" });
    expect(replyTime(240)).toEqual({ n: 4, unit: "hour" });
    expect(replyTime(48 * 60 - 1)).toEqual({ n: 48, unit: "hour" });
    expect(replyTime(48 * 60)).toEqual({ n: 2, unit: "day" });
  });

  it("writes a week by its Monday and a month by its name, whatever the device's zone", () => {
    expect(barLabel("2026-11-09", "week", "pt-BR")).toBe("09/11");
    expect(barLabel("2026-11", "month", "pt-BR")).toMatch(/^nov/);
    expect(barLabel("nope", "week", "pt-BR")).toBe("nope");
  });

  it("counts down without going below zero", () => {
    expect(countdown(527_000)).toBe("8:47");
    expect(countdown(3_723_000)).toBe("1:02:03");
    expect(countdown(-5)).toBe("0:00");
    expect(countdown(Number.NaN)).toBe("0:00");
  });

  it("marks a reviewer by the first letter, never by a symbol", () => {
    expect(mark("élida", false)).toBe("É");
    expect(mark("<b>", false)).toBe("B");
    expect(mark("Ana", true)).toBe("?");
    expect(mark("", false)).toBe("?");
  });
});

describe("the addresses under /avaliacoes", () => {
  it("keeps the real ones and sends the rest to the nearest one", () => {
    expect(reviewAddress(undefined, undefined)).toBeNull();
    expect(reviewAddress("lista", undefined)).toBeNull();
    expect(reviewAddress("lista", "00000000-0000-4000-8000-000000000001")).toBeNull();
    expect(reviewAddress("lista", "../entrar")).toBe("/avaliacoes/lista");
    expect(reviewAddress("ajustes", undefined)).toBeNull();
    expect(reviewAddress("ajustes", "responder")).toBeNull();
    expect(reviewAddress("ajustes", "agente")).toBe("/avaliacoes/ajustes");
    expect(reviewAddress("nada", undefined)).toBe("/avaliacoes");
    expect(reviewAddress("nada", "responder")).toBe("/avaliacoes");
  });
});
