import { words } from "../reviews/triage.ts";

/**
 * The fixed checker every specialist's output can go through
 * (docs/planos/guardrails-especialistas-ia.md, CA5): no AI, so no text can
 * talk it out of a verdict. Each use turns on the checks that fit it: the
 * reviews' guard (reviews/guard.ts) all of them, a flow's AI step and a
 * routine's external call the contacts and the hidden characters.
 */

/** Controls (line breaks aside), invisible format characters, bidi marks and variation selectors past the emoji ones. */
export const HIDDEN = /[\p{Cc}\p{Cf}\u2028\u2029]|(?![\ufe0e\ufe0f])\p{Variation_Selector}/u;
const HIDDEN_ALL = /[\p{Cf}\u2028\u2029]|(?![\n\t])\p{Cc}|(?![\ufe0e\ufe0f])\p{Variation_Selector}/gu;
const JOINER = "\u200d";

/** Any digit, @, #, link or domain: what a public reply must never carry. */
export const CONTACT = /[\p{N}@#]|https?:|www\.|:\/\/|\b[\p{L}\p{N}-]+\.(?:com|br|net|org|io|me|app|link|ly|info|biz|xyz|site|online|store|shop)\b/iu;
/** Markdown and code marks. */
export const MARKUP = /[<>{}[\]`]|\*\*|__|~~|^\s*[-*+]\s|^\s*\d+[.)]\s|\]\(/mu;

/** True when the text hides characters (line breaks are fine). */
export function hasHidden(text: string): boolean {
  return HIDDEN.test(text.replace(/\n/g, " "));
}

/** The text without hidden characters; line breaks, tabs and the emoji joiner stay. */
export function withoutHidden(text: string): string {
  return text.replace(HIDDEN_ALL, (char) => (char === JOINER ? char : ""));
}

/** `run` words in a row of `source` found in `text`. */
export function copied(text: string, source: string, run = 5): boolean {
  const from = words(source);
  if (from.length < run) return false;
  const target = ` ${words(text).join(" ")} `;
  for (let i = 0; i + run <= from.length; i++) {
    if (target.includes(` ${from.slice(i, i + run).join(" ")} `)) return true;
  }
  return false;
}

const LINK = /\b(?:https?:\/\/|www\.)[^\s<>"'`)\]]+/giu;
const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/giu;
const DOMAIN = /\b[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.(?:com|br|net|org|io|me|app|link|ly|info|biz|xyz|site|online|store|shop|dev|co)\b/giu;
const HANDLE = /(?<![\p{L}\p{N}._%+-])@[\p{L}\p{N}_.]{2,}/gu;
/** Eight or more digits, with the usual separators between them: a phone, an account, a document. */
const LONG_NUMBER = /\+?\d(?:[\s().-]{0,2}\d){7,}/gu;

/**
 * The contacts in a text, as plain keys: links and domains (lower case,
 * without the scheme, "www." and the final slash), e-mails, @handles and long
 * numbers (digits only). Wide and styled look-alikes are made plain first, so
 * "exemplo．com" and "＠perfil" count.
 */
export function contactsIn(text: string): Set<string> {
  const plain = withoutHidden(text.normalize("NFKC"));
  const out = new Set<string>();
  for (const match of plain.match(LINK) ?? []) out.add(hostKey(match));
  for (const match of plain.match(EMAIL) ?? []) out.add(match.toLowerCase());
  const withoutEmails = plain.replace(EMAIL, " ");
  for (const match of withoutEmails.replace(LINK, " ").match(DOMAIN) ?? []) out.add(hostKey(match));
  for (const match of withoutEmails.match(HANDLE) ?? []) out.add(match.toLowerCase());
  for (const match of plain.match(LONG_NUMBER) ?? []) out.add(match.replace(/\D/g, ""));
  return out;
}

function hostKey(link: string): string {
  return link
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[/.,;:!?]+$/, "");
}

/**
 * The contacts of `text` that appear nowhere in `known`: what a specialist or a
 * routine made up, or copied from a stranger's text it was told to ignore. A
 * link counts as known when a known link or domain starts it.
 */
export function newContacts(text: string, known: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const source of known) for (const key of contactsIn(source)) seen.add(key);
  const plainKnown = known.map((value) => withoutHidden(value.normalize("NFKC")).toLowerCase());
  const digitsKnown = known.map((value) => value.normalize("NFKC").replace(/\D/g, ""));
  return [...contactsIn(text)].filter((key) => {
    if (seen.has(key)) return false;
    if (/^\d+$/.test(key)) return !digitsKnown.some((digits) => digits.includes(key));
    if ([...seen].some((other) => key.startsWith(`${other}/`) || key === other)) return false;
    return !plainKnown.some((value) => value.includes(key));
  });
}
