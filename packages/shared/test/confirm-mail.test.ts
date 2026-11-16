import { describe, expect, it } from "vitest";
import { t } from "../i18n/index.ts";
import { CONFIRM_MAIL_BODY_VARS, CONFIRM_MAIL_LIMITS, CONFIRM_MAIL_SUBJECT_VARS, confirmMailProblem, confirmMailSchema, confirmMessageProblem, confirmValueOk, fillConfirmMail, DEFAULT_SETTINGS, escapeHtml, settingsUpdateSchema } from "../src/index.ts";

// E7c2 (plano link-de-confirmacao.md, seção 17): the confirmation e-mail's subject, text and button.

const ok = { subject: "", body: "", button: "" };

describe("E7c2: the confirmation e-mail", () => {
  it("is the catalog's default until changed, and the defaults pass their own rules in both languages", () => {
    expect(DEFAULT_SETTINGS.confirmMail).toEqual(ok);
    expect(confirmMailProblem(ok)).toBeNull();
    for (const locale of ["pt-BR", "en"]) {
      const mail = { subject: t(locale, "confirm.mail.subject"), body: t(locale, "confirm.mail.body"), button: t(locale, "confirm.mail.button") };
      expect(confirmMailProblem(mail), locale).toBeNull();
      for (const name of CONFIRM_MAIL_BODY_VARS) expect(mail.body, `${locale} {${name}}`).toContain(`{${name}}`);
    }
    expect(CONFIRM_MAIL_BODY_VARS).not.toContain("link");
    expect(CONFIRM_MAIL_SUBJECT_VARS).toEqual(["nome", "tipo", "dia", "hora", "consultorio"]);
  });

  it("refuses field by field, with each limit at n−1, n and n+1", () => {
    for (const [field, max] of Object.entries(CONFIRM_MAIL_LIMITS) as [keyof typeof ok, number][]) {
      expect(confirmMailProblem({ ...ok, [field]: "a".repeat(max - 1) }), field).toBeNull();
      expect(confirmMailProblem({ ...ok, [field]: "a".repeat(max) }), field).toBeNull();
      expect(confirmMailProblem({ ...ok, [field]: "a".repeat(max + 1) }), field).toEqual({ field, problem: "long" });
      expect(confirmMailProblem({ ...ok, [field]: " \n " }), field).toEqual({ field, problem: "empty" });
    }
    expect(confirmMailProblem({ ...ok, subject: "Oi\n{nome}" })).toEqual({ field: "subject", problem: "line" });
    expect(confirmMailProblem({ ...ok, button: "Vou\nsim" })).toEqual({ field: "button", problem: "line" });
    expect(confirmMailProblem({ ...ok, subject: "Oi {local} {prazo}" })).toEqual({ field: "subject", problem: "unknown", vars: ["local", "prazo"] });
    expect(confirmMailProblem({ ...ok, body: "Oi {nome} {data}" })).toEqual({ field: "body", problem: "unknown", vars: ["data"] });
    expect(confirmMailProblem({ ...ok, body: "Toque: {link}" })).toEqual({ field: "body", problem: "link" });
    expect(confirmMailProblem({ ...ok, button: "{nome}" })).toEqual({ field: "button", problem: "unknown", vars: ["nome"] });
    // Characters, not UTF-16 units.
    expect(confirmMailProblem({ ...ok, button: "😀".repeat(CONFIRM_MAIL_LIMITS.button) })).toBeNull();
  });

  it("SEC-E7c2: refuses an address or a phone typed by hand and invisible characters in any field", () => {
    for (const field of ["subject", "body", "button"] as const) {
      expect(confirmMailProblem({ ...ok, [field]: "pix.exemplo.com" }), field).toEqual({ field, problem: "address" });
      expect(confirmMailProblem({ ...ok, [field]: "41 98888-7777" }), field).toEqual({ field, problem: "address" });
      expect(confirmMailProblem({ ...ok, [field]: "Oi‮" }), field).toEqual({ field, problem: "control" });
      expect(confirmMailProblem({ ...ok, [field]: "Oi\u0000" }), field).toEqual({ field, problem: "control" });
      // SEC-E7c2-03: a zero-width space or a soft hyphen hides "golpe.com" from the address rule.
      expect(confirmMailProblem({ ...ok, [field]: "golpe.\u200bcom" }), field).toEqual({ field, problem: "control" });
      expect(confirmMailProblem({ ...ok, [field]: "golpe.\u00adcom" }), field).toEqual({ field, problem: "control" });
      expect(confirmMessageProblem("Oi {nome}, golpe.\u2060com {link}")).toEqual({ problem: "control" });
      // The emoji joiner stays: a family emoji is text.
      expect(confirmMailProblem({ ...ok, [field]: "Oi \u{1f468}\u200d\u{1f469}" }), field).toBeNull();
    }
    expect(settingsUpdateSchema.safeParse({ confirmMail: { ...ok, body: "Veja www.exemplo" } }).success).toBe(false);
    expect(settingsUpdateSchema.safeParse({ confirmMail: { ...ok, other: "" } }).success).toBe(false);
    expect(confirmMailSchema.parse({ ...ok, body: "a\r\nb" })).toEqual({ ...ok, body: "a\nb" });
  });

  it("keeps its address rule the same as the WhatsApp message's (they are written apart, for the screen's download)", () => {
    for (const text of ["Consulta", "pix.exemplo.com", "https://x", "www.y", "consulta. Até", "sala 1234567", "41988887777", "(41) 9888-7777", "Dra. Ana", "e-mail.com.br"]) {
      expect(confirmMailProblem({ ...ok, button: text })?.problem === "address", text).toBe(!confirmValueOk(text));
    }
    expect(fillConfirmMail("{nome} {link} {outra}", { nome: "Ana", link: "" })).toBe("Ana  {outra}");
  });

  it("escapes every character that opens markup or an attribute", () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&</a>`)).toBe("&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;");
  });
});
