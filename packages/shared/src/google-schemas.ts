// Before any schema here: the package is marked side-effect free, so index.ts alone can't order it.
import "./zod-config.ts";

import { z } from "zod";
import { isCountry, validPhone } from "./countries.ts";
import { CALENDAR_MODES, EVENT_PAYMENTS, EVENT_STATUS_COLOR, GOOGLE_LIMITS, GOOGLE_STATE_PREFIX, PATIENT_LIMITS } from "./google.ts";

/**
 * The Google Calendar routes' request bodies (step 19). Apart from google.ts,
 * which the interface imports: Zod stays out of its first load (rule P11).
 */

const statePattern = /* @__PURE__ */ new RegExp(`^${GOOGLE_STATE_PREFIX.replace(".", "\\.")}[A-Za-z0-9_-]{43}$`);

/** What Google put in the address when it sent the owner back. */
export const googleCallbackSchema = /* @__PURE__ */ (() =>
  z
    .object({
      state: z.string().regex(statePattern),
      code: z.string().min(1).max(2_048).optional(),
      error: z.string().max(200).optional(),
    })
    .strict())();
export type GoogleCallback = z.input<typeof googleCallbackSchema>;

export const calendarModeSchema = /* @__PURE__ */ (() => z.object({ mode: z.enum(CALENDAR_MODES) }).strict())();

const localDate = /^\d{4}-\d{2}-\d{2}$/;
const localWhen = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?$/;
/** Calendar ids are e-mails or Google's group addresses (some with "#"); never a slash, a space or a "?". */
const calendarId = /* @__PURE__ */ (() => z.string().regex(/^[^\s/?\\]{1,1024}$/))();
/** Event ids are Google's base32hex, with "_" and the instant for one occurrence of a repeating event. */
// Never only dots: ".." would climb out of /events/ in Google's address.
const eventId = /* @__PURE__ */ (() => z.string().regex(/^(?!\.+$)[A-Za-z0-9_@.-]{1,1024}$/))();

/** The Agenda screen's window: local dates, `to` inclusive (step 19). */
export const googleEventsQuerySchema = /* @__PURE__ */ (() =>
  z
    .object({
      from: z.string().regex(localDate),
      to: z.string().regex(localDate),
    })
    .strict())();

const eventFields = /* @__PURE__ */ (() => ({
  title: z.string().trim().min(1).max(GOOGLE_LIMITS.titleMax),
  allDay: z.boolean(),
  start: z.string().regex(localWhen),
  end: z.string().regex(localWhen),
  location: z.string().trim().max(GOOGLE_LIMITS.locationMax),
  description: z.string().max(GOOGLE_LIMITS.descriptionMax),
}))();

/**
 * The patient's contact and the payment (E5e), each one optional; "" clears it at Google. Only these
 * keys reach the event's private properties: the schema is strict.
 */
const patientFields = /* @__PURE__ */ (() => ({
  country: z.string().refine((code) => code === "" || isCountry(code)).optional(),
  phone: z.string().regex(/^\d{0,15}$/).optional(),
  email: z.union([z.literal(""), z.string().max(PATIENT_LIMITS.emailMax).email()]).optional(),
  payment: z.enum([...EVENT_PAYMENTS, ""]).optional(),
  /** Ask Google for a Meet call (true) or take the call off (false). */
  meet: z.boolean().optional(),
}))();

/** A phone is read with its country: the one sent, else Brazil. */
function phoneFits(value: { country?: string | undefined; phone?: string | undefined }): boolean {
  if (!value.phone) return true;
  return validPhone(value.country || "BR", value.phone);
}

/** A status, as the color it is at Google: one of the four, never another color. */
const statusColor = /* @__PURE__ */ (() => z.enum(Object.values(EVENT_STATUS_COLOR)))();

export const googleEventCreateSchema = /* @__PURE__ */ (() =>
  z
    .object({
      calendarId,
      ...eventFields,
      location: eventFields.location.optional(),
      description: eventFields.description.optional(),
      /** Born with a status other than "Agendado": the color it is at Google. */
      colorId: statusColor.optional(),
      ...patientFields,
    })
    .strict()
    .refine(phoneFits, { path: ["phone"] }))();
export type GoogleEventCreate = z.input<typeof googleEventCreateSchema>;

/** A change of one event: only the fields sent, and the version the owner saw (`etag`). */
export const googleEventUpdateSchema = /* @__PURE__ */ (() =>
  z
    .object({
      calendarId,
      eventId,
      etag: z.string().min(1).max(200),
      title: eventFields.title.optional(),
      allDay: eventFields.allDay.optional(),
      start: eventFields.start.optional(),
      end: eventFields.end.optional(),
      location: eventFields.location.optional(),
      description: eventFields.description.optional(),
      /** The status, as the color it is at Google; "" takes the color off. Never another color. */
      colorId: z.enum([...Object.values(EVENT_STATUS_COLOR), ""]).optional(),
      ...patientFields,
    })
    .strict()
    .refine(phoneFits, { path: ["phone"] }))();
export type GoogleEventUpdate = z.input<typeof googleEventUpdateSchema>;

export const googleEventDeleteSchema = /* @__PURE__ */ (() => z.object({ calendarId, eventId, etag: z.string().min(1).max(200) }).strict())();
