import { describe, expect, it } from "vitest";
import { changes, changesReport, inventory, kindOf } from "../../scripts/inventario-de-textos.ts";

describe("kindOf", () => {
  it("names what a person meets from the key", () => {
    expect(kindOf("telegram.help")).toBe("bot");
    expect(kindOf("error.internal")).toBe("erro");
    expect(kindOf("web.flows.problem.failed")).toBe("erro");
    expect(kindOf("notice.security.mfa_disabled.title")).toBe("aviso (título)");
    expect(kindOf("notice.security.mfa_disabled.body")).toBe("aviso");
    expect(kindOf("web.greeting.morning")).toBe("voz da Zuri");
    expect(kindOf("web.crm.empty.body")).toBe("vazio");
    expect(kindOf("web.chat.deleted")).toBe("toast");
    expect(kindOf("web.alerts.telegram.unlinkTitle")).toBe("título");
    expect(kindOf("web.passkeys.remove")).toBe("texto curto");
  });
});

describe("changes", () => {
  const before = { "pt-BR": { a: "Excluir", b: "Igual", c: "Some" }, en: { a: "Delete", b: "Same", c: "Gone" } };
  const after = { "pt-BR": { a: "Apagar", b: "Igual", d: "Nova" }, en: { a: "Delete", b: "Same", d: "New" } };

  it("lists the keys whose text changed, was added or was removed, and nothing else", () => {
    expect(changes(before, after).map((c) => c.key)).toEqual(["a", "c", "d"]);
  });

  it("writes the before → after table, marking a language that kept its text", () => {
    const report = changesReport(changes(before, after), "develop");
    expect(report).toContain("3 chaves mudaram");
    expect(report).toContain("| `a` | texto curto | Excluir → **Apagar** | (igual) |");
  });
});

describe("inventory", () => {
  it("has one row per key, with pipes and line breaks escaped so the table holds", () => {
    const md = inventory({ "pt-BR": { x: "a | b\nc" }, en: { x: "d" } });
    expect(md).toContain("1 chaves.");
    expect(md).toContain("| `x` | texto curto | a \\| b<br>c | d |");
  });
});
