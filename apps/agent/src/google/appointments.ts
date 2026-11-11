import { APPOINTMENT_LIMITS, type AppointmentKind, type ContactAppointment, type ContactAppointments, GOOGLE_LIMITS } from "@zuri/shared";
import { cpfsIn, splitName } from "./contact-name.ts";
import type { ContactIdentity, ContactProof } from "./contacts.ts";
import { searchText } from "./contacts.ts";
import { cleanText, localInstant, localToday } from "./events.ts";
import { type GoogleCalendar, GoogleError, type GoogleMeter } from "./service.ts";

/**
 * A contact's last appointment and the next one, read from the owner's Google
 * Calendar when the card is opened (nothing of it is kept). The scheduling
 * system writes the person's full name as the event's title and the type in
 * the description ("Consulta | Consultório", "Retorno | Consultório"). Google
 * finds the events by the name; what counts is decided here, with every edge
 * tested: the note after the name, an event with no type, a cancelled one, an
 * all-day one, two people with one name.
 */

const DAY_MS = 86_400_000;
/** Words a title may carry before the name ("Retorno - Ana Souza", "Consulta: Ana Souza"). */
const LEADING = /^(?:primeira consulta|consulta|retorno|avaliacao|atendimento|paciente|sessao)(?:\s+(?:de|do|da|com))?\s+/;
/** What divides a title in pieces: punctuation, or a dash with a space on each side (a hyphen inside a name stays). */
const PIECES = /\s+[-–—]\s+|[:|/\\()[\],;]+/;
/** Google's own ceiling for a description: what comes after is not read. */
const DESCRIPTION_MAX = 8_192;
const SOFT_PIECES = /\s+[-–—]\s+|:/;
/** An appointment that did not or will not happen as written. */
const CANCELLED = /\b(?:cancelad[oa]|desmarcad[oa]|remarcad[oa]|faltou|nao compareceu|cancelled|canceled)\b/;

/** A description as plain lines: Google keeps what was pasted, tags and all. */
export function plainLines(description: unknown): string[] {
  if (typeof description !== "string") return [];
  return description
    .slice(0, DESCRIPTION_MAX)
    .replace(/<\s*(?:br|\/p|\/div|\/li)\s*\/?>/gi, "\n")
    // SEC-CN-04: a tag never holds another "<", so a text of nothing but "<" is walked once, not 200 times a character.
    .replace(/<[^<>]{0,200}>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#124;|&vert;/gi, "|")
    .replace(/&amp;/gi, "&")
    .split(/\r?\n/)
    .map((line) => cleanText(line, 300))
    .filter(Boolean);
}

/** The kind an appointment's type names, by its first word, whatever the case or the accents. */
export function kindOf(type: string): AppointmentKind {
  const key = searchText(type);
  if (/^retorno\b/.test(key)) return "return";
  if (/^(?:primeira consulta|consulta|avaliacao|atendimento)\b/.test(key)) return "consultation";
  return "other";
}

/**
 * The type and the place of an event: the first line shaped "Type | Place"; without one, a line that
 * begins with "Consulta" or "Retorno". Both "" when the description says neither.
 */
export function readType(description: unknown): { type: string; place: string } {
  return typeOf(plainLines(description));
}

function typeOf(lines: readonly string[]): { type: string; place: string } {
  const shaped: { type: string; place: string }[] = [];
  for (const line of lines) {
    const match = /^([^|]{1,80})\|([^|]{0,120})/.exec(line);
    const type = cleanText((match?.[1] ?? "").replace(/^[\s\p{P}]*(?:tipo|agendamento|type)\s*:\s*/iu, ""), APPOINTMENT_LIMITS.typeMax);
    if (match && /\p{L}/u.test(type) && !type.includes("://")) shaped.push({ type, place: cleanText(match[2], APPOINTMENT_LIMITS.placeMax) });
  }
  // A line that says "Consulta" or "Retorno" wins over any other line that happens to hold a "|" ("Obs: ligar | urgente").
  const known = shaped.find((item) => kindOf(item.type) !== "other");
  if (known) return known;
  for (const line of lines) {
    const word = /^(?:tipo\s*:\s*)?(primeira consulta|consulta|retorno)\b/i.exec(line)?.[1];
    if (word) return { type: cleanText(word[0]?.toUpperCase() + word.slice(1).toLowerCase(), APPOINTMENT_LIMITS.typeMax), place: "" };
  }
  return shaped[0] ?? { type: "", place: "" };
}

/**
 * How a title names this person. "whole": the title (without the note after the name) is the name
 * itself, as the scheduling system writes it. "piece": the name is one of the title's pieces ("Retorno -
 * Ana Souza"), which only counts with a type in the description, so "Aniversário: Ana Souza" is no
 * appointment. Null otherwise: "Carla Regina" is never found inside "Carla Regina Duarte Pires".
 */
export function titleNames(title: string, name: string): "whole" | "piece" | null {
  const key = searchText(name);
  if (!key) return null;
  if (searchText(splitName(title).name) === key) return "whole";
  const folded = searchText(title);
  // First by dashes and colons only, so a name with brackets or a slash of its own ("José (Zé) da Silva") is still found.
  for (const pieces of [SOFT_PIECES, PIECES]) {
    if (folded.split(pieces).some((piece) => piece.trim().replace(LEADING, "").trim() === key)) return "piece";
  }
  return null;
}

/** A phone as its national number: without Brazil's country code and the leading zeros. */
function national(digits: string): string {
  const plain = digits.replace(/^0+/, "");
  return (plain.length === 12 || plain.length === 13) && plain.startsWith("55") ? plain.slice(2) : plain;
}

/** Two phones are one: the whole national number when both carry the area code, the last eight digits otherwise. */
function samePhone(a: string, b: string): boolean {
  const [x, y] = [national(a), national(b)];
  if (x.length < 8 || y.length < 8) return false;
  if (x.length >= 10 && y.length >= 10) return x === y || (x.slice(0, 2) === y.slice(0, 2) && x.slice(-8) === y.slice(-8));
  return x.slice(-8) === y.slice(-8);
}

/**
 * Whether an event's text or guests carry something of this contact: a phone, an e-mail, the CPF, the
 * birthday. An e-mail counts whole ("ana@" is not found inside "mariana@": SEC-CN-03), and a phone with
 * its area code when the event writes one.
 */
export function carries(proof: ContactProof, text: string, guests: readonly string[]): boolean {
  const folded = text.toLowerCase();
  if (proof.cpf && cpfsIn(text).includes(proof.cpf)) return true;
  if (proof.emails.length) {
    const written = new Set([...(folded.match(/[^\s<>()[\],;:"']+@[^\s<>()[\],;:"']+/g) ?? []).map((email) => email.replace(/[.]+$/, "")), ...guests]);
    if (proof.emails.some((email) => written.has(email))) return true;
  }
  if (proof.birthday) {
    const [year, month, day] = proof.birthday.split("-");
    if (folded.includes(proof.birthday) || new RegExp(`(?<!\\d)${day}[/.-]${month}[/.-]${year}(?!\\d)`).test(folded)) return true;
  }
  if (proof.phones.length) {
    const runs = (text.match(/\+?\d[\d\s().-]{6,}\d/g) ?? []).map((run) => run.replace(/\D/g, ""));
    if (proof.phones.some((phone) => runs.some((run) => samePhone(run, phone)))) return true;
  }
  return false;
}

interface Found extends ContactAppointment {
  at: number;
}

/** One of Google's events as an appointment of this contact, or null when it is not one. */
export function readAppointment(item: unknown, who: ContactIdentity, timeZone: string): Found | null {
  if (!item || typeof item !== "object") return null;
  const e = item as Record<string, unknown>;
  if (e.status === "cancelled") return null;
  const title = cleanText(e.summary, GOOGLE_LIMITS.titleMax);
  const named = titleNames(title, who.name);
  if (!named) return null;
  // The owner said no to this invitation, or never answered one somebody else sent (SEC-CN-02: anyone who
  // knows a contact's name could put a "return" on the card): it is not an appointment of theirs.
  const attendees = Array.isArray(e.attendees) ? (e.attendees.slice(0, 200) as { email?: unknown; self?: unknown; responseStatus?: unknown }[]) : [];
  const me = attendees.find((guest) => guest?.self === true);
  const mineToRun = (e.organizer as { self?: unknown } | undefined)?.self === true;
  if (me?.responseStatus === "declined" || (me && !mineToRun && me.responseStatus !== "accepted" && me.responseStatus !== "tentative")) return null;
  const lines = plainLines(e.description);
  const { type, place } = typeOf(lines);
  if (named === "piece" && !type) return null;
  if (CANCELLED.test(searchText(`${title} ${type}`))) return null;
  const start = e.start as { date?: unknown; dateTime?: unknown } | undefined;
  const allDay = typeof start?.date === "string";
  const value = allDay ? start?.date : start?.dateTime;
  if (typeof value !== "string") return null;
  const at = allDay ? (/^\d{4}-\d{2}-\d{2}$/.test(value) ? (localInstant(value, timeZone)?.getTime() ?? Number.NaN) : Number.NaN) : Date.parse(value);
  if (Number.isNaN(at)) return null;
  const text = [title, ...lines, cleanText(e.location, GOOGLE_LIMITS.locationMax)].join("\n");
  const guests = attendees.map((guest) => (typeof guest?.email === "string" ? guest.email.toLowerCase() : "")).filter(Boolean);
  const mine = carries(who.proof, text, guests);
  // A CPF in the event that is not this contact's: someone else with the name, in the copy or not.
  if (!mine && who.proof.cpf && cpfsIn(text).length > 0) return null;
  // An invitation of somebody else's the owner only said "maybe" to is never taken for certain.
  let certain = !me || mineToRun || me.responseStatus === "accepted";
  if (who.others.length > 0) {
    const theirs = who.others.some((other) => carries(other, text, guests));
    if (theirs && !mine) return null;
    // Nothing says whose it is, or it carries something of both: shown, with the warning.
    if (!mine || theirs) certain = false;
  }
  return { start: allDay ? value : new Date(at).toISOString(), allDay, kind: kindOf(type), type, place, certain, at };
}

const enc = encodeURIComponent;

/**
 * The last appointment that began and the next one ahead, whatever their type (the card names them by
 * it: "last return", "next consultation"), from every calendar open to Zuri. Google lists by the name,
 * oldest first, so each side is asked by itself: what is ahead (the first found is the next one), the
 * last months, and the older years only when the last months have nothing. A common name with hundreds
 * of events never pushes the recent ones out of the read (QA-CN-04). A name with accents that finds
 * nothing is asked once more without them.
 */
export async function contactAppointments(google: GoogleCalendar, who: ContactIdentity, timeZone: string, meter: GoogleMeter, now = Date.now()): Promise<ContactAppointments> {
  const calendars = google.usable() ? google.readable().slice(0, GOOGLE_LIMITS.listCalendars) : [];
  if (calendars.length === 0) return { available: false, last: null, next: null, more: false };
  const iso = (days: number) => new Date(now + days * DAY_MS).toISOString();
  const found = new Map<string, Found>();
  let more = false;
  let read = 0;
  /** One window of every calendar. False when the calls ran out. */
  const ask = async (query: string, from: string, to: string): Promise<boolean> => {
    for (const calendar of calendars) {
      let pageToken: string | undefined;
      for (let page = 0; page < APPOINTMENT_LIMITS.pages; page++) {
        let body: Record<string, unknown> | null;
        try {
          body = await google.api(`/calendars/${enc(calendar.id)}/events`, meter, {
            query: { timeMin: from, timeMax: to, singleEvents: "true", orderBy: "startTime", maxResults: "250", q: query, ...(pageToken ? { pageToken } : {}) },
          });
        } catch (error) {
          // Out of calls with something read: what was read, and the card says there may be more.
          if (error instanceof GoogleError && error.kind === "budget" && read > 0) {
            more = true;
            return false;
          }
          throw error;
        }
        read++;
        for (const item of Array.isArray(body?.items) ? body.items : []) {
          const appointment = readAppointment(item, who, timeZone);
          const id = (item as { id?: unknown } | null)?.id;
          if (appointment && typeof id === "string") found.set(`${calendar.id}\n${id}`, appointment);
        }
        pageToken = typeof body?.nextPageToken === "string" && body.nextPageToken ? body.nextPageToken : undefined;
        if (!pageToken) break;
        if (page === APPOINTMENT_LIMITS.pages - 1) more = true;
      }
    }
    return true;
  };
  const today = localInstant(localToday(timeZone, new Date(now)), timeZone)?.getTime() ?? now;
  const began = (item: Found) => (item.allDay ? item.at <= today : item.at <= now);
  const search = async (query: string): Promise<void> => {
    // Two days back, so an all-day event of today (it began) and one that is going on are in the first read too.
    if (!(await ask(query, iso(-2), iso(APPOINTMENT_LIMITS.aheadDays)))) return;
    if (!(await ask(query, iso(-APPOINTMENT_LIMITS.recentDays), iso(-2)))) return;
    if (![...found.values()].some(began)) await ask(query, iso(-APPOINTMENT_LIMITS.pastDays), iso(-APPOINTMENT_LIMITS.recentDays));
  };
  const name = who.name.slice(0, 200);
  await search(name);
  const plain = name.normalize("NFD").replace(/\p{M}+/gu, "");
  if (found.size === 0 && !more && plain !== name && meter.room(calendars.length)) await search(plain);

  const all = [...found.values()].sort((a, b) => a.at - b.at);
  const ahead = all.filter((item) => !began(item));
  const strip = (item: Found | undefined): ContactAppointment | null => {
    if (!item) return null;
    const { at: _at, ...appointment } = item;
    return appointment;
  };
  return {
    available: true,
    last: strip(all.filter(began).at(-1)),
    next: strip(ahead[0]),
    more,
  };
}
