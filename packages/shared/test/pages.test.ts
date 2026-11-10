import { describe, expect, it } from "vitest";
import { MOVED_PAGES, movedTo, NOTICE_LINKS, noticePage } from "../src/index.ts";

describe("addresses that changed name with the Sinal shell", () => {
  it("sends each old address to its new one", () => {
    expect(movedTo("/automacoes")).toBe("/rotinas");
    expect(movedTo("/automacoes/rotinas")).toBe("/rotinas");
    expect(movedTo("/automacoes/fluxos")).toBe("/crm/fluxos");
    expect(movedTo("/automacoes/conexoes")).toBe("/crm/credenciais");
    expect(movedTo("/contatos/avaliacoes")).toBe("/avaliacoes");
  });

  it("ignores a trailing slash and opens Rotinas for anything else under the old name", () => {
    expect(movedTo("/automacoes/")).toBe("/rotinas");
    expect(movedTo("/automacoes/fluxos/")).toBe("/crm/fluxos");
    expect(movedTo("/automacoes/qualquer/coisa")).toBe("/rotinas");
  });

  it("leaves alone what never moved, a look-alike and a name of Object's own", () => {
    for (const path of ["/", "/rotinas", "/crm/fluxos", "/contatos", "/contatos/clientes", "/automacoesx", "/x/automacoes", "/constructor", "/__proto__", ""]) {
      expect(movedTo(path), path).toBeNull();
    }
  });

  it("never sends to an address that moved again, and never outside the app", () => {
    for (const to of Object.values(MOVED_PAGES)) {
      expect(movedTo(to), to).toBeNull();
      expect(to).toMatch(/^\/[a-z]+(\/[a-z]+)?$/);
    }
  });
});

describe("the page a notice opens", () => {
  it("keeps every page of today's list", () => {
    for (const link of NOTICE_LINKS) expect(noticePage(link)).toBe(link);
  });

  it("gives today's address to a link saved under an old name", () => {
    expect(noticePage("/automacoes")).toBe("/rotinas");
    expect(noticePage("/automacoes/fluxos")).toBe("/crm/fluxos");
    expect(noticePage("/contatos/avaliacoes")).toBe("/avaliacoes");
  });

  it("drops nothing, an address outside the list and another site", () => {
    for (const link of [null, undefined, "", "/conversa", "/crm/credenciais", "/automacoes/conexoes", "https://exemplo.com.br/rotinas", "//exemplo.com.br", "/rotinas?x=1", "/rotinas#a"]) {
      expect(noticePage(link), String(link)).toBeNull();
    }
  });

  it("no page of the list is an old address", () => {
    for (const link of NOTICE_LINKS) expect(movedTo(link), link).toBeNull();
  });
});
