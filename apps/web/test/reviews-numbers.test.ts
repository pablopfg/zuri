import type { ReviewMetrics } from "@zuri/shared";
import { describe, expect, it } from "vitest";
import { barHeight, barLabel, countdown, indexMargin, indexZone, mark, overview, percent, ratingZone, replyTime, reviewAddress,
  whatsAppLink, stats } from "../src/pages/reviews/numbers.ts";

const metrics = (over: Partial<ReviewMetrics> = {}): ReviewMetrics => ({
  period: "30d",
  from: "2026-10-13T03:00:00.000Z",
  unit: "week",
  ratings: [5, 1, 0, 1, 0],
  buckets: [
    { key: "2026-10-12", promoters: 1, neutrals: 0, detractors: 1, stars: 7 },
    { key: "2026-10-19", promoters: 0, neutrals: 0, detractors: 0, stars: 0 },
    { key: "2026-10-26", promoters: 2, neutrals: 1, detractors: 0, stars: 14 },
    { key: "2026-11-02", promoters: 0, neutrals: 0, detractors: 0, stars: 0 },
    { key: "2026-11-09", promoters: 2, neutrals: 0, detractors: 0, stars: 10 },
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
    quiet.buckets[4] = { key: "2026-11-09", promoters: 0, neutrals: 0, detractors: 0, stars: 0 };
    expect(overview(quiet).delta).toBe(67);
  });

  it("has no index, average, share nor change without reviews, and no change with a single week", () => {
    const empty = overview(metrics({ ratings: [0, 0, 0, 0, 0], buckets: [], replied: 0 }));
    expect([empty.index, empty.average, empty.repliedPercent, empty.delta]).toEqual([null, null, null, null]);
    const single = overview(metrics({ buckets: [{ key: "2026-11-09", promoters: 1, neutrals: 0, detractors: 0, stars: 5 }] }));
    expect(single.delta).toBeNull();
  });

  it("works with 5 or 6 weeks and with 12 months alike", () => {
    const six = metrics();
    six.buckets.push({ key: "2026-11-16", promoters: 0, neutrals: 0, detractors: 3, stars: 3 });
    expect(overview(six).bars).toHaveLength(6);
    expect(overview(six).delta).toBe(-100);
  });

  it("gives each bar its count and its average, and none to an empty one", () => {
    const view = overview(metrics());
    expect(view.bars.map((bar) => bar.total)).toEqual([2, 0, 3, 0, 2]);
    expect(view.bars[0]?.average).toBe(3.5);
    expect(view.bars[1]?.average).toBeNull();
    expect(view.bars[2]?.average).toBeCloseTo(14 / 3);
  });

  it("names the band of an index and of an average at each edge", () => {
    expect([100, 75, 74, 50, 49, 0, -1, -100].map(indexZone)).toEqual(["excellent", "excellent", "great", "great", "fair", "fair", "poor", "poor"]);
    // The band is the one of the number as written, with one decimal: 4,46 reads "4,5", which is excellent.
    expect([5, 4.5, 4.46, 4.44, 4, 3.96, 3.94, 3, 2.96, 2.94, 1].map(ratingZone)).toEqual(["excellent", "excellent", "excellent", "great", "great", "great", "fair", "fair", "fair", "poor", "poor"]);
  });

  it("works out the median, the mode, the spread, the satisfied share, the margin, the pace, the peak and the trend", () => {
    // Seven reviews: 5, 5, 5, 5, 5, 4 and 2 stars.
    const numbers = stats(metrics());
    if (!numbers) throw new Error("there are reviews");
    expect(numbers.median).toBe(5);
    expect(numbers.modes).toEqual([5]);
    // Mean 31/7; the squares of the distances sum to 54/7.
    expect(numbers.deviation).toBeCloseTo(Math.sqrt(54 / 49));
    expect(numbers.satisfied).toBe(86);
    // Seven reviews are too few for a margin.
    expect(numbers.margin).toBeNull();
    expect(numbers.perBar).toBeCloseTo(7 / 5);
    // The latest of the bars with most reviews.
    expect(numbers.peak.key).toBe("2026-10-26");
    // The index was 0, 67 and 100 at the bars 0, 2 and 4: a line through them gains 25 a bar.
    expect(numbers.trend).toBeCloseTo(25);
  });

  it("takes the mean of the two middle ratings, keeps every tied mode, and has no trend with two bars nor numbers without reviews", () => {
    // 5, 4, 2, 1: the middle is between 2 and 4.
    const even = stats(metrics({ ratings: [1, 1, 0, 1, 1], buckets: [{ key: "2026-11-09", promoters: 1, neutrals: 1, detractors: 2, stars: 12 }] }));
    expect(even?.median).toBe(3);
    expect(even?.modes).toEqual([5, 4, 2, 1]);
    expect(even?.trend).toBeNull();
    // Everybody alike: no spread, and a margin of zero.
    const alike = stats(metrics({ ratings: [4, 0, 0, 0, 0], buckets: [{ key: "2026-11-09", promoters: 4, neutrals: 0, detractors: 0, stars: 20 }] }));
    expect([alike?.deviation, alike?.margin, alike?.satisfied]).toEqual([0, null, 100]);
    expect(stats(metrics({ ratings: [0, 0, 0, 0, 0], buckets: [], replied: 0 }))).toBeNull();
    // SEC-GRAF-03: reviews counted and no bar at all is not this server's answer; no numbers, no crash.
    expect(stats(metrics({ buckets: [] }))).toBeNull();
  });

  it("gives the index a margin only from ten reviews on, and never a margin of zero", () => {
    expect(indexMargin(9, 0, 9)).toBeNull();
    // Ten that all recommend: p = 11/13, d = 1/13, 1.96 × √((p + d − (p − d)²) / 13) × 100 = 31,3.
    expect(indexMargin(10, 0, 10)).toBe(31);
    // 98 recommend and 13 do not, of 132: p = 99/135, d = 14/135; the spread is 0,4406 and the margin 11,2.
    expect(indexMargin(98, 13, 132)).toBe(11);
    // More reviews, smaller margin; it never reaches zero.
    expect(indexMargin(5000, 0, 5000)).toBe(1);
    const ten = stats(metrics({ ratings: [10, 0, 0, 0, 0], buckets: [{ key: "2026-11-09", promoters: 10, neutrals: 0, detractors: 0, stars: 50 }] }));
    expect(ten?.margin).toBe(31);
  });

  it("has no average for a bar whose sum of stars did not come", () => {
    const old = metrics();
    old.buckets[0] = { key: "2026-10-12", promoters: 1, neutrals: 0, detractors: 1 } as (typeof old.buckets)[number];
    expect(overview(old).bars[0]?.average).toBeNull();
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
    expect(barLabel("2026", "year", "pt-BR")).toBe("2026");
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
    // PR S20: Pedidos, with a request open, and Ajustes › Pedidos e link.
    expect(reviewAddress("pedidos", undefined)).toBeNull();
    expect(reviewAddress("pedidos", "00000000-0000-4000-8000-000000000001")).toBeNull();
    expect(reviewAddress("pedidos", "x")).toBe("/avaliacoes/pedidos");
    expect(reviewAddress("ajustes", "pedidos")).toBeNull();
    expect(whatsAppLink("+55 (41) 99999-0110", "Oi, Ana! Veja: https://zuri.exemplo.com.br/a/k7Q2mX9pAB & mais")).toBe(
      "https://wa.me/5541999990110?text=Oi%2C%20Ana!%20Veja%3A%20https%3A%2F%2Fzuri.exemplo.com.br%2Fa%2Fk7Q2mX9pAB%20%26%20mais",
    );
    expect(reviewAddress("nada", "responder")).toBe("/avaliacoes");
  });
});
