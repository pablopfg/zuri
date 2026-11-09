import { AI_LIMIT_RANGES } from "@zuri/shared";
import { describe, expect, it } from "vitest";
import { cents } from "../src/pages/settings/AiTab.tsx";

describe("the daily US$ ceiling field", () => {
  it("reads dollars with a comma or a dot, up to two decimal places, as cents", () => {
    expect(cents("0")).toBe(0);
    expect(cents("2")).toBe(200);
    expect(cents(" 2,5 ")).toBe(250);
    expect(cents("2.55")).toBe(255);
    expect(cents("0,01")).toBe(1);
  });

  it("refuses what the server would refuse: negatives, three decimals, words and anything past the top", () => {
    for (const text of ["", "-1", "2,555", "abc", "1e3", "2,5,0", "1.000,00"]) expect(cents(text), text).toBeNull();
    const top = AI_LIMIT_RANGES.aiUsdCentsPerDay.max;
    expect(cents(String(top / 100))).toBe(top);
    expect(cents(String(top / 100 + 0.01))).toBeNull();
  });
});
