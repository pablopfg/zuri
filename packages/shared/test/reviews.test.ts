import { describe, expect, it } from "vitest";
import { REVIEW_LIMITS, recommendationIndex } from "../src/reviews.ts";
import { reviewApproveSchema, reviewMetricsQuerySchema, reviewSettingsSchema } from "../src/reviews-schemas.ts";

// Step 19c: the edges of what the owner may save and approve (n-1, n, n+1).

const LOCATION = "accounts/101/locations/201";
const text = (n: number) => "a".repeat(n);
const valid = {
  locations: [LOCATION],
  signature: "Equipe Exemplo",
  tone: "close",
  templates: [text(20), text(20), text(20)],
  banned: [] as string[],
  level: "approve",
};
const ok = (over: Partial<Record<keyof typeof valid, unknown>>) => reviewSettingsSchema.safeParse({ ...valid, ...over }).success;

describe("the reviews' settings", () => {
  it("takes 3 to 5 templates of 20 to 600 characters", () => {
    expect([2, 3, 5, 6].map((n) => ok({ templates: Array.from({ length: n }, () => text(20)) }))).toEqual([false, true, true, false]);
    expect([19, 20, 600, 601].map((n) => ok({ templates: [text(n), text(20), text(20)] }))).toEqual([false, true, true, false]);
  });

  it("takes a signature of 2 to 60 characters, on one line", () => {
    expect([1, 2, 60, 61].map((n) => ok({ signature: text(n) }))).toEqual([false, true, true, false]);
    expect(ok({ signature: "Equipe​Exemplo" })).toBe(false);
  });

  it("takes up to 50 banned words of up to 40 characters, repeated ones once", () => {
    const words = (n: number) => Array.from({ length: n }, (_, i) => `palavra${i}`);
    expect([50, 51].map((n) => ok({ banned: words(n) }))).toEqual([true, false]);
    expect([40, 41].map((n) => ok({ banned: [text(n)] }))).toEqual([true, false]);
    expect(reviewSettingsSchema.parse({ ...valid, banned: ["x", "x"] }).banned).toEqual(["x"]);
  });

  it("takes up to 3 distinct profiles, only well-formed names", () => {
    const three = ["accounts/1/locations/1", "accounts/1/locations/2", "accounts/1/locations/3"];
    expect(ok({ locations: three })).toBe(true);
    expect(ok({ locations: [...three, "accounts/1/locations/4"] })).toBe(false);
    expect(ok({ locations: ["accounts/1/locations/../x"] })).toBe(false);
    expect(REVIEW_LIMITS.maxLocations).toBe(3);
  });

  it("refuses an unknown field", () => {
    expect(ok({ extra: 1 } as never)).toBe(false);
  });
});

describe("an approval", () => {
  it("takes a text of up to Google's 4,096 bytes", () => {
    const version = "0".repeat(64);
    const parse = (n: number) => reviewApproveSchema.safeParse({ text: text(n), version }).success;
    expect([0, 1, REVIEW_LIMITS.replyBytes, REVIEW_LIMITS.replyBytes + 1].map(parse)).toEqual([false, true, true, false]);
  });
});

describe("the overview's period (PR S11)", () => {
  it("takes 30 days, 6 and 12 months, and 30 days when none is asked", () => {
    expect(reviewMetricsQuerySchema.parse({})).toEqual({ period: "30d" });
    for (const period of ["30d", "6m", "12m"]) expect(reviewMetricsQuerySchema.parse({ period })).toEqual({ period });
  });

  it("refuses any other period and any other field", () => {
    for (const period of ["", "7d", "30D", "1y", " 30d", "12m\u0000", 30, null, ["30d"]]) expect(reviewMetricsQuerySchema.safeParse({ period }).success, String(period)).toBe(false);
    expect(reviewMetricsQuerySchema.safeParse({ period: "30d", from: "2020-01-01" }).success).toBe(false);
  });
});

describe("the recommendation index (PR S11)", () => {
  it("is the share that recommends minus the share that does not, from -100 to 100", () => {
    expect(recommendationIndex({ promoters: 5, neutrals: 1, detractors: 1 })).toBe(57);
    expect(recommendationIndex({ promoters: 1, neutrals: 0, detractors: 2 })).toBe(-33);
    expect(recommendationIndex({ promoters: 3, neutrals: 0, detractors: 0 })).toBe(100);
    expect(recommendationIndex({ promoters: 0, neutrals: 0, detractors: 3 })).toBe(-100);
    expect(recommendationIndex({ promoters: 0, neutrals: 2, detractors: 0 })).toBe(0);
  });

  it("is null without reviews, never a zero that would read as a bad score", () => {
    expect(recommendationIndex({ promoters: 0, neutrals: 0, detractors: 0 })).toBeNull();
  });
});
