import { describe, expect, it } from "vitest";
import { isInside, MORE_ITEMS, NAV, NAV_ITEMS, TAB_ITEMS, topBarHidden } from "../src/lib/nav.ts";

describe("the one list of places", () => {
  it("has three groups: the first without a title, then Organizar and Relacionamento", () => {
    expect(NAV.map((group) => group.heading)).toEqual([undefined, "web.nav.groupOrganize", "web.nav.groupRelations"]);
    expect(NAV.map((group) => group.items.map((item) => item.to))).toEqual([
      ["/", "/conversa"],
      ["/tarefas", "/agenda", "/notas", "/memoria", "/rotinas"],
      ["/contatos", "/avaliacoes", "/crm"],
    ]);
  });

  it("gives the phone's bar the first four and the sheet the rest, with nothing left out or repeated", () => {
    expect(TAB_ITEMS.map((item) => item.id)).toEqual(["home", "chat", "tasks", "agenda"]);
    expect(MORE_ITEMS.map((item) => item.id)).toEqual(["notes", "memory", "routines", "contacts", "reviews", "crm"]);
    expect([...TAB_ITEMS, ...MORE_ITEMS]).toEqual(NAV_ITEMS);
    expect(new Set(NAV_ITEMS.map((item) => item.id)).size).toBe(NAV_ITEMS.length);
    expect(new Set(NAV_ITEMS.map((item) => item.to)).size).toBe(NAV_ITEMS.length);
  });
});

describe("whether an address is inside a place", () => {
  it("the home page is only itself", () => {
    expect(isInside("/", "/")).toBe(true);
    expect(isInside("/tarefas", "/")).toBe(false);
  });

  it("a place holds its sub-addresses, never a look-alike", () => {
    expect(isInside("/crm", "/crm")).toBe(true);
    expect(isInside("/crm/fluxos", "/crm")).toBe(true);
    expect(isInside("/crmx", "/crm")).toBe(false);
    expect(isInside("/configuracoes/avisos", "/configuracoes")).toBe(true);
  });
});

describe("the phone's top bar", () => {
  it("always shows near the top", () => {
    expect(topBarHidden(true, 55, 300, 900)).toBe(false);
    expect(topBarHidden(false, 0, 0, 900)).toBe(false);
  });

  it("leaves on a clear move down and returns on a clear move up", () => {
    expect(topBarHidden(false, 207, 200, 900)).toBe(true);
    expect(topBarHidden(true, 193, 200, 900)).toBe(false);
  });

  it("keeps as it is on a tremble (6 px or less, either way)", () => {
    expect(topBarHidden(false, 206, 200, 900)).toBe(false);
    expect(topBarHidden(true, 194, 200, 900)).toBe(true);
    expect(topBarHidden(true, 200, 200, 900)).toBe(true);
  });

  it("doesn't leave when the end is near (80 px or less below)", () => {
    expect(topBarHidden(false, 500, 400, 80)).toBe(false);
    expect(topBarHidden(false, 500, 400, 81)).toBe(true);
    // Already away, it stays away there.
    expect(topBarHidden(true, 500, 400, 10)).toBe(true);
  });

  it("the edge of the top: 56 px is no longer near it", () => {
    expect(topBarHidden(true, 56, 56, 900)).toBe(true);
  });
});
