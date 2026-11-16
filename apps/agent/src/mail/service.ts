import { GMAIL_SEND_SCOPE, isMailAddress, MAIL_LIMITS, type MailMode, type MailProblem, type MailStatus, type MailTest, mailSaveSchema, type SmtpPort } from "@zuri/shared";
import { recordActivity } from "../db/activity.ts";
import type { Database } from "../db/database.ts";
import { AppError } from "../http/errors.ts";
import { GoogleError, GoogleMeter } from "../google/service.ts";
import { McpCredentials } from "../mcp/credentials.ts";
import { assertPublicHost, type Resolver } from "../mcp/url.ts";
import { parse } from "../productivity/validate.ts";
import { localToday } from "../google/events.ts";
import { base64Url, buildMessage } from "./message.ts";
import { type SmtpConnect, SmtpError, smtpSend } from "./smtp.ts";

/**
 * E-mail to patients (E6c, docs/planos/email-para-pacientes.md): how it goes out, the test, and the
 * daily cap. `send` is what the confirmation (E7) calls; nothing else sends.
 */

interface MailRow {
  mode: string;
  name: string;
  reply_to: string;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_user: string | null;
  smtp_from: string;
  credential: string | null;
  key_end: string | null;
  sent_day: string | null;
  sent_count: number;
  test_day: string | null;
  test_count: number;
  test_times: string;
  updated_at: string;
}

export interface MailGoogle {
  connected(): boolean;
  granted(scope: string): boolean;
  accountEmail(): string | null;
  gmailSend(raw: string, meter: GoogleMeter): Promise<string | null>;
}

export interface MailDeps {
  db: Database;
  credentialKey: string | undefined;
  google: () => MailGoogle;
  ownerEmail: () => string;
  timeZone: () => string;
  /** The office's name: the sender's name when none is typed. */
  clinicName: () => string;
  development: () => boolean;
  /** Nothing goes out during a lockdown (/bloquear). */
  lockdown: () => boolean;
  clock?: () => number;
}

export interface MailNetwork {
  connect: SmtpConnect;
  resolve: Resolver;
}

/** The password opens only for the server and the user it was saved with. */
const sealId = (host: string, user: string) => `smtp:${host}:${user}`;

/** The end of a password only when it is long enough not to give it away. */
const keyEnd = (password: string) => (password.length >= 12 ? password.slice(-4) : null);

const isMode = (value: string): value is MailMode => value === "off" || value === "gmail" || value === "smtp";

export class MailService {
  readonly #vault: McpCredentials;

  constructor(
    private readonly deps: MailDeps,
    public network: MailNetwork,
  ) {
    this.#vault = new McpCredentials(deps.credentialKey, "smtp-v1");
  }

  private now(): number {
    return this.deps.clock?.() ?? Date.now();
  }

  private row(): MailRow | null {
    return this.deps.db.one<MailRow>(`SELECT * FROM zur_mail WHERE id = 1`) ?? null;
  }

  private today(): string {
    return localToday(this.deps.timeZone(), new Date(this.now()));
  }

  status(): MailStatus {
    const row = this.row();
    const google = this.deps.google();
    const connected = google.connected();
    return {
      mode: row && isMode(row.mode) ? row.mode : "off",
      name: row?.name ?? "",
      replyTo: row?.reply_to ?? "",
      gmail: { account: connected ? google.accountEmail() : null, granted: connected && google.granted(GMAIL_SEND_SCOPE), connected },
      smtp:
        row?.smtp_host && row.smtp_user && (row.smtp_port === 465 || row.smtp_port === 587)
          ? { host: row.smtp_host, port: row.smtp_port, user: row.smtp_user, from: row.smtp_from, hasPassword: row.credential !== null, passwordEnd: row.key_end }
          : null,
      testTo: this.deps.ownerEmail(),
      sentToday: row?.sent_day === this.today() ? row.sent_count : 0,
      perDay: MAIL_LIMITS.perDay,
      vault: this.#vault.available,
    };
  }

  /**
   * "Salvar o e-mail". A new server or user needs the password again (it belongs to them); the
   * answer says whether the change touched where e-mail goes (the route raises a security notice).
   */
  async save(input: unknown, opts: { development: boolean }): Promise<{ sensitive: boolean }> {
    const data = parse(mailSaveSchema, input);
    const before = this.row();
    const at = new Date(this.now()).toISOString();
    let host = before?.smtp_host ?? null;
    let port = before?.smtp_port ?? null;
    let user = before?.smtp_user ?? null;
    let from = before?.smtp_from ?? "";
    let credential = before?.credential ?? null;
    let end = before?.key_end ?? null;
    if (data.smtp) {
      const moved = data.smtp.host !== host || data.smtp.user !== user;
      if (moved && data.smtp.password === undefined) throw new AppError("VALIDATION_FAILED", "error.mailPasswordAgain", { fields: ["smtp.password"] });
      if (data.smtp.password !== undefined && !this.#vault.available) throw new AppError("NOT_CONFIGURED", "error.flowCredentialKey");
      await this.checkHost(data.smtp.host, opts.development);
      host = data.smtp.host;
      port = data.smtp.port;
      user = data.smtp.user;
      from = data.smtp.from;
      if (data.smtp.password !== undefined) {
        credential = await this.#vault.encrypt(sealId(host, user), data.smtp.password);
        end = keyEnd(data.smtp.password);
      }
    }
    if (data.mode === "gmail") {
      const google = this.deps.google();
      if (!google.connected() || !google.granted(GMAIL_SEND_SCOPE)) throw new AppError("VALIDATION_FAILED", "error.googleGmailScope", { fields: ["mode"] });
    }
    const sensitive =
      data.mode !== (before?.mode ?? "off") ||
      // The name patients see: a change could pass for someone else.
      data.name !== (before?.name ?? "") ||
      data.replyTo !== (before?.reply_to ?? "") ||
      host !== (before?.smtp_host ?? null) ||
      user !== (before?.smtp_user ?? null) ||
      from !== (before?.smtp_from ?? "") ||
      port !== (before?.smtp_port ?? null) ||
      credential !== (before?.credential ?? null);
    const kept = before
      ? this.deps.db.run(
          `UPDATE zur_mail SET mode = ?, name = ?, reply_to = ?, smtp_host = ?, smtp_port = ?, smtp_user = ?, smtp_from = ?, credential = ?, key_end = ?, updated_at = ? WHERE id = 1 AND updated_at = ?`,
          data.mode,
          data.name,
          data.replyTo,
          host,
          port,
          user,
          from,
          credential,
          end,
          at === before.updated_at ? `${at}+` : at,
          before.updated_at,
        )
      : this.deps.db.run(
          `INSERT OR IGNORE INTO zur_mail (id, mode, name, reply_to, smtp_host, smtp_port, smtp_user, smtp_from, credential, key_end, updated_at) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          data.mode,
          data.name,
          data.replyTo,
          host,
          port,
          user,
          from,
          credential,
          end,
          at,
        );
    // Another save meanwhile (two tabs): this one is refused, nothing half-written.
    if (kept.rowsWritten === 0) throw new AppError("CONFLICT");
    recordActivity(this.deps.db, "mail.saved", { mode: data.mode, sensitive });
    return { sensitive };
  }

  /**
   * Right after the owner allows gmail.send on Google's page (asked from this section): with no way
   * out chosen yet, the Gmail becomes it. A way out already chosen stays (the owner changes it here).
   */
  useGmailIfNone(): void {
    const at = new Date(this.now()).toISOString();
    const row = this.row();
    if (row && row.mode !== "off") return;
    if (row) this.deps.db.run(`UPDATE zur_mail SET mode = 'gmail', updated_at = ? WHERE id = 1 AND mode = 'off'`, at);
    else this.deps.db.run(`INSERT OR IGNORE INTO zur_mail (id, mode, updated_at) VALUES (1, 'gmail', ?)`, at);
    recordActivity(this.deps.db, "mail.saved", { mode: "gmail", sensitive: true });
  }

  /** No IP, no local name, and a public answer from the DNS (as every credential of the flows). */
  private async checkHost(host: string, development: boolean): Promise<void> {
    try {
      await assertPublicHost(new URL(`https://${host}`), this.network.resolve, { development });
    } catch {
      throw new AppError("VALIDATION_FAILED", "error.mailHost", { fields: ["smtp.host"] });
    }
  }

  /**
   * "Enviar teste para você": a short e-mail to the owner, by the saved way out. 3 in 10 minutes and 10 a
   * day, kept in the row: a stolen session can't spend the patients' daily cap on tests.
   */
  async test(locale: { subject: string; text: string }): Promise<MailTest> {
    const now = this.now();
    const row = this.row();
    const today = this.today();
    const times = (row?.test_times ?? "")
      .split(",")
      .map(Number)
      .filter((at) => Number.isFinite(at) && at > 0 && now - at < MAIL_LIMITS.testWindowMs);
    if (times.length >= MAIL_LIMITS.tests) {
      const first = Math.min(...times);
      throw new AppError("RATE_LIMITED", "error.mailTestWait", { retryAfter: Math.max(1, Math.ceil((first + MAIL_LIMITS.testWindowMs - now) / 1000)) });
    }
    if (row?.test_day === today && row.test_count >= MAIL_LIMITS.testsPerDay) throw new AppError("RATE_LIMITED", "error.mailTestDay", { max: MAIL_LIMITS.testsPerDay });
    const to = this.deps.ownerEmail();
    // No owner's address (never the case after the first access) or no way out saved: nothing to test.
    if (!to || !row) return { ok: false, problem: "not_configured" };
    this.deps.db.run(
      `UPDATE zur_mail SET test_times = ?, test_day = ?, test_count = CASE WHEN test_day = ? THEN test_count + 1 ELSE 1 END WHERE id = 1`,
      [...times, now].join(","),
      today,
      today,
    );
    const sent = await this.send({ to, subject: locale.subject, text: locale.text });
    return sent.ok ? { ok: true, to, via: sent.via } : sent;
  }

  /**
   * One e-mail by the saved way out, inside the daily cap. Never throws for the way out: the answer
   * says why it didn't go, in a word the screen can explain.
   */
  async send(message: { to: string; subject: string; text: string; html?: string }): Promise<{ ok: true; via: "gmail" | "smtp" } | { ok: false; problem: MailProblem }> {
    const to = message.to.trim().toLowerCase();
    // A recipient that isn't a plain address (a line break, a second address) never reaches a header or a command.
    if (!isMailAddress(to)) return { ok: false, problem: "refused" };
    if (this.deps.lockdown()) return { ok: false, problem: "blocked" };
    const row = this.row();
    const mode = row && isMode(row.mode) ? row.mode : "off";
    if (!row || mode === "off") return { ok: false, problem: "not_configured" };
    const today = this.today();
    const count = row.sent_day === today ? row.sent_count : 0;
    if (count >= MAIL_LIMITS.perDay) return { ok: false, problem: "daily_limit" };
    const google = this.deps.google();
    const from = mode === "gmail" ? google.accountEmail() : row.smtp_from || row.smtp_user;
    if (!from) return { ok: false, problem: mode === "gmail" ? "gmail_scope" : "not_configured" };
    // What can be known without the server is checked before the count: nothing went out for these.
    let smtp: { host: string; port: SmtpPort; user: string; password: string } | null = null;
    if (mode === "smtp") {
      if (!row.smtp_host || !row.smtp_user || !row.credential || (row.smtp_port !== 465 && row.smtp_port !== 587)) return { ok: false, problem: "not_configured" };
      const password = await this.#vault.decrypt(sealId(row.smtp_host, row.smtp_user), row.credential);
      if (password === null) return { ok: false, problem: "password" };
      try {
        await this.checkHost(row.smtp_host, this.deps.development());
      } catch {
        return { ok: false, problem: "blocked" };
      }
      smtp = { host: row.smtp_host, port: row.smtp_port, user: row.smtp_user, password };
    }
    let data: string;
    try {
      data = buildMessage({
        fromName: row.name || this.deps.clinicName(),
        from,
        to,
        replyTo: row.reply_to || undefined,
        subject: message.subject,
        text: message.text,
        html: message.html,
        at: this.now(),
        id: crypto.randomUUID(),
      });
    } catch {
      return { ok: false, problem: "refused" };
    }
    // Counted before the attempt: a send that failed halfway may still have gone, and the cap is a ceiling.
    this.deps.db.run(
      `UPDATE zur_mail SET sent_day = ?, sent_count = CASE WHEN sent_day = ? THEN sent_count + 1 ELSE 1 END WHERE id = 1`,
      today,
      today,
    );
    try {
      if (mode === "gmail") {
        await google.gmailSend(base64Url(data), new GoogleMeter(2));
        return { ok: true, via: "gmail" };
      }
      if (!smtp) return { ok: false, problem: "not_configured" };
      await smtpSend(this.network.connect, { ...smtp, from, to, data });
      return { ok: true, via: "smtp" };
    } catch (error) {
      if (error instanceof SmtpError) return { ok: false, problem: error.problem };
      if (error instanceof GoogleError) return { ok: false, problem: error.kind === "gmail_scope" || error.kind === "scopes" ? "gmail_scope" : "google" };
      throw error;
    }
  }
}
