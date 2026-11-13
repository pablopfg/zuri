import { hmacSha256Hex } from "@zuri/shared";
import { splitName } from "../google/contact-name.ts";
import { searchText } from "../google/contacts.ts";

/**
 * The reviewer's name as Zuri compares it (PR S20, docs/planos/sinal-refinado-funcionalidades.md
 * 8.1): lower case, without accents, without a title ("Dra.", "Sr.") or the note after the name,
 * punctuation as spaces. "Dra. Lúcia  Ferraz" is "lucia ferraz". Only two HMAC prints of it are
 * kept (the whole name; the first with the last), never the name: a copy of the database or a
 * backup can't read who reviewed. The key is a Worker secret, never in the database.
 */

const TITLE = /^(?:(?:dra?|sra?|srta|prof|profa)\.?(?:\s+|$))+/;

/** The same titles as the contacts keep them folded (`searchText`), one before the first name: the ranges the links read. */
export const NAME_TITLES = ["dr", "dra", "sr", "sra", "srta", "prof", "profa"].flatMap((title) => [`${title} `, `${title}. `]);

/** The name as the prints are made of it; "" when nothing is left. */
export function nameKey(raw: string): string {
  const name = searchText(splitName(raw).name)
    .replace(/[^\p{L}\p{N}'\s-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return name.replace(TITLE, "").trim();
}

/** The first and the last word, or null for a name of one word. */
export function shortKey(key: string): string | null {
  const words = key.split(" ").filter(Boolean);
  return words.length >= 2 ? `${words[0]} ${words.at(-1)}` : null;
}

export interface NamePrints {
  full: string;
  short: string | null;
}

/** The two prints of a name; null for an empty one. Both kinds share one space: "ana souza" is the same print wherever it comes from. */
export async function namePrints(secret: string, raw: string): Promise<NamePrints | null> {
  const key = nameKey(raw);
  if (!key) return null;
  const short = shortKey(key);
  return { full: await print(secret, key), short: short === null ? null : await print(secret, short) };
}

function print(secret: string, key: string): Promise<string> {
  return hmacSha256Hex(secret, `zuri:review-name:v1:${key}`);
}
