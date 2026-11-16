import { describe, expect, it } from "vitest";
import { catalogs } from "../i18n/index.ts";
import { FAMILY_INVERSE, FAMILY_ROLES, familyLinkSchema, familyPair } from "../src/index.ts";

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
      { relative: ID, role: "mother", otherRole: "son", responsible: true },
    ])
      expect(ok(bad), JSON.stringify(bad)).toBe(false);
  });

  it("each role has its name in both languages", () => {
    for (const locale of ["pt-BR", "en"] as const) for (const role of FAMILY_ROLES) expect((catalogs[locale] as Record<string, string>)[`web.contacts.family.role.${role}`], `${locale} ${role}`).toBeTruthy();
  });
});
