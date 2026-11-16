import { describe, expect, it } from "vitest";
import { catalogs } from "../i18n/index.ts";
import { FAMILY_INVERSE, FAMILY_RESPONSIBLE_ROLES, FAMILY_ROLES, familyLinkSchema, familyPair, whatsappNumber } from "../src/index.ts";

const ID = "0b0b0b0b-1111-4222-8333-444444444444";

describe("family roles (E11b)", () => {
  it("every pair reads back from the other side, and no role pairs with one it doesn't name", () => {
    for (const role of FAMILY_ROLES) {
      expect(FAMILY_INVERSE[role].length, role).toBeGreaterThan(0);
      for (const other of FAMILY_INVERSE[role]) expect(familyPair(other, role), `${role}/${other}`).toBe(true);
      for (const other of FAMILY_ROLES) if (!FAMILY_INVERSE[role].includes(other)) expect(familyPair(role, other), `${role}/${other}`).toBe(false);
    }
  });

  it("the link's body takes a copy's id and two roles that pair, nothing else", () => {
    const ok = (body: unknown) => familyLinkSchema.safeParse(body).success;
    expect(ok({ relative: ID, role: "mother", otherRole: "son" })).toBe(true);
    expect(ok({ relative: ID, role: "dependent", otherRole: "guardian" })).toBe(true);
    for (const bad of [
      { relative: ID, role: "mother", otherRole: "mother" },
      { relative: ID, role: "Mãe", otherRole: "son" },
      { relative: "people/c1", role: "mother", otherRole: "son" },
      { relative: ID, role: "mother" },
      { relative: ID, role: "mother", otherRole: "son", note: "x" },
    ])
      expect(ok(bad), JSON.stringify(bad)).toBe(false);
  });

  it("each role has its name in both languages", () => {
    for (const locale of ["pt-BR", "en"] as const) for (const role of FAMILY_ROLES) expect((catalogs[locale] as Record<string, string>)[`web.contacts.family.role.${role}`], `${locale} ${role}`).toBeTruthy();
  });
});

describe("the responsible (E11c)", () => {
  it("the box goes only with a grown-up role, as true or false", () => {
    const ok = (body: unknown) => familyLinkSchema.safeParse(body).success;
    expect([...FAMILY_RESPONSIBLE_ROLES].sort()).toEqual(["aunt", "brother", "father", "grandfather", "grandmother", "guardian", "mother", "sister", "uncle"]);
    for (const role of FAMILY_ROLES) {
      const other = FAMILY_INVERSE[role][0];
      expect(ok({ relative: ID, role, otherRole: other, responsible: true }), role).toBe(FAMILY_RESPONSIBLE_ROLES.includes(role));
      expect(ok({ relative: ID, role, otherRole: other, responsible: false }), role).toBe(true);
    }
    for (const value of ["true", 1, null]) expect(ok({ relative: ID, role: "mother", otherRole: "son", responsible: value }), String(value)).toBe(false);
  });

  it("the WhatsApp number: a Brazilian mobile only, with or without the country's code", () => {
    expect(whatsappNumber("(11) 98888-0010")).toBe("5511988880010");
    expect(whatsappNumber("+55 21 99876-5432")).toBe("5521998765432");
    expect(whatsappNumber("011 98888-0010")).toBe("5511988880010");
    for (const value of ["(11) 3333-4444", "+1 415 555 0100", "98888-0010", "", "(01) 98888-0010"]) expect(whatsappNumber(value), value).toBeNull();
  });
});
