import { describe, expect, it } from "vitest";
import { CLINIC_LIMITS, clinicLocation, clinicSchema, DEFAULT_CLINIC, DEFAULT_SETTINGS, settingsUpdateSchema } from "../src/index.ts";

// E6a (plano consultorio-dados.md): the office's details, one line each, the WhatsApp as its digits.

const valid = { name: "Consultório Exemplo", whatsapp: "4133330000", address: "Rua das Flores, 120, sala 304 · Centro", city: "Curitiba, PR" };

describe("E6a: the office's details", () => {
  it("defaults to nothing and is part of the settings", () => {
    expect(DEFAULT_CLINIC).toEqual({ name: "", whatsapp: "", address: "", city: "" });
    expect(DEFAULT_SETTINGS.clinic).toBe(DEFAULT_CLINIC);
    expect(settingsUpdateSchema.safeParse({ clinic: valid }).success).toBe(true);
  });

  it("tidies each line and keeps each limit (n−1, n, n+1)", () => {
    expect(clinicSchema.parse({ ...valid, name: "  Consultório   Exemplo  " }).name).toBe("Consultório Exemplo");
    for (const [key, max] of [["name", CLINIC_LIMITS.name], ["address", CLINIC_LIMITS.address], ["city", CLINIC_LIMITS.city]] as const) {
      expect(clinicSchema.safeParse({ ...valid, [key]: "a".repeat(max - 1) }).success).toBe(true);
      expect(clinicSchema.safeParse({ ...valid, [key]: "a".repeat(max) }).success).toBe(true);
      expect(clinicSchema.safeParse({ ...valid, [key]: "a".repeat(max + 1) }).success).toBe(false);
    }
    // Code points, not UTF-16 units: an emoji counts as one.
    expect(clinicSchema.safeParse({ ...valid, name: "🦷".repeat(CLINIC_LIMITS.name) }).success).toBe(true);
  });

  it("refuses a line break, a control character and a tag", () => {
    // QA-E6a-02: the line and paragraph separators too.
    for (const bad of ["Rua A\nRua B", "Rua A\u2028Rua B", "Rua A\u2029Rua B", "Rua\u0000", "Rua ‮etsap", "<script>alert(1)</script>", "Sala ‹b›"]) {
      expect(clinicSchema.safeParse({ ...valid, address: bad }).success, bad).toBe(false);
    }
  });

  it("takes the WhatsApp as an area code and a landline or a mobile, or none", () => {
    for (const ok of ["", "4133330000", "41933330000", "5599998888", "55999998888"]) expect(clinicSchema.safeParse({ ...valid, whatsapp: ok }).success, ok).toBe(true);
    // QA-E6a-08: an area code with a zero, and 11 digits that are no mobile.
    for (const bad of ["413333000", "419333300001", "(41) 3333-0000", "+554133330000", "0000000000", "0133330000", "4033330000", "41833330000"]) expect(clinicSchema.safeParse({ ...valid, whatsapp: bad }).success, bad).toBe(false);
  });

  it("refuses a field it does not know", () => {
    expect(clinicSchema.safeParse({ ...valid, pix: "x" }).success).toBe(false);
  });

  it("makes the location from the address and the city", () => {
    expect(clinicLocation(valid)).toBe("Rua das Flores, 120, sala 304 · Centro, Curitiba, PR");
    expect(clinicLocation({ ...valid, city: "" })).toBe("Rua das Flores, 120, sala 304 · Centro");
    // No address: no location, even with a city.
    expect(clinicLocation({ ...valid, address: "" })).toBe("");
    // SEC-E6a-01: the limit counts code points, as the schema does.
    const long = clinicLocation({ ...valid, address: `a${"😀".repeat(159)}`, city: "😀".repeat(60) });
    // 222 characters (444 UTF-16 units): whole, the city included, never half an emoji.
    expect(long).toBe(`a${"😀".repeat(159)}, ${"😀".repeat(60)}`);
    // The longest address and city fit the location at Google whole.
    expect(clinicLocation({ ...valid, address: "a".repeat(160), city: "b".repeat(60) }).length).toBeLessThanOrEqual(CLINIC_LIMITS.location);
  });
});
