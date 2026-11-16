import { describe, expect, it } from "vitest";
import { fakeSmtp } from "../src/mail/dev-mail.ts";
import { base64Url, buildMessage, encodeWords } from "../src/mail/message.ts";
import { type SmtpJob, smtpSend } from "../src/mail/smtp.ts";

// E6c (plano email-para-pacientes.md): the message as RFC 5322 text and the SMTP client against a
// server in memory. The user and the password never leave before TLS.

const job = (patch: Partial<SmtpJob> = {}): SmtpJob => ({
  host: "smtp.exemplo.com.br",
  port: 465,
  user: "contato@exemplo.com.br",
  password: "senha-de-app-exemplo",
  from: "contato@exemplo.com.br",
  to: "dono@exemplo.com.br",
  data: buildMessage({ fromName: "Consultório", from: "contato@exemplo.com.br", to: "dono@exemplo.com.br", subject: "Teste", text: "Olá", at: Date.UTC(2026, 10, 14, 12), id: "id-1" }),
  ...patch,
});

const decode = (data: string) => {
  const body = data.split("\r\n\r\n")[1]?.replace(/\r\n/g, "") ?? "";
  return new TextDecoder().decode(Uint8Array.from(atob(body), (ch) => ch.charCodeAt(0)));
};

describe("the message", () => {
  it("E7c2: with HTML, goes as multipart/alternative, the text first and both in base64", () => {
    const data = buildMessage({ fromName: "Consultório", from: "contato@exemplo.com.br", to: "paciente@exemplo.com.br", subject: "Confirme", text: "Olá\nConfirmar: https://zuri.exemplo.com.br/c/x", html: "<p>Olá</p>", at: Date.UTC(2026, 10, 14, 12), id: "id-2" });
    const [head = "", ...rest] = data.split("\r\n\r\n");
    expect(head).toContain('Content-Type: multipart/alternative; boundary="zuri-id2"');
    expect(head).not.toContain("Content-Type: text/plain");
    const body = rest.join("\r\n\r\n");
    const parts = body.split("--zuri-id2").slice(1);
    expect(parts).toHaveLength(3);
    expect(parts[2]).toBe("--\r\n");
    const decoded = parts.slice(0, 2).map((part) => {
      const [headers = "", content = ""] = part.split("\r\n\r\n");
      return [headers.trim(), new TextDecoder().decode(Uint8Array.from(atob(content.replace(/\r\n/g, "")), (ch) => ch.charCodeAt(0)))];
    });
    expect(decoded).toEqual([
      ["Content-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64", "Olá\r\nConfirmar: https://zuri.exemplo.com.br/c/x"],
      ["Content-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64", "<p>Olá</p>"],
    ]);
  });

  it("encodes every typed header and keeps a line break out of them", () => {
    const data = buildMessage({
      fromName: "Consultório \"Ana\"\r\nBcc: outro@exemplo.com.br",
      from: "contato@exemplo.com.br",
      to: "dono@exemplo.com.br",
      replyTo: "equipe@exemplo.com.br",
      subject: "Confirme sua consulta\r\nBcc: x@exemplo.com.br",
      text: "Linha 1\nLinha 2 com acento: ção",
      at: Date.UTC(2026, 10, 14, 12),
      id: "abc",
    });
    const [head = ""] = data.split("\r\n\r\n");
    // No header was added by what was typed.
    expect(head.split("\r\n").filter((line) => /^Bcc:/i.test(line))).toEqual([]);
    expect(head).toContain("Reply-To: <equipe@exemplo.com.br>");
    expect(head).toContain("Message-ID: <abc@exemplo.com.br>");
    expect(head).toContain("Date: Sat, 14 Nov 2026 12:00:00 +0000");
    expect(head).toContain("Content-Transfer-Encoding: base64");
    expect(decode(data)).toBe("Linha 1\r\nLinha 2 com acento: ção");
    // Every line of the message stays under 998 characters (the body's at 76).
    expect(data.split("\r\n").every((line) => line.length <= 998)).toBe(true);
  });

  it("never lets an address that isn't plain into a header (SEC-E6c-03)", () => {
    const base = { fromName: "", from: "contato@exemplo.com.br", to: "dono@exemplo.com.br", subject: "s", text: "t", at: 0, id: "x" };
    for (const bad of [{ to: "p@exemplo.com.br>\r\nBcc: <alvo@exemplo.com.br" }, { replyTo: "a@exemplo.com.br\nX-Inj: 1" }, { from: "a@exemplo.com.br>" }]) {
      expect(() => buildMessage({ ...base, ...bad }), JSON.stringify(bad)).toThrow();
    }
  });

  it("writes plain ASCII as it is and anything else as encoded words that never split a character", () => {
    expect(encodeWords("Teste da Zuri")).toBe("Teste da Zuri");
    const word = encodeWords("Olá 😀".repeat(10));
    const parts = word.split("\r\n ").map((part) => /^=\?UTF-8\?B\?([^?]+)\?=$/.exec(part)?.[1] ?? "");
    expect(parts.every((part) => part.length > 0)).toBe(true);
    const text = parts.map((part) => new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(Uint8Array.from(atob(part), (ch) => ch.charCodeAt(0)))).join("");
    expect(text).toBe("Olá 😀".repeat(10));
    expect(word.split("\r\n").every((line) => line.length <= 76)).toBe(true);
    // "=?" typed by someone is encoded too, so it can't be read as a word.
    expect(encodeWords("=?UTF-8?B?QQ==?=")).toMatch(/^=\?UTF-8\?B\?/);
    expect(base64Url("ação?>")).not.toMatch(/[+/=]/);
  });
});

describe("the SMTP client", () => {
  it("on 465 talks TLS from the start, logs in with PLAIN and hands the message over", async () => {
    const server = fakeSmtp();
    await smtpSend(server.connect, job());
    expect(server.log.connects).toEqual([{ hostname: "smtp.exemplo.com.br", port: 465, secureTransport: "on" }]);
    expect(server.log.lines.map((line) => line.text.split(" ")[0])).toEqual(["EHLO", "AUTH", "MAIL", "RCPT", "DATA", ...Array(job().data.split("\r\n").length - 1).fill(expect.any(String)), ".", "QUIT"]);
    expect(server.log.lines.every((line) => line.tls)).toBe(true);
    expect(server.log.messages).toHaveLength(1);
    expect(server.log.messages[0]).toMatchObject({ from: "contato@exemplo.com.br", to: "dono@exemplo.com.br" });
  });

  it("on 587 sends the user and the password only after STARTTLS was accepted", async () => {
    const server = fakeSmtp({ auth: ["LOGIN"] });
    await smtpSend(server.connect, job({ port: 587 }));
    expect(server.log.connects[0]?.secureTransport).toBe("starttls");
    const before = server.log.lines.filter((line) => !line.tls).map((line) => line.text);
    expect(before).toEqual(["EHLO zuri", "STARTTLS"]);
    const password = btoa("senha-de-app-exemplo");
    expect(server.log.lines.find((line) => line.text === password)?.tls).toBe(true);
    expect(server.log.messages).toHaveLength(1);
  });

  it("stops before any password when 587 offers no STARTTLS or refuses it", async () => {
    for (const options of [{ starttls: false }, { tlsRefused: true }]) {
      const server = fakeSmtp(options);
      await expect(smtpSend(server.connect, job({ port: 587 }))).rejects.toMatchObject({ problem: "no_tls" });
      expect(server.log.lines.some((line) => line.text.startsWith("AUTH") || line.text.includes(btoa("senha-de-app-exemplo")))).toBe(false);
      expect(server.log.messages).toHaveLength(0);
    }
  });

  it("tells a refused password, a server without AUTH, a server down, a silent one and a flood", async () => {
    await expect(smtpSend(fakeSmtp({ refuse: "senha-de-app-exemplo" }).connect, job())).rejects.toMatchObject({ problem: "auth" });
    await expect(smtpSend(fakeSmtp({ refuse: "senha-de-app-exemplo", auth: ["LOGIN"] }).connect, job())).rejects.toMatchObject({ problem: "auth" });
    await expect(smtpSend(fakeSmtp({ auth: ["CRAM-MD5"] }).connect, job())).rejects.toMatchObject({ problem: "auth" });
    await expect(smtpSend(fakeSmtp({ down: true }).connect, job())).rejects.toMatchObject({ problem: "unreachable" });
    await expect(smtpSend(fakeSmtp({ silent: true }).connect, job(), 50)).rejects.toMatchObject({ problem: "timeout" });
    await expect(smtpSend(fakeSmtp({ flood: 9_000 }).connect, job())).rejects.toMatchObject({ problem: "refused" });
    // A reply of many short lines is held to the same 8 KB and 100 lines as a whole (SEC-E6c-02).
    await expect(smtpSend(fakeSmtp({ floodLines: 20_000 }).connect, job())).rejects.toMatchObject({ problem: "refused" });
    await expect(smtpSend(fakeSmtp({ floodLines: 101 }).connect, job())).rejects.toMatchObject({ problem: "refused" });
    await smtpSend(fakeSmtp({ floodLines: 99 }).connect, job());
    await expect(
      smtpSend(
        () => {
          throw new Error("no sockets");
        },
        job(),
      ),
    ).rejects.toMatchObject({ problem: "unreachable" });
  });
});
