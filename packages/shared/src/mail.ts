// Before any schema here: the package is marked side-effect free, so index.ts alone can't order it.
import "./zod-config.ts";

import { z } from "zod";

/**
 * E-mail to patients (E6c, docs/planos/email-para-pacientes.md): one way out at a time, the owner's
 * Gmail (permission `gmail.send` on the Google connection) or another provider's SMTP. Only the
 * channel lives here; what goes out (the confirmation, E7) reads it.
 */
export const MAIL_LIMITS = { name: 60, address: 120, local: 64, host: 120, password: 200, perDay: 100, tests: 3, testWindowMs: 10 * 60_000, testsPerDay: 10 } as const;

/** Only to send: the Zuri never reads, deletes or sees the mailbox. */
export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";

export const MAIL_MODES = ["off", "gmail", "smtp"] as const;
export type MailMode = (typeof MAIL_MODES)[number];

export const SMTP_PORTS = [465, 587] as const;
export type SmtpPort = (typeof SMTP_PORTS)[number];

/** A domain's labels: letters, digits and hyphens, the last one letters only. Checked label by label, never by a nested pattern (ReDoS). */
const LABEL = /^[a-z0-9-]{1,63}$/i;
const TOP_LABEL = /^[a-z]{2,63}$/i;

/** A dotted name with a top-level domain, between 4 and 120 characters, not starting with a hyphen. */
export function isDomainName(value: string): boolean {
  if (value.length < 4 || value.length > MAIL_LIMITS.host || value.startsWith("-")) return false;
  const labels = value.split(".");
  const top = labels.pop() ?? "";
  return labels.length > 0 && TOP_LABEL.test(top) && labels.every((label) => LABEL.test(label));
}

/** The part before the "@": nothing a header or a list could be split by (space, control, angle brackets, quotes, comma, semicolon, backslash). */
const LOCAL_PART = /^[^\s\p{Cc}\p{Cf}@<>"',;:\\()[\]]{1,64}$/u;

/** An address the headers can carry as it is: one "@", a local part as above and a dotted domain. */
export function isMailAddress(value: string): boolean {
  if (value.length > MAIL_LIMITS.address) return false;
  const at = value.indexOf("@");
  if (at < 1 || at !== value.lastIndexOf("@")) return false;
  return LOCAL_PART.test(value.slice(0, at)) && isDomainName(value.slice(at + 1));
}

const LOCAL_NAME = /(^|\.)(localhost|local|internal|lan|home|corp|intranet|private|test|invalid|example|onion)$/i;

/** The sender's name: one line, nothing a header could read as an address. */
const NOT_IN_NAME = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}<>"\\]/u;

const tidy = (value: string) => value.normalize("NFC").replace(/[ \t]+/g, " ").trim();

export const mailAddressSchema = /* @__PURE__ */ z
  .string()
  .max(MAIL_LIMITS.address * 2)
  .transform((value) => value.trim().toLowerCase())
  .refine(isMailAddress);

/** Empty is "none". */
const optionalAddress = /* @__PURE__ */ z.union([/* @__PURE__ */ z.literal(""), mailAddressSchema]);

export const smtpHostSchema = /* @__PURE__ */ z
  .string()
  .max(MAIL_LIMITS.host * 2)
  .transform((value) => value.trim().toLowerCase().replace(/\.$/, ""))
  .refine((value) => isDomainName(value) && !LOCAL_NAME.test(value));

export const mailNameSchema = /* @__PURE__ */ z
  .string()
  .max(MAIL_LIMITS.name * 4)
  .transform(tidy)
  .refine((value) => [...value].length <= MAIL_LIMITS.name && !NOT_IN_NAME.test(value));

/** An app password: printable ASCII, as every provider issues them. */
export const smtpPasswordSchema = /* @__PURE__ */ z
  .string()
  .min(1)
  .max(MAIL_LIMITS.password)
  .regex(/^[\x20-\x7e]+$/);

/**
 * What "Salvar o e-mail" sends. The SMTP block goes only with mode "smtp"; its password only when
 * typed (a new server or user needs it again, which the server checks: it knows what is kept).
 */
export const mailSaveSchema = /* @__PURE__ */ z
  .object({
    mode: /* @__PURE__ */ z.enum(MAIL_MODES),
    name: mailNameSchema,
    replyTo: optionalAddress,
    smtp: /* @__PURE__ */ z
      .object({
        host: smtpHostSchema,
        port: /* @__PURE__ */ z.union([/* @__PURE__ */ z.literal(465), /* @__PURE__ */ z.literal(587)]),
        user: mailAddressSchema,
        from: optionalAddress,
        password: smtpPasswordSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((value) => value.mode !== "smtp" || value.smtp !== undefined, { path: ["smtp"] });

export type MailSave = z.infer<typeof mailSaveSchema>;

/** What the screen sees: never the password, only whether there is one and its end. */
export interface MailStatus {
  mode: MailMode;
  name: string;
  replyTo: string;
  /** The Google account, when the Gmail permission is granted. */
  gmail: { account: string | null; granted: boolean; connected: boolean };
  smtp: { host: string; port: SmtpPort; user: string; from: string; hasPassword: boolean; passwordEnd: string | null } | null;
  /** Where the test goes: the owner's e-mail. */
  testTo: string;
  sentToday: number;
  perDay: number;
  /** Encryption of the password is set up in this installation. */
  vault: boolean;
}

/** Why a test (or a send) didn't go. */
export const MAIL_PROBLEMS = [
  "not_configured",
  "gmail_scope",
  "google",
  "auth",
  "no_tls",
  "unreachable",
  "timeout",
  "refused",
  "blocked",
  "daily_limit",
  "password",
] as const;
export type MailProblem = (typeof MAIL_PROBLEMS)[number];

export type MailTest = { ok: true; to: string; via: "gmail" | "smtp" } | { ok: false; problem: MailProblem };
