import { describe, expect, it } from "vitest";
import { COUNTRY_DIAL, HOME_COUNTRY, isCountry, validPhone } from "../src/countries.ts";

describe("countries of a patient's phone (E5e)", () => {
  it("lists every country once, by its two-letter code, with its dialing code; Brazil is home", () => {
    const codes = Object.keys(COUNTRY_DIAL);
    expect(codes.length).toBe(217);
    expect(codes.every((code) => /^[A-Z]{2}$/.test(code))).toBe(true);
    expect(Object.values(COUNTRY_DIAL).every((dial) => /^\+\d{1,4}$/.test(dial))).toBe(true);
    expect([COUNTRY_DIAL.BR, COUNTRY_DIAL.US, COUNTRY_DIAL.CA, COUNTRY_DIAL.PT]).toEqual(["+55", "+1", "+1", "+351"]);
    expect(HOME_COUNTRY).toBe("BR");
    expect(Object.isFrozen(COUNTRY_DIAL)).toBe(true);
  });

  it("knows a code of the list and nothing else", () => {
    expect(isCountry("BR")).toBe(true);
    for (const code of ["", "br", "XX", "BRA", "toString", "__proto__"]) expect(isCountry(code), code).toBe(false);
  });

  it("takes a Brazilian phone with its area code and 8 or 9 digits, and 6 to 15 digits elsewhere", () => {
    expect(validPhone("BR", "4133330000")).toBe(true);
    expect(validPhone("BR", "41999990000")).toBe(true);
    for (const digits of ["413333000", "419999900000", "01999990000", "10999990000", "4199999000a", ""]) expect(validPhone("BR", digits), digits).toBe(false);
    expect(validPhone("PT", "12345")).toBe(false);
    expect(validPhone("PT", "123456")).toBe(true);
    expect(validPhone("PT", "123456789012345")).toBe(true);
    expect(validPhone("PT", "1234567890123456")).toBe(false);
    expect(validPhone("PT", "+351123456")).toBe(false);
  });
});
