import { describe, expect, it } from "vitest";
import { waitClock } from "../src/components/HumanCheck.tsx";

describe("waitClock", () => {
  it("says minutes and seconds, and hours only when the wait takes them", () => {
    expect(waitClock(1)).toBe("0:01");
    expect(waitClock(59)).toBe("0:59");
    expect(waitClock(60)).toBe("1:00");
    expect(waitClock(892)).toBe("14:52");
    expect(waitClock(3599)).toBe("59:59");
    expect(waitClock(3600)).toBe("1:00:00");
    expect(waitClock(86_400)).toBe("24:00:00");
    expect(waitClock(86_399)).toBe("23:59:59");
  });

  it("never shows a broken clock for a wait that is no number, negative or a fraction", () => {
    expect(waitClock(Number.NaN)).toBe("0:00");
    expect(waitClock(Number.POSITIVE_INFINITY)).toBe("0:00");
    expect(waitClock(-5)).toBe("0:00");
    expect(waitClock(0.4)).toBe("0:01");
  });
});
