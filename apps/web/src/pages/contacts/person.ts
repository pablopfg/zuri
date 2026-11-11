import type { ContactDetail, ContactSummary } from "@zuri/shared";

/**
 * What the Contacts screen (Sinal, S10) works out from a contact by itself:
 * how to call someone with no name, which number opens WhatsApp, which groups
 * of the card are empty. Pure, so the edges have tests of their own.
 */

/**
 * Whether Google has a name for this contact. With none at Google the server
 * sends the first e-mail, or the first phone, in its place (and nothing at all
 * for a contact with neither), and that is how the screen tells.
 */
export function isNamed(contact: Pick<ContactSummary, "name" | "phone" | "email">): boolean {
  const name = contact.name.trim();
  return name !== "" && name !== contact.phone && name !== contact.email;
}

/** The name, or what stands for it when Google has none: the first phone, then the first e-mail. Empty with none of the three. */
export function shownName(contact: Pick<ContactSummary, "name" | "phone" | "email">): string {
  return isNamed(contact) ? contact.name.trim() : contact.phone || contact.email || contact.name.trim();
}

/** One or two letters for the round mark: the first and the last word of the name. Empty with no name. */
export function initials(name: string): string {
  const words = name.match(/[\p{L}\p{N}]+/gu) ?? [];
  const first = [...(words[0] ?? "")][0] ?? "";
  const last = words.length > 1 ? ([...(words.at(-1) ?? "")][0] ?? "") : "";
  return (first + last).toUpperCase();
}

/** The letter a contact is filed under: A to Z without the accent, "#" for anything else and for no name. */
export function fileLetter(name: string): string {
  const letter = [...name.trim().normalize("NFD")][0]?.toUpperCase() ?? "";
  return /^[A-Z]$/.test(letter) ? letter : "#";
}

/** The list in groups by letter, in the order it came (the server sorts by name); "#", with the nameless, always last. */
export function byLetter<T extends Pick<ContactSummary, "name" | "phone" | "email">>(contacts: T[]): { letter: string; contacts: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const contact of contacts) {
    const letter = isNamed(contact) ? fileLetter(contact.name) : "#";
    const group = groups.get(letter);
    if (group) group.push(contact);
    else groups.set(letter, [contact]);
  }
  const rest = groups.get("#");
  groups.delete("#");
  return [...[...groups].map(([letter, list]) => ({ letter, contacts: list })), ...(rest ? [{ letter: "#", contacts: rest }] : [])];
}

/**
 * The number for a `tel:` link: digits and a leading "+", up to the first
 * word ("3333-0001 ramal 12" dials the number, not the extension glued to it).
 * Null when nothing is left to dial.
 */
export function dialNumber(phone: string): string | null {
  const digits = (phone.trim().split(/\p{L}/u)[0] ?? "").replace(/\D/g, "");
  if (!digits) return null;
  return `${phone.trim().startsWith("+") ? "+" : ""}${digits}`;
}

/**
 * The number for a `wa.me` link, or null. Only a Brazilian mobile: area code
 * and nine digits starting with 9, with or without the country code. Nothing
 * says for free whether a number has WhatsApp; a landline certainly has not.
 */
export function whatsappNumber(phone: string): string | null {
  let digits = phone.replace(/\D/g, "").replace(/^0+/, "");
  // Written with a country code that is not Brazil's: never read as a Brazilian number.
  if (phone.trim().startsWith("+") && !digits.startsWith("55")) return null;
  if (digits.length === 13 && digits.startsWith("55")) digits = digits.slice(2);
  return /^[1-9][1-9]9\d{8}$/.test(digits) ? `55${digits}` : null;
}

/** The first number of the contact that opens WhatsApp. */
export function whatsappOf(phones: { value: string }[]): string | null {
  for (const phone of phones) {
    const number = whatsappNumber(phone.value);
    if (number) return number;
  }
  return null;
}

/**
 * A site as a link, or null. The server only keeps http(s) with a host and
 * no user; the screen checks again, so nothing else ever becomes an `href`.
 */
export function siteHref(value: string): string | null {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

/** The site without the scheme and the last slash, as the owner reads it. */
export function siteText(value: string): string {
  return value.replace(/^https?:\/\//i, "").replace(/\/$/, "");
}

/** The groups of the card, in Google Contacts' own order. */
export const CARD_GROUPS = ["name", "phones", "emails", "addresses", "birthday", "dates", "relations", "company", "urls", "chats", "labels", "fields", "notes"] as const;
export type CardGroup = (typeof CARD_GROUPS)[number];

/** Whether Google has anything in a group of this contact. */
export function hasGroup(contact: ContactDetail, group: CardGroup): boolean {
  switch (group) {
    case "name":
      return !!(contact.given || contact.middle || contact.family || contact.nickname);
    case "birthday":
      return !!contact.birthdayFull;
    case "company":
      return !!(contact.organization || contact.jobTitle);
    case "notes":
      return !!contact.notes;
    default:
      return contact[group].length > 0;
  }
}

/** The groups with nothing at Google: the card names them in one line instead of drawing blank rows. */
export function emptyGroups(contact: ContactDetail): CardGroup[] {
  return CARD_GROUPS.filter((group) => !hasGroup(contact, group));
}

/** "MM-DD" or "YYYY-MM-DD": the day and month in the owner's language, the year when there is one. A date the calendar cannot hold stays as it came. */
export function dayText(value: string, locale: string): string {
  const [a, b, c] = value.split("-");
  const [year, month, day] = c ? [a, b, c] : [undefined, a, b];
  const date = new Date(Date.UTC(Number(year ?? 2000), Number(month) - 1, Number(day), 12));
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", ...(year ? { year: "numeric" } : {}), timeZone: "UTC" }).format(date);
}

/** "4:12" until the next sync; "0:00" once it is due or when the hour is no hour at all. An hour or more shows the hours ("1:04:12"). */
export function countdown(msLeft: number): string {
  const total = Number.isFinite(msLeft) ? Math.max(0, Math.ceil(msLeft / 1000)) : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}

/** A contact's id as the address carries it. */
export const isContactId = (value: string): boolean => /^[0-9a-f-]{36}$/.test(value);

/**
 * The contacts of a list whose name another one in it also has. Two people
 * with one name are two people, never a duplicate: their lines show the
 * birthday and the CPF besides the phone, so the owner tells them apart.
 */
export function sameNamed<T extends Pick<ContactSummary, "id" | "name" | "phone" | "email">>(contacts: T[]): Set<string> {
  const byName = new Map<string, string[]>();
  for (const contact of contacts) {
    if (!isNamed(contact)) continue;
    const key = contact.name.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
    const ids = byName.get(key);
    if (ids) ids.push(contact.id);
    else byName.set(key, [contact.id]);
  }
  return new Set([...byName.values()].filter((ids) => ids.length > 1).flat());
}

/** "há 3 semanas", "em 5 dias", "hoje": how far a day is from today, both as the owner's calendar days. */
export function daysApart(day: string, today: string, locale: string): string {
  const days = Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (!Number.isFinite(days)) return "";
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const size = Math.abs(days);
  if (size < 14) return format.format(days, "day");
  if (size < 60) return format.format(Math.trunc(days / 7), "week");
  if (size < 730) return format.format(Math.trunc(days / 30), "month");
  return format.format(Math.trunc(days / 365), "year");
}

/** The calendar day ("YYYY-MM-DD") an instant falls on in a time zone. */
export function localDay(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}
