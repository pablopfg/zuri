import { cleanText } from "./events.ts";

/**
 * A contact's name as the owner writes it at Google ("Beatriz Novaes Conceição /
 * Paciente"): the person's name, and the note kept after it to tell the
 * contact apart in the phone's list. Zuri keeps the two apart, so the name
 * finds the person in the calendar and the reviews, and the note is still
 * shown. Pure functions: every shape seen or imagined has a test.
 */

/** What may hold a note: a slash, a pipe or a backslash. Never a hyphen ("Ana-Maria", "Costa - Unidade Centro" are names). */
const SEPARATOR = /[/|\\]/gu;
/** A note in brackets at the very end: "Ana Souza (Paciente)". */
const TRAILING = /^(.*\S)\s*[([]\s*([^()[\]]{1,60}?)\s*[)\]]$/u;
const NOTE_MAX = 60;

/**
 * A slash that belongs to the words around it, not a note: between two numbers ("24/7", "3/4"), or glued
 * to a word of one or two letters on its left ("S/A", "A/C", "c/ filho", "p/ entrega", "e/ou", "Sr/Sra").
 */
function insideWord(text: string, at: number): boolean {
  if (text[at] !== "/") return false;
  const left = /(?:^|[^\p{L}\p{N}])([\p{L}\p{N}]+)$/u.exec(text.slice(0, at))?.[1];
  if (!left) return false;
  if (/^\p{L}{1,2}$/u.test(left)) return true;
  const right = /^([\p{L}\p{N}]+)(?:[^\p{L}\p{N}]|$)/u.exec(text.slice(at + 1))?.[1];
  return !!right && /^\p{N}+$/u.test(left) && /^\p{N}+$/u.test(right);
}

/** Letters enough to be someone's name: two of them, so "A / Maria" keeps "A / Maria". */
const isName = (text: string) => (text.match(/\p{L}/gu) ?? []).length >= 2;

const tidy = (text: string) =>
  text
    .replace(/^[\s/|\\]+|[\s/|\\]+$/gu, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * The name without the note, and the note. With no note (or a shape that is
 * not one) the name is the text as it came, only tidied; never empty when the
 * text had anything to show.
 */
export function splitName(raw: unknown, max = 200): { name: string; note: string } {
  const text = cleanText(raw, max);
  if (!text) return { name: "", note: "" };
  // An address someone saved as a name is no "name / note".
  if (text.includes("://")) return { name: text, note: "" };
  for (const match of text.matchAll(SEPARATOR)) {
    const at = match.index;
    if (insideWord(text, at)) continue;
    const name = tidy(text.slice(0, at));
    if (!isName(name)) continue;
    // The rest is the note, whatever it holds: "Paciente / Convênio" stays whole, with one kind of separator.
    const note = text
      .slice(at + 1)
      .split(SEPARATOR)
      .map(tidy)
      .filter(Boolean)
      .join(" / ");
    return { name, note: cleanText(note, NOTE_MAX) };
  }
  const trailing = TRAILING.exec(text);
  if (trailing?.[1] && trailing[2] && isName(tidy(trailing[1]))) return { name: tidy(trailing[1]), note: cleanText(tidy(trailing[2]), NOTE_MAX) };
  // Nothing that reads as a note: the name as written, without a separator left hanging at an end ("Ana Souza /").
  return { name: tidy(text) || text, note: "" };
}

/**
 * Google's own parts of the name (given, middle, family) without the note: Google files it under the
 * family name ("Souza / Paciente") or as the family name itself ("Paciente"). A part is kept when the
 * clean name holds it as whole words, whatever comes before ("Dr.") or the order of the parts.
 */
export function nameParts(clean: string, parts: readonly string[]): string[] {
  const holds = (value: string) => {
    const at = value ? clean.indexOf(value) : -1;
    return at >= 0 && !/[\p{L}\p{N}]/u.test(clean[at - 1] ?? "") && !/[\p{L}\p{N}]/u.test(clean[at + value.length] ?? "");
  };
  return parts.map((part) => {
    const value = tidy(part);
    if (holds(value)) return value;
    const cut = splitName(part).name;
    return cut !== value && holds(cut) ? cut : "";
  });
}

/** Eleven digits that are a CPF: the two check digits right, and not one digit repeated. */
export function isCpf(digits: string): boolean {
  if (!/^\d{11}$/.test(digits) || /^(\d)\1{10}$/.test(digits)) return false;
  const check = (length: number) => {
    let sum = 0;
    for (let i = 0; i < length; i++) sum += Number(digits[i]) * (length + 1 - i);
    const rest = (sum * 10) % 11;
    return (rest === 10 ? 0 : rest) === Number(digits[length]);
  };
  return check(9) && check(10);
}

const CPF_SHAPE = /(?<!\d)(\d{3})[.\s]?(\d{3})[.\s]?(\d{3})[-\s]?(\d{2})(?!\d)/g;

/** Every valid CPF written in a text, as eleven digits. */
export function cpfsIn(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(CPF_SHAPE)) {
    const digits = `${match[1]}${match[2]}${match[3]}${match[4]}`;
    if (isCpf(digits) && !found.includes(digits)) found.push(digits);
  }
  return found;
}

/**
 * The contact's CPF, when Google has one: a custom field named CPF first, then
 * a number written right after the word "CPF" in a field's value or in the notes. Only a valid one, so a
 * phone or an order number is never taken for it. "" with none.
 */
export function findCpf(fields: readonly { key: string; value: string }[], notes: string): string {
  // Only a field that is the CPF and nothing else: "CPF da mãe" or "CPF do responsável" is someone else's (QA-CN-01).
  for (const field of fields) {
    if (!/^\s*(?:n[ºo°.]*\s*(?:do\s+)?)?cpf\s*:?\s*$/i.test(field.key)) continue;
    const [cpf] = cpfsIn(field.value);
    if (cpf) return cpf;
  }
  for (const text of [...fields.map((field) => field.value), notes]) {
    for (const match of text.matchAll(OWN_CPF)) {
      const [cpf] = cpfsIn(match[1] ?? "");
      if (cpf) return cpf;
    }
  }
  return "";
}

/** "CPF", then at most a colon, a dash or "nº", then the number: never "CPF da mãe: …". */
const OWN_CPF = /\bcpf\b\s*(?:n[ºo°.]*\s*)?[:\-–]?\s*(\d[\d.\s-]{9,14}\d)/gi;

/** A CPF for a list: the middle shown, the ends hidden ("***.456.789-**"). */
export function maskCpf(digits: string): string {
  return /^\d{11}$/.test(digits) ? `***.${digits.slice(3, 6)}.${digits.slice(6, 9)}-**` : "";
}

const PHOTO_MAX = 500;

/**
 * The address of the contact's own photo at Google, or "". Only https on
 * Google's photo hosts (lh3 to lh6, the ones the interface's CSP lets images from: SEC-CN-05), with no user, port or fragment; the picture Google
 * draws by itself for a contact with none (`default`) is left out, so the
 * screen shows the initials. Zuri keeps the address, never the image.
 */
export function photoUrl(photos: readonly { url?: string | undefined; default?: boolean | undefined }[] | undefined): string {
  for (const photo of photos ?? []) {
    if (photo.default === true || typeof photo.url !== "string" || photo.url.length > PHOTO_MAX || /[\s\\]/.test(photo.url)) continue;
    try {
      const url = new URL(photo.url);
      if (url.protocol !== "https:" || url.username || url.password || url.port || !/^lh[3-6]\.googleusercontent\.com$/.test(url.hostname)) continue;
      url.hash = "";
      return url.href.length <= PHOTO_MAX ? url.href : "";
    } catch {
      // Not an address: no photo.
    }
  }
  return "";
}
