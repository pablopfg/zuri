import type { MailProblem, SmtpPort } from "@zuri/shared";

/**
 * A small SMTP client (E6c) over the Workers' TCP sockets: 465 is TLS from the first byte, 587 goes on
 * only after STARTTLS is accepted. The user and the password never leave before TLS. Only the reply
 * codes are read; the server's words never reach the screen.
 */

/** What `connect()` of `cloudflare:sockets` gives, as far as this client uses it. */
export interface SmtpSocket {
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<Uint8Array>;
  readonly opened: Promise<unknown>;
  startTls(): SmtpSocket;
  close(): Promise<void>;
}

export type SmtpConnect = (address: { hostname: string; port: number }, options: { secureTransport: "on" | "starttls"; allowHalfOpen: boolean }) => SmtpSocket;

export interface SmtpJob {
  host: string;
  port: SmtpPort;
  user: string;
  password: string;
  /** The envelope's sender and recipient. */
  from: string;
  to: string;
  /** The message, already built (buildMessage). */
  data: string;
}

export const SMTP_LIMITS = { timeoutMs: 15_000, replyBytes: 8 * 1024, replyLines: 100 } as const;

export class SmtpError extends Error {
  constructor(readonly problem: MailProblem) {
    super(problem);
  }
}

class Conversation {
  #reader: ReadableStreamDefaultReader<Uint8Array>;
  #writer: WritableStreamDefaultWriter<Uint8Array>;
  #buffer = "";
  readonly #decoder = new TextDecoder();
  readonly #encoder = new TextEncoder();

  constructor(
    public socket: SmtpSocket,
    private readonly deadline: Promise<never>,
  ) {
    this.#reader = socket.readable.getReader();
    this.#writer = socket.writable.getWriter();
  }

  /** One reply (all its lines): its code and the words of its lines after the code. */
  async reply(): Promise<{ code: number; lines: string[] }> {
    const lines: string[] = [];
    // The whole reply, all its lines, is held to the cap: a server that never ends one is refused.
    let size = 0;
    for (;;) {
      const end = this.#buffer.indexOf("\r\n");
      if (end >= 0) {
        const line = this.#buffer.slice(0, end);
        this.#buffer = this.#buffer.slice(end + 2);
        size += end + 2;
        if (size > SMTP_LIMITS.replyBytes || lines.length >= SMTP_LIMITS.replyLines) throw new SmtpError("refused");
        if (!/^\d{3}([ -]|$)/.test(line)) throw new SmtpError("refused");
        lines.push(line.slice(4));
        if (line[3] !== "-") return { code: Number(line.slice(0, 3)), lines };
        continue;
      }
      if (size + this.#buffer.length > SMTP_LIMITS.replyBytes) throw new SmtpError("refused");
      const chunk = await Promise.race([this.#reader.read(), this.deadline]);
      if (chunk.done) throw new SmtpError("unreachable");
      this.#buffer += this.#decoder.decode(chunk.value, { stream: true });
    }
  }

  async send(line: string): Promise<void> {
    await Promise.race([this.#writer.write(this.#encoder.encode(line)), this.deadline]);
  }

  async command(line: string, ok: (code: number) => boolean, problem: MailProblem): Promise<{ code: number; lines: string[] }> {
    await this.send(`${line}\r\n`);
    const answer = await this.reply();
    if (!ok(answer.code)) throw new SmtpError(problem);
    return answer;
  }

  /** After STARTTLS: the same conversation over the TLS socket. */
  upgrade(): void {
    this.#reader.releaseLock();
    this.#writer.releaseLock();
    this.socket = this.socket.startTls();
    this.#reader = this.socket.readable.getReader();
    this.#writer = this.socket.writable.getWriter();
    this.#buffer = "";
  }
}

const b64 = (text: string) => {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const is2xx = (code: number) => code >= 200 && code < 300;

/** The extensions the server named after EHLO, in upper case. */
const extensions = (lines: string[]) => lines.slice(1).map((line) => line.trim().toUpperCase());

export async function smtpSend(connect: SmtpConnect, job: SmtpJob, timeoutMs: number = SMTP_LIMITS.timeoutMs): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new SmtpError("timeout")), timeoutMs);
  });
  deadline.catch(() => undefined);
  let socket: SmtpSocket;
  try {
    socket = connect({ hostname: job.host, port: job.port }, { secureTransport: job.port === 465 ? "on" : "starttls", allowHalfOpen: false });
  } catch {
    clearTimeout(timer);
    throw new SmtpError("unreachable");
  }
  const talk = new Conversation(socket, deadline);
  try {
    try {
      await Promise.race([socket.opened, deadline]);
    } catch (error) {
      throw error instanceof SmtpError ? error : new SmtpError("unreachable");
    }
    if ((await talk.reply()).code !== 220) throw new SmtpError("refused");
    let hello = await talk.command("EHLO zuri", is2xx, "refused");
    if (job.port === 587) {
      // No STARTTLS offered, or refused: stop here, before any user or password goes in clear.
      if (!extensions(hello.lines).some((line) => line === "STARTTLS")) throw new SmtpError("no_tls");
      await talk.command("STARTTLS", (code) => code === 220, "no_tls");
      try {
        talk.upgrade();
        await Promise.race([talk.socket.opened, deadline]);
      } catch (error) {
        throw error instanceof SmtpError ? error : new SmtpError("no_tls");
      }
      hello = await talk.command("EHLO zuri", is2xx, "refused");
    }
    const auth = extensions(hello.lines).find((line) => line.startsWith("AUTH ") || line.startsWith("AUTH="))?.split(/[ =]/) ?? [];
    if (auth.includes("PLAIN")) {
      await talk.command(`AUTH PLAIN ${b64(`\0${job.user}\0${job.password}`)}`, (code) => code === 235, "auth");
    } else if (auth.includes("LOGIN")) {
      await talk.command("AUTH LOGIN", (code) => code === 334, "auth");
      await talk.command(b64(job.user), (code) => code === 334, "auth");
      await talk.command(b64(job.password), (code) => code === 235, "auth");
    } else {
      throw new SmtpError("auth");
    }
    await talk.command(`MAIL FROM:<${job.from}>`, is2xx, "refused");
    await talk.command(`RCPT TO:<${job.to}>`, is2xx, "refused");
    await talk.command("DATA", (code) => code === 354, "refused");
    // The body is base64 (no line starts with a dot), so no dot-stuffing is needed.
    await talk.command(`${job.data.replace(/\r\n$/, "")}\r\n.`, is2xx, "refused");
    await talk.send("QUIT\r\n").catch(() => undefined);
  } catch (error) {
    throw error instanceof SmtpError ? error : new SmtpError("unreachable");
  } finally {
    clearTimeout(timer);
    await talk.socket.close().catch(() => undefined);
  }
}
