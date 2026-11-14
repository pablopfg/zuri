import type { SmtpConnect, SmtpSocket } from "./smtp.ts";

/**
 * An SMTP server in memory (E6c): local development, the e2e tests and the screenshots never reach a
 * real one, and the unit tests drive the client against it. On `*.exemplo.com.br`:
 * - `smtp.` takes 465 (TLS from the start) and 587 (STARTTLS), AUTH PLAIN and LOGIN;
 * - `sem-tls.` offers no STARTTLS on 587;
 * - `fora.` doesn't answer (the connection fails).
 * The password `senha-recusada-exemplo` is refused (535). Every other address goes to the real network.
 */

export interface FakeSmtpOptions {
  starttls?: boolean;
  auth?: string[];
  /** Refuses this password. */
  refuse?: string;
  /** Never answers the greeting (the client's timeout). */
  silent?: boolean;
  /** Answers the greeting with this many bytes of junk instead. */
  flood?: number;
  /** Answers the greeting with this many lines in one reply (the last one ends it). */
  floodLines?: number;
  /** Fails to open. */
  down?: boolean;
  /** The STARTTLS command is answered 454 (TLS not available). */
  tlsRefused?: boolean;
}

export interface FakeSmtpLog {
  /** Every line the client sent, with the TLS state it was sent in. */
  lines: { text: string; tls: boolean }[];
  /** The messages accepted (what came after DATA). */
  messages: { from: string; to: string; data: string }[];
  connects: { hostname: string; port: number; secureTransport: string }[];
}

export function fakeSmtp(options: FakeSmtpOptions = {}, log: FakeSmtpLog = { lines: [], messages: [], connects: [] }): { connect: SmtpConnect; log: FakeSmtpLog } {
  const auth = options.auth ?? ["PLAIN", "LOGIN"];
  const connect: SmtpConnect = (address, opts) => {
    log.connects.push({ ...address, secureTransport: opts.secureTransport });
    let tls = opts.secureTransport === "on";
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const make = (): SmtpSocket => {
      let push: ReadableStreamDefaultController<Uint8Array> | null = null;
      const readable = new ReadableStream<Uint8Array>({
        start(controller) {
          push = controller;
        },
      });
      const say = (text: string) => push?.enqueue(encoder.encode(text));
      let buffer = "";
      let state: "command" | "data" | "login-user" | "login-pass" = "command";
      let from = "";
      let to = "";
      let data = "";
      let user = "";
      let upgraded: SmtpSocket | null = null;
      const writable = new WritableStream<Uint8Array>({
        write(chunk) {
          buffer += decoder.decode(chunk, { stream: true });
          for (;;) {
            const end = buffer.indexOf("\r\n");
            if (end < 0) return;
            const line = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            log.lines.push({ text: line, tls });
            if (state === "data") {
              if (line === ".") {
                log.messages.push({ from, to, data });
                state = "command";
                say("250 2.0.0 queued\r\n");
              } else data += `${line}\r\n`;
              continue;
            }
            if (state === "login-user") {
              user = atob(line);
              state = "login-pass";
              say("334 UGFzc3dvcmQ6\r\n");
              continue;
            }
            if (state === "login-pass") {
              state = "command";
              say(atob(line) === options.refuse || !user ? "535 5.7.8 bad\r\n" : "235 2.7.0 ok\r\n");
              continue;
            }
            const verb = line.split(" ")[0]?.toUpperCase() ?? "";
            if (verb === "EHLO") {
              const ext = [...(!tls && options.starttls !== false ? ["STARTTLS"] : []), ...(tls || address.port === 465 ? [`AUTH ${auth.join(" ")}`] : [])];
              say(["250-smtp.exemplo.com.br", ...ext.map((item) => `250-${item}`), "250 8BITMIME"].join("\r\n").concat("\r\n"));
            } else if (verb === "STARTTLS") {
              if (options.tlsRefused) say("454 4.7.0 TLS not available\r\n");
              else {
                say("220 2.0.0 ready\r\n");
                tls = true;
              }
            } else if (verb === "AUTH") {
              const [, mech, value] = line.split(" ");
              if (mech === "PLAIN" && value) {
                const [, , password] = atob(value).split("\0");
                say(password === options.refuse ? "535 5.7.8 bad\r\n" : "235 2.7.0 ok\r\n");
              } else if (mech === "LOGIN") {
                state = "login-user";
                say("334 VXNlcm5hbWU6\r\n");
              } else say("504 5.5.4 unknown\r\n");
            } else if (verb === "MAIL") {
              from = /<([^>]*)>/.exec(line)?.[1] ?? "";
              say("250 2.1.0 ok\r\n");
            } else if (verb === "RCPT") {
              to = /<([^>]*)>/.exec(line)?.[1] ?? "";
              say("250 2.1.5 ok\r\n");
            } else if (verb === "DATA") {
              state = "data";
              data = "";
              say("354 go ahead\r\n");
            } else if (verb === "QUIT") {
              say("221 2.0.0 bye\r\n");
            } else say("502 5.5.2 unknown\r\n");
          }
        },
      });
      const socket: SmtpSocket = {
        readable,
        writable,
        opened: options.down ? Promise.reject(new Error("down")) : Promise.resolve({}),
        startTls() {
          upgraded = make();
          return upgraded;
        },
        close: async () => {
          try {
            push?.close();
          } catch {
            // already closed
          }
        },
      };
      socket.opened.catch(() => undefined);
      if (!options.down && !options.silent && !upgraded) {
        if (options.flood) say("x".repeat(options.flood));
        else if (options.floodLines) say(`${"220-smtp.exemplo.com.br\r\n".repeat(options.floodLines - 1)}220 smtp.exemplo.com.br ESMTP\r\n`);
        else if (!(tls && opts.secureTransport === "starttls")) say("220 smtp.exemplo.com.br ESMTP\r\n");
      }
      return socket;
    };
    return make();
  };
  return { connect, log };
}

const SIMULATED = /\.exemplo\.com\.br$/;

/** Local development: the example servers answer here; any other goes out as in production. */
export function developmentSmtp(real: SmtpConnect): SmtpConnect {
  const servers: Record<string, SmtpConnect> = {
    "smtp.exemplo.com.br": fakeSmtp({ refuse: "senha-recusada-exemplo" }).connect,
    "sem-tls.exemplo.com.br": fakeSmtp({ starttls: false }).connect,
    "fora.exemplo.com.br": fakeSmtp({ down: true }).connect,
  };
  return (address, options) => {
    if (!SIMULATED.test(address.hostname)) return real(address, options);
    return (servers[address.hostname] ?? servers["smtp.exemplo.com.br"] ?? real)(address, options);
  };
}
