import { describe, expect, it } from "vitest";
import { t } from "../i18n/index.ts";
import { CONFIRM_MESSAGE_MAX, CONFIRM_MESSAGE_VARS, confirmMessageProblem, confirmValueOk, confirmMessageSchema, DEFAULT_SETTINGS, fillConfirmMessage, settingsUpdateSchema } from "../src/index.ts";

// E7c1 (plano link-de-confirmacao.md, seção 16): the owner's confirmation message, with variables.

const VARS = Object.fromEntries(CONFIRM_MESSAGE_VARS.map((name) => [name, `<${name}>`])) as Record<(typeof CONFIRM_MESSAGE_VARS)[number], string>;

describe("E7c1: the confirmation message", () => {
  it("is the catalog's default until changed, and the default passes its own rules in both languages", () => {
    expect(DEFAULT_SETTINGS.confirmMessage).toBe("");
    expect(confirmMessageProblem("")).toBeNull();
    for (const locale of ["pt-BR", "en"]) {
      const text = t(locale, "confirm.message.default");
      expect(confirmMessageProblem(text), locale).toBeNull();
      for (const name of CONFIRM_MESSAGE_VARS) expect(text, `${locale} {${name}}`).toContain(`{${name}}`);
    }
  });

  it("refuses an empty one, one without {link}, unknown variables by name, and past 1,000 characters (n−1, n, n+1)", () => {
    expect(confirmMessageProblem("   \n ")).toEqual({ problem: "empty" });
    expect(confirmMessageProblem("Olá, {nome}.")).toEqual({ problem: "link" });
    expect(confirmMessageProblem("Oi {nome} {link} {data} {Nome} {} {data}")).toEqual({ problem: "unknown", vars: ["data", "Nome", ""] });
    const fit = (n: number) => `{link}${"a".repeat(n - 6)}`;
    expect(confirmMessageProblem(fit(CONFIRM_MESSAGE_MAX - 1))).toBeNull();
    expect(confirmMessageProblem(fit(CONFIRM_MESSAGE_MAX))).toBeNull();
    expect(confirmMessageProblem(fit(CONFIRM_MESSAGE_MAX + 1))).toEqual({ problem: "long" });
    // Characters, not UTF-16 units: an emoji counts once.
    expect(confirmMessageProblem(`{link}${"😀".repeat(CONFIRM_MESSAGE_MAX - 6)}`)).toBeNull();
    expect(settingsUpdateSchema.safeParse({ confirmMessage: "sem link" }).success).toBe(false);
    expect(settingsUpdateSchema.safeParse({ confirmMessage: "Oi {nome}: {link}" }).success).toBe(true);
    expect(confirmMessageSchema.parse("a\r\nb {link}")).toBe("a\nb {link}");
  });

  it("SEC-E7c1-01: refuses an address or a phone number typed by hand, and invisible characters", () => {
    for (const text of [
      "Oi {nome}: {link} ou https://pix.exemplo.com.br",
      "Oi {nome}: {link} www.exemplo",
      "Oi {nome}: {link} pague em consultorio.exemplo.com.br",
      "Oi {nome}: {link} nosso número mudou: (41) 98888-7777",
      "Oi {nome}: {link} 41988887777",
    ]) expect(confirmMessageProblem(text), text).toEqual({ problem: "address" });
    // Seven digits is not a phone; a sentence end is not an address.
    expect(confirmMessageProblem("Oi {nome}, sala 1234567. Até lá: {link}")).toBeNull();
    for (const bad of ["\u0000", "\u0007", "\u202e", "\u2066"]) expect(confirmMessageProblem(`Oi${bad} {link}`), JSON.stringify(bad)).toEqual({ problem: "control" });
    expect(confirmMessageProblem("Oi 👩‍👩‍👧 {nome}\n{link}")).toBeNull();
    expect(settingsUpdateSchema.safeParse({ confirmMessage: "Oi {link} https://exemplo.com.br" }).success).toBe(false);
    expect(confirmValueOk("Consulta")).toBe(true);
    expect(confirmValueOk("Consulta https://pix.exemplo.com.br")).toBe(false);
    expect(confirmValueOk("pix.exemplo.com")).toBe(false);
    expect(confirmValueOk("Ligue 41988887777")).toBe(false);
  });

  it("puts each known variable in once: a value that carries a variable stays text", () => {
    expect(fillConfirmMessage("{nome}, {dia} às {hora}: {link} {outra}", VARS)).toBe("<nome>, <dia> às <hora>: <link> {outra}");
    expect(fillConfirmMessage("{nome} e {link}", { ...VARS, nome: "{link}" })).toBe("{link} e <link>");
  });
});
