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

/**
 * Any scheme ("https://", "ftp://"), a scheme-relative "//host" or "www.", up to a space or a quote.
 * The three patterns below read text a third party wrote (flow items, tool results), so every
 * run that can fail is bounded: the scheme to 32 characters, the e-mail's local part to 64 and
 * its domain to 253, a domain to 11 labels. Unbounded, a text like "a.a.a.…" made each match
 * try again from every letter, and 40 KB of it took seconds (Semgrep detect-redos, 13/11/2026).
 * A longer run still matches, by its tail, so nothing is hidden by the bounds.
 */
const LINK = /(?:\b[a-z][a-z0-9+.-]{0,31}:\/\/|(?<![\p{L}\p{N}:/])\/\/(?=[\p{L}\p{N}])|\bwww\.)[^\s<>"'`)\]]+/giu;
const EMAIL = /[\p{L}\p{N}._%+-]{1,64}@[\p{L}\p{N}.-]{1,253}\.[\p{L}]{2,}/giu;
/** label.label with a final label of 2 to 24 letters: any top-level domain, not only the common ones. */
const DOMAIN = /(?<![\p{L}\p{N}-])[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+){0,9}\.\p{L}{2,24}(?![\p{L}\p{N}])(?:\/[^\s<>"'`)\]]*)?/giu;
/** File names look like domains; these endings are files, not hosts. */
const FILE_ENDINGS = new Set(["pdf", "png", "jpg", "jpeg", "gif", "webp", "svg", "txt", "md", "doc", "docx", "xls", "xlsx", "csv", "json", "js", "ts", "html", "zip", "mp3", "mp4"]);
const IP = /(?<![\d.])\d{1,3}(?:\.\d{1,3}){3}(?![\d.])/gu;
const HANDLE = /(?<![\p{L}\p{N}._%+-])@[\p{L}\p{N}_.]{2,}/gu;
/** Seven or more digits, with the usual separators between them: a phone, a chat id, an account, a document. */
const LONG_NUMBER = /\+?\d(?:[\s().-]{0,2}\d){6,}/gu;
/** Dates and times in ISO form are not contacts: they leave the text before the numbers are read. */
const ISO_DATE = /\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?\b/gu;
/** How deep links inside links are looked for. */
const NESTED_DEPTH = 3;

/** Percent-encoded text decoded (three times at most, for double encoding); a broken escape stays as it is. */
function decoded(text: string): string {
  let out = text;
  for (let round = 0; round < 3 && /%[0-9a-f]{2}/i.test(out); round++) {
    out = out.replace(/(?:%[0-9a-f]{2})+/gi, (run) => {
      try {
        return decodeURIComponent(run);
      } catch {
        return run;
      }
    });
  }
  return out;
}

/**
 * The contacts in a text, as plain keys: links and domains (lower case,
 * without the scheme, "www.", the query and the final slash), IP addresses,
 * e-mails, @handles and long numbers (digits only). Wide and styled
 * look-alikes are made plain and percent escapes decoded first, so
 * "exemplo．com", "＠perfil" and "https%3A%2F%2F" count; a link inside
 * another one's path or query (a redirect) counts on its own.
 */
export function contactsIn(text: string, depth = 0): Set<string> {
  const plain = withoutHidden(decoded(text.normalize("NFKC")).normalize("NFKC"));
  const out = new Set<string>();
  const nested = (rest: string) => {
    if (depth < NESTED_DEPTH && rest) for (const key of contactsIn(rest, depth + 1)) out.add(key);
  };
  for (const match of plain.match(LINK) ?? []) {
    out.add(hostKey(match));
    nested(match.replace(/^(?:[a-z][a-z0-9+.-]*:)?\/\/|^www\./i, "").replace(/^[^/?#]*/, ""));
  }
  for (const match of plain.match(EMAIL) ?? []) out.add(match.toLowerCase());
  const rest = plain.replace(LINK, " ").replace(EMAIL, " ");
  // nosemgrep: detect-redos -- anchored at the start of a LINK match, whose scheme is at most 32 characters
  for (const match of rest.match(DOMAIN) ?? []) {
    const host = match.split("/")[0] ?? "";
    if (FILE_ENDINGS.has(host.split(".").at(-1)?.toLowerCase() ?? "")) continue;
    out.add(hostKey(match));
    nested(match.slice(host.length));
  }
  for (const match of rest.match(IP) ?? []) out.add(match);
  for (const match of rest.match(HANDLE) ?? []) out.add(match.toLowerCase());
  for (const match of plain.replace(ISO_DATE, " ").replace(IP, " ").match(LONG_NUMBER) ?? []) out.add(match.replace(/\D/g, ""));
  return out;
}

/** A link as a key: lower case, no scheme, no "www.", no query or fragment, no final punctuation. */
function hostKey(link: string): string {
  return link
    .toLowerCase()
    .replace(/^(?:[a-z][a-z0-9+.-]*:)?\/\//, "")
    .replace(/^www\./, "")
    .replace(/[?#].*$/, "")
    .replace(/[/.,;:!?]+$/, "");
}

/**
 * The contacts of `text` that appear nowhere in `known`: what a specialist or a
 * routine made up, or copied from a stranger's text it was told to ignore.
 * Keys are compared whole (never as a piece of a longer one); a link counts
 * as known when its host is a known domain.
 */
export function newContacts(text: string, known: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const source of known) for (const key of contactsIn(source)) seen.add(key);
  return [...contactsIn(text)].filter((key) => {
    if (seen.has(key)) return false;
    const host = key.split("/")[0] ?? key;
    return !(key.includes("/") && seen.has(host));
  });
}
