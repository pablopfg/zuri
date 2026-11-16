// Before any schema here: the package is marked side-effect free, so index.ts alone can't order it.
import "./zod-config.ts";

import { z } from "zod";
import type { ConfirmMessageVar } from "./confirm-message.ts";

/**
 * The confirmation e-mail (E7c2, docs/planos/link-de-confirmacao.md, section 17): a subject, a text and
 * the button's label, kept in Integrações › E-mail para pacientes. The link goes only in the button,
 * never loose in the text. Each field "" means the catalog's default, in the owner's language.
 */
export const CONFIRM_MAIL_LIMITS = { subject: 120, body: 2000, button: 30 } as const;

/** The subject takes only the short ones: a line in the inbox. */
export const CONFIRM_MAIL_SUBJECT_VARS = ["nome", "tipo", "dia", "hora", "consultorio"] as const satisfies readonly ConfirmMessageVar[];
/** The text takes all but {link}: the link is the button. Written out, not derived: this module stays apart from the WhatsApp one, so the e-mail's card loads alone (rule P11). */
export const CONFIRM_MAIL_BODY_VARS = ["nome", "tipo", "dia", "hora", "local", "prazo", "consultorio", "whatsapp"] as const satisfies readonly Exclude<ConfirmMessageVar, "link">[];

export interface ConfirmMail {
  subject: string;
  body: string;
  button: string;
}

export const DEFAULT_CONFIRM_MAIL: ConfirmMail = { subject: "", body: "", button: "" };

export type ConfirmMailField = keyof ConfirmMail;
export type ConfirmMailProblem =
  | { field: ConfirmMailField; problem: "empty" | "long" | "line" | "address" | "control" | "link" }
  | { field: ConfirmMailField; problem: "unknown"; vars: string[] };

/** Invisible format characters (direction, zero width, soft hyphen…), but the joiner of emoji: they hide an address from the rule below (SEC-E7c2-03). */
const INVISIBLE = /(?!\u200d)\p{Cf}/u;
/** The same rules as `confirmValueOk` and `messageHasAddress` (SEC-E7c1-01), kept here so this module needs no other; a test holds them together. */
const ADDRESS = /https?:|www\.|[\p{L}\p{N}_-]\.[a-z]{2,24}(?![\p{L}\p{N}])/iu;
const PHONE = /\d(?:[\s().+-]*\d){7,}/;

/** A control character other than the line break and the tab, or an invisible format character. */
function hasControl(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 0x09 || code === 0x0a) continue;
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return INVISIBLE.test(text);
}

/** Each known variable put in once, the rest left as typed (the screen's preview; the server fills with fillConfirmMessage). */
export function fillConfirmMail(text: string, vars: Partial<Record<ConfirmMessageVar, string>>): string {
  return text.replace(/\{([a-z]+)\}/g, (whole, name: string) => vars[name as ConfirmMessageVar] ?? whole);
}

function unknownVars(text: string, allowed: readonly string[]): string[] {
  return [...new Set([...text.matchAll(/\{([^{}]*)\}/g)].map((match) => match[1] ?? "").filter((name) => !allowed.includes(name)))];
}

/** The first thing wrong with the e-mail, field by field; null when it can be saved. A field "" is its default. */
export function confirmMailProblem(mail: ConfirmMail): ConfirmMailProblem | null {
  const fields: [ConfirmMailField, string, number, readonly string[] | null][] = [
    ["subject", mail.subject, CONFIRM_MAIL_LIMITS.subject, CONFIRM_MAIL_SUBJECT_VARS],
    ["body", mail.body, CONFIRM_MAIL_LIMITS.body, CONFIRM_MAIL_BODY_VARS],
    ["button", mail.button, CONFIRM_MAIL_LIMITS.button, []],
  ];
  for (const [field, text, max, vars] of fields) {
    if (text === "") continue;
    if (text.trim() === "") return { field, problem: "empty" };
    if ([...text].length > max) return { field, problem: "long" };
    if (field !== "body" && /[\r\n]/.test(text)) return { field, problem: "line" };
    // SEC-E7c1-01, for the e-mail too: addresses only by the button, the team's number only by {whatsapp}.
    if (ADDRESS.test(text) || PHONE.test(text)) return { field, problem: "address" };
    if (hasControl(text)) return { field, problem: "control" };
    if (text.includes("{link}")) return { field, problem: "link" };
    const unknown = unknownVars(text, vars ?? []);
    if (unknown.length > 0) return { field, problem: "unknown", vars: unknown };
  }
  return null;
}

const field = (max: number) =>
  /* @__PURE__ */ z
    .string()
    .max(max * 4)
    .transform((value) => value.normalize("NFC").replace(/\r\n?/g, "\n"));

/** The e-mail as stored: each field "" (its default) or a text that passes `confirmMailProblem`. */
export const confirmMailSchema = /* @__PURE__ */ z
  .object({ subject: field(CONFIRM_MAIL_LIMITS.subject), body: field(CONFIRM_MAIL_LIMITS.body), button: field(CONFIRM_MAIL_LIMITS.button) })
  .strict()
  .refine((mail) => confirmMailProblem(mail) === null);

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Text as HTML: every character that could open markup or an attribute escaped. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}
