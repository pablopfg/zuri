// Before any schema here: the package is marked side-effect free, so index.ts alone can't order it.
import "./zod-config.ts";

import { z } from "zod";
import { hasControlCharacter } from "./productivity.ts";
import { messageHasAddress } from "./reviews.ts";

/**
 * The confirmation message (E7c1, docs/planos/link-de-confirmacao.md, section 16): the owner's text with
 * variables, kept in Configurações › Consultório. The same text goes by the WhatsApp button, and later
 * by Chatwoot. "" means the default from the catalog, in the owner's language.
 */
export const CONFIRM_MESSAGE_VARS = ["nome", "tipo", "dia", "hora", "local", "link", "prazo", "consultorio", "whatsapp"] as const;
export type ConfirmMessageVar = (typeof CONFIRM_MESSAGE_VARS)[number];
export type ConfirmMessageVars = Record<ConfirmMessageVar, string>;

export const CONFIRM_MESSAGE_MAX = 1000;

export type ConfirmMessageProblem = { problem: "empty" } | { problem: "long" } | { problem: "link" } | { problem: "address" } | { problem: "control" } | { problem: "unknown"; vars: string[] };

const known = new Set<string>(CONFIRM_MESSAGE_VARS);
/** Eight digits or more, spaced or not: a phone number written into the text. */
const PHONE = /\d(?:[\s().+-]*\d){7,}/;
/** The characters that turn the text's direction; the other control characters go by hasControlCharacter. */
const BIDI = /[\u202a-\u202e\u2066-\u2069]/;

/** A value from an event or the clinic's details that carries an address: never put in a message (SEC-E7c1-02/03). */
export function confirmValueOk(value: string): boolean {
  return !messageHasAddress(value) && !PHONE.test(value);
}

/** What is wrong with a message; null when it can be saved. "" is the default, always fine. */
export function confirmMessageProblem(text: string): ConfirmMessageProblem | null {
  if (text === "") return null;
  if (text.trim() === "") return { problem: "empty" };
  if ([...text].length > CONFIRM_MESSAGE_MAX) return { problem: "long" };
  if (!text.includes("{link}")) return { problem: "link" };
  // SEC-E7c1-01: a stolen session could otherwise point every patient to another site or number in
  // the owner's own words. Addresses only by {link}, the team's number only by {whatsapp}.
  if (messageHasAddress(text) || PHONE.test(text)) return { problem: "address" };
  if (hasControlCharacter(text, false) || BIDI.test(text)) return { problem: "control" };
  const unknown = [...new Set([...text.matchAll(/\{([^{}]*)\}/g)].map((match) => match[1] ?? "").filter((name) => !known.has(name)))];
  if (unknown.length > 0) return { problem: "unknown", vars: unknown };
  return null;
}

/** The message as stored: "" (the default) or a text that passes `confirmMessageProblem`. */
export const confirmMessageSchema = /* @__PURE__ */ z
  .string()
  .max(CONFIRM_MESSAGE_MAX * 4)
  .transform((value) => value.normalize("NFC").replace(/\r\n?/g, "\n"))
  .refine((value) => confirmMessageProblem(value) === null);

/**
 * The text with each known variable put in, once: what a value carries is never read again, so a
 * "{link}" in an event's title stays text.
 */
export function fillConfirmMessage(text: string, vars: ConfirmMessageVars): string {
  return text.replace(/\{([a-z]+)\}/g, (whole, name: string) => (known.has(name) ? vars[name as ConfirmMessageVar] : whole));
}
