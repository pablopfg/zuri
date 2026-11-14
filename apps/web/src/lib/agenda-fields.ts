import { COUNTRY_DIAL, HOME_COUNTRY, PATIENT_EMAIL, validPhone } from "@zuri/shared";

/**
 * The appointment's fields as the owner types them (E5e, protótipo v52): a date "dd/mm/aaaa" and hours
 * "hh:mm" from 00:00 to 23:59 whatever the device's language, a phone shaped as it is typed. Pure
 * functions: the form keeps ISO dates, and these turn one into the other.
 */

/** Only digits, and the slash or the colon go in by themselves: "12112026" is "12/11/2026". */
export function maskDate(value: string): string {
  const d = value.replace(/\D/g, "").slice(0, 8);
  if (d.length > 4) return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
  if (d.length > 2) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return d;
}

/** "1430" is "14:30". */
export function maskTime(value: string): string {
  const d = value.replace(/\D/g, "").slice(0, 4);
  return d.length > 2 ? `${d.slice(0, 2)}:${d.slice(2)}` : d;
}

/**
 * Brazil: "(41) 99999-0000", and a "+55" pasted in front goes. Elsewhere: blocks of three, the last one
 * with up to four digits.
 */
export function maskPhone(value: string, country: string): string {
  let d = value.replace(/\D/g, "");
  if (country !== HOME_COUNTRY) {
    d = d.slice(0, 15);
    const out: string[] = [];
    while (d.length > 4) {
      out.push(d.slice(0, 3));
      d = d.slice(3);
    }
    if (d) out.push(d);
    return out.join(" ");
  }
  if (d.length > 11 && d.startsWith("55")) d = d.slice(2);
  d = d.slice(0, 11);
  if (!d) return "";
  if (d.length <= 2) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  const cut = d.length === 11 ? 7 : 6;
  return `(${d.slice(0, 2)}) ${d.slice(2, cut)}-${d.slice(cut)}`;
}

/** The digits of a phone as typed. */
export function phoneDigits(value: string): string {
  return value.replace(/\D/g, "");
}

/** A phone as the details show it: "+55 (41) 99999-0000". */
export function phoneText(country: string, digits: string): string {
  const known = Object.hasOwn(COUNTRY_DIAL, country) ? country : HOME_COUNTRY;
  return `${COUNTRY_DIAL[known]} ${maskPhone(digits, known)}`;
}

/** Whether a phone typed is one Zuri keeps (the server checks it again). Empty is fine: it is optional. */
export function phoneFits(country: string, value: string): boolean {
  const digits = phoneDigits(value);
  return digits === "" || validPhone(country, digits);
}


/** An e-mail, or nothing. */
export function emailFits(value: string): boolean {
  const email = value.trim();
  return email === "" || (email.length <= 254 && PATIENT_EMAIL.test(email));
}

/** "dd/mm/aaaa" of an ISO day. */
export function dateText(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

/** The ISO day "dd/mm/aaaa" names, or null for one that is not a real day (31/02). */
export function dateOf(text: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  if (!m) return null;
  const [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (year < 1900 || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/** "hh:mm" from 00:00 to 23:59, or null. */
export function timeOf(text: string): string | null {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(text) ? text : null;
}

/** The place of an appointment, the second part of its type line: at the office or online. */
export type Place = "Consultório" | "Online";

/** The kinds the form always offers (12/11/2026), before the ones the calendar already uses. */
export const KINDS = ["Consulta", "Retorno", "Avaliação física"] as const;

/** "Consulta" of "Consulta | Online". */
export function kindOf(type: string): string {
  return type.split("|")[0]?.trim() ?? "";
}

/** Online when the type line says so; anything else is at the office. */
export function placeOf(type: string): Place {
  return /\|\s*Online\s*$/i.test(type) ? "Online" : "Consultório";
}

/** The type line Zuri writes: "Consulta | Online", or "" for a plain event. A "|" typed in the kind goes. */
export function typeOf(kind: string, place: Place): string {
  const clean = kind.replace(/\|/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  return clean ? `${clean} | ${place}` : "";
}

/** The kinds of the list: the fixed ones, then those the calendar uses, each once. */
export function kindList(types: readonly string[], current: string): string[] {
  return [...new Set([...KINDS, ...types.map(kindOf), kindOf(current)].filter(Boolean))];
}

/** The patient's fields of a form, as the server takes them. */
export interface PatientBody {
  country: string;
  phone: string;
  email: string;
  payment: "unpaid" | "paid" | "free";
}

export type PatientProblem = "phone" | "email";

/** What a form with a type sends of the patient, or the field to fix. */
export function patientBody(form: { country: string; phone: string; email: string; payment: PatientBody["payment"] }): PatientBody | PatientProblem {
  if (!phoneFits(form.country, form.phone)) return "phone";
  if (!emailFits(form.email)) return "email";
  return { country: form.country, phone: phoneDigits(form.phone), email: form.email.trim(), payment: form.payment };
}

/**
 * Only what changed for a PATCH. A phone is read with its country, so the two go together; a field
 * left empty clears it at Google.
 */
export function patientChanges(before: PatientBody, after: PatientBody): Partial<PatientBody> {
  const out: Partial<PatientBody> = {};
  if (before.country !== after.country || before.phone !== after.phone) {
    out.country = after.country;
    out.phone = after.phone;
  }
  if (before.email !== after.email) out.email = after.email;
  if (before.payment !== after.payment) out.payment = after.payment;
  return out;
}
