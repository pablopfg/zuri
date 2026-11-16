import { describe, expect, it } from "vitest";
import { MAIL_LIMITS, mailAddressSchema, mailNameSchema, mailSaveSchema, smtpHostSchema, smtpPasswordSchema } from "../src/index.ts";

// E6c (plano email-para-pacientes.md): what "Salvar o e-mail" accepts. Nothing typed can add a
// header, and the server's name is never an IP or a local name.

const ok = (schema: { safeParse(v: unknown): { success: boolean } }, value: unknown) => schema.safeParse(value).success;
const SMTP = { host: "smtp.exemplo.com.br", port: 465, user: "contato@exemplo.com.br", from: "" };

describe("mail schemas", () => {
  it("addresses: trimmed and lower-cased, the length at n−1, n and n+1, and nothing that splits a header", () => {
    expect(mailAddressSchema.parse("  Contato@Exemplo.com.BR ")).toBe("contato@exemplo.com.br");
    const at = (length: number) => `${"a".repeat(length - "@exemplo.com.br".length)}@exemplo.com.br`;
    // The local part is at most 64: build a long address from a long domain.
    const long = (length: number) => `contato@${"b".repeat(50)}.${"c".repeat(length - "contato@".length - 51 - ".com.br".length)}.com.br`;
    expect(ok(mailAddressSchema, at(60))).toBe(true);
    expect(ok(mailAddressSchema, long(MAIL_LIMITS.address - 1))).toBe(true);
    expect(ok(mailAddressSchema, long(MAIL_LIMITS.address))).toBe(true);
    expect(ok(mailAddressSchema, long(MAIL_LIMITS.address + 1))).toBe(false);
    expect(ok(mailAddressSchema, `${"a".repeat(64)}@exemplo.com.br`)).toBe(true);
    expect(ok(mailAddressSchema, `${"a".repeat(65)}@exemplo.com.br`)).toBe(false);
    for (const bad of ["x@exemplo.com.br\r\nBcc: y@exemplo.com.br", "a b@exemplo.com.br", "<a>@exemplo.com.br", "a@b@exemplo.com.br", "a@exemplo", "a,b@exemplo.com.br", "a​@exemplo.com.br", "a@exemplo.com.br>", ""]) {
      expect(ok(mailAddressSchema, bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it("server names: a public name only", () => {
    expect(smtpHostSchema.parse(" SMTP.Exemplo.com.br. ")).toBe("smtp.exemplo.com.br");
    for (const bad of ["192.168.0.1", "8.8.8.8", "localhost", "smtp.local", "mail.internal", "smtp", "-smtp.exemplo.com.br", "smtp.exemplo.com.br:25", "smtp_x.exemplo.com.br", "[::1]", `${"a".repeat(60)}.${"b".repeat(56)}.com`, `${"a".repeat(64)}.com`, "smtp..exemplo.com.br", "smtp.exemplo.c0m"]) {
      expect(ok(smtpHostSchema, bad), bad).toBe(false);
    }
    // 120 characters, labels up to 63 (DNS): n−1 and n go, n+1 above doesn't.
    expect(ok(smtpHostSchema, `${"a".repeat(60)}.${"b".repeat(54)}.com`)).toBe(true);
    expect(ok(smtpHostSchema, `${"a".repeat(60)}.${"b".repeat(55)}.com`)).toBe(true);
    expect(ok(smtpHostSchema, `${"a".repeat(63)}.com`)).toBe(true);
    // A long hostile name is answered at once (no nested pattern to backtrack).
    const started = performance.now();
    expect(ok(smtpHostSchema, `${"a-".repeat(119)}!`)).toBe(false);
    expect(ok(mailAddressSchema, `a@${"a-".repeat(59)}!`)).toBe(false);
    expect(performance.now() - started).toBeLessThan(50);
  });

  it("the sender's name: one line, at most 60 characters, emoji counted as one", () => {
    expect(mailNameSchema.parse("  Consultório   Exemplo ")).toBe("Consultório Exemplo");
    expect(ok(mailNameSchema, "😀".repeat(MAIL_LIMITS.name))).toBe(true);
    expect(ok(mailNameSchema, "a".repeat(MAIL_LIMITS.name - 1))).toBe(true);
    expect(ok(mailNameSchema, "a".repeat(MAIL_LIMITS.name + 1))).toBe(false);
    for (const bad of ["Ana\r\nBcc: x@exemplo.com.br", "Ana <x@exemplo.com.br>", 'Ana "x"', "Ana x", "Ana\\x"]) expect(ok(mailNameSchema, bad), bad).toBe(false);
  });

  it("the password: printable ASCII, 1 to 200", () => {
    expect(ok(smtpPasswordSchema, "a".repeat(MAIL_LIMITS.password))).toBe(true);
    expect(ok(smtpPasswordSchema, "a".repeat(MAIL_LIMITS.password + 1))).toBe(false);
    for (const bad of ["", "senha\r\n", "senhaç", "senha\u0000"]) expect(ok(smtpPasswordSchema, bad), JSON.stringify(bad)).toBe(false);
  });

  it("the save: SMTP needs the server, only 465 and 587, and no unknown field", () => {
    expect(ok(mailSaveSchema, { mode: "off", name: "", replyTo: "" })).toBe(true);
    expect(ok(mailSaveSchema, { mode: "gmail", name: "", replyTo: "equipe@exemplo.com.br" })).toBe(true);
    expect(ok(mailSaveSchema, { mode: "smtp", name: "", replyTo: "" })).toBe(false);
    expect(ok(mailSaveSchema, { mode: "smtp", name: "", replyTo: "", smtp: SMTP })).toBe(true);
    expect(ok(mailSaveSchema, { mode: "smtp", name: "", replyTo: "", smtp: { ...SMTP, port: 587 } })).toBe(true);
    for (const port of [25, 2525, "465", 0]) expect(ok(mailSaveSchema, { mode: "smtp", name: "", replyTo: "", smtp: { ...SMTP, port } })).toBe(false);
    expect(ok(mailSaveSchema, { mode: "off", name: "", replyTo: "", extra: 1 })).toBe(false);
    expect(ok(mailSaveSchema, { mode: "smtp", name: "", replyTo: "", smtp: { ...SMTP, credential: "x" } })).toBe(false);
    expect(ok(mailSaveSchema, { mode: "webhook", name: "", replyTo: "" })).toBe(false);
  });
});
